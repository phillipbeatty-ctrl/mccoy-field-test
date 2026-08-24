-- Keep Admin-removed McCoy sales and their linked ISP evidence out of the
-- active Sales Bank. Rows remain as business and audit evidence.

create or replace function public.admin_set_sale_review_disposition(
  p_sale_id uuid,
  p_disposition text,
  p_reason text
)
returns public.sales_records
language plpgsql
security definer
set search_path=pg_catalog,public,auth,private
as $$
declare
  v_actor uuid:=auth.uid();
  v_actor_email text;
  v_sale public.sales_records%rowtype;
  v_before public.sales_records%rowtype;
  v_provider public.provider_sales_rows%rowtype;
  v_disposition text:=lower(trim(coalesce(p_disposition,'')));
  v_provider_status text;
  v_provider_disposition text;
  v_provider_reason text;
  v_previous_provider_disposition text;
  v_effective_provider_disposition text;
  v_restore_verified boolean:=false;
  v_outside_approved boolean:=false;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;
  select lower(u.email) into v_actor_email
  from auth.users u
  join public.app_user_access a on lower(a.email)=lower(u.email)
  where u.id=v_actor and a.active=true and lower(a.role)='admin';
  if v_actor_email is null then raise exception 'Admin access required'; end if;
  if v_disposition not in ('unverified','not_a_sale','restore') then
    raise exception 'Invalid sale review disposition';
  end if;
  if nullif(trim(coalesce(p_reason,'')),'') is null then
    raise exception 'A review reason is required';
  end if;

  select * into v_sale
  from public.sales_records
  where id=p_sale_id
  for update;
  if not found then raise exception 'Sale not found'; end if;
  v_before:=v_sale;

  if v_disposition='unverified' then
    update public.sales_records set
      admin_review_disposition='unverified',
      admin_review_reason=trim(p_reason),
      admin_reviewed_by=v_actor,
      admin_reviewed_at=now(),
      verification_status='admin_unverified',
      verification_reason='admin_marked_unverified: '||trim(p_reason),
      ranking_eligible=false,
      competition_eligible=false,
      ranking_verified_at=null
    where id=p_sale_id
    returning * into v_sale;

  elsif v_disposition='not_a_sale' then
    update public.sales_records set
      admin_review_disposition='not_a_sale',
      admin_review_reason=trim(p_reason),
      admin_reviewed_by=v_actor,
      admin_reviewed_at=now(),
      sale_status='not_a_sale',
      verification_status='not_a_sale',
      verification_reason='admin_marked_not_a_sale: '||trim(p_reason),
      ranking_eligible=false,
      competition_eligible=false,
      ranking_verified_at=null
    where id=p_sale_id
    returning * into v_sale;

    -- A separate, pre-existing provider NOT A SALE decision is never
    -- overwritten by the linked-sale removal path.
    for v_provider in
      select p.*
      from public.provider_sales_rows p
      where (p.id=v_before.provider_sale_row_id or p.materialized_sale_id=p_sale_id)
        and (
          p.admin_evidence_disposition is distinct from 'not_a_sale'
          or coalesce(p.admin_evidence_reason,'') like 'admin_sale_removed:%'
        )
      for update
    loop
      update public.provider_sales_rows set
        admin_evidence_disposition='not_a_sale',
        admin_evidence_reason='admin_sale_removed: '||trim(p_reason),
        admin_evidence_reviewed_by=v_actor,
        admin_evidence_reviewed_at=now()
      where id=v_provider.id;

      insert into public.provider_sale_evidence_review_history(
        provider_sale_row_id,sale_id,changed_by,changed_by_email,action,
        previous_disposition,new_disposition,reason
      ) values (
        v_provider.id,p_sale_id,v_actor,v_actor_email,'not_a_sale',
        v_provider.admin_evidence_disposition,'not_a_sale',
        'admin_sale_removed: '||trim(p_reason)
      );
    end loop;

  else
    select
      lower(coalesce(p.provider_status,'')),
      p.admin_evidence_disposition,
      p.admin_evidence_reason
    into v_provider_status,v_provider_disposition,v_provider_reason
    from public.provider_sales_rows p
    where p.id=v_sale.provider_sale_row_id or p.materialized_sale_id=p_sale_id
    order by (p.id=v_sale.provider_sale_row_id) desc,p.created_at
    limit 1;

    v_effective_provider_disposition:=v_provider_disposition;
    if v_provider_disposition='not_a_sale'
       and coalesce(v_provider_reason,'') like 'admin_sale_removed:%' then
      select h.previous_disposition into v_previous_provider_disposition
      from public.provider_sale_evidence_review_history h
      where h.provider_sale_row_id in (
        select p.id
        from public.provider_sales_rows p
        where p.id=v_sale.provider_sale_row_id or p.materialized_sale_id=p_sale_id
      )
        and h.sale_id=p_sale_id
        and h.action='not_a_sale'
        and h.reason like 'admin_sale_removed:%'
      order by h.created_at desc
      limit 1;
      v_effective_provider_disposition:=v_previous_provider_disposition;
    end if;

    v_restore_verified:=coalesce(v_provider_status,'') !~ '(abandon|cancel)'
      and coalesce(v_provider_status,'') ~ '(completed|fulfilled|active|submitted|provider in process)'
      and v_effective_provider_disposition is null;
    v_outside_approved:=coalesce(v_sale.compensation_snapshot->>'sale_origin','')<>'outside_system'
      or lower(coalesce(v_sale.compensation_snapshot#>>'{admin_approval,status}',''))='approved';

    update public.sales_records set
      admin_review_disposition=null,
      admin_review_reason=trim(p_reason),
      admin_reviewed_by=v_actor,
      admin_reviewed_at=now(),
      sale_status=case when sale_status='not_a_sale' then 'reported' else sale_status end,
      verification_status=case when v_restore_verified then 'verified_processed' else 'pending_verification' end,
      verification_reason=case when v_restore_verified then 'admin_restored_provider_decision' else 'admin_restored_pending_provider_verification' end,
      ranking_eligible=v_restore_verified and v_outside_approved,
      competition_eligible=v_restore_verified and v_outside_approved and sale_status<>'cancelled',
      ranking_verified_at=case when v_restore_verified and v_outside_approved then coalesce(ranking_verified_at,verified_at,now()) else null end
    where id=p_sale_id
    returning * into v_sale;

    -- Reverse only the provider decision created by this linked-sale removal
    -- and restore the provider row's exact earlier Admin disposition.
    for v_provider in
      select p.*
      from public.provider_sales_rows p
      where (p.id=v_before.provider_sale_row_id or p.materialized_sale_id=p_sale_id)
        and p.admin_evidence_disposition='not_a_sale'
        and coalesce(p.admin_evidence_reason,'') like 'admin_sale_removed:%'
      for update
    loop
      select h.previous_disposition into v_previous_provider_disposition
      from public.provider_sale_evidence_review_history h
      where h.provider_sale_row_id=v_provider.id
        and h.sale_id=p_sale_id
        and h.action='not_a_sale'
        and h.reason like 'admin_sale_removed:%'
      order by h.created_at desc
      limit 1;

      update public.provider_sales_rows set
        admin_evidence_disposition=v_previous_provider_disposition,
        admin_evidence_reason='admin_sale_restored: '||trim(p_reason),
        admin_evidence_reviewed_by=v_actor,
        admin_evidence_reviewed_at=now()
      where id=v_provider.id;

      insert into public.provider_sale_evidence_review_history(
        provider_sale_row_id,sale_id,changed_by,changed_by_email,action,
        previous_disposition,new_disposition,reason
      ) values (
        v_provider.id,p_sale_id,v_actor,v_actor_email,'restore',
        'not_a_sale',v_previous_provider_disposition,
        'admin_sale_restored: '||trim(p_reason)
      );
    end loop;
  end if;

  insert into public.sale_review_disposition_history(
    sale_id,changed_by,changed_by_email,previous_disposition,new_disposition,
    previous_verification_status,new_verification_status,previous_sale_status,new_sale_status,
    previous_ranking_eligible,new_ranking_eligible,reason
  ) values (
    p_sale_id,v_actor,v_actor_email,v_before.admin_review_disposition,v_sale.admin_review_disposition,
    v_before.verification_status,v_sale.verification_status,v_before.sale_status,v_sale.sale_status,
    v_before.ranking_eligible,v_sale.ranking_eligible,trim(p_reason)
  );
  return v_sale;
end;
$$;

revoke all on function public.admin_set_sale_review_disposition(uuid,text,text)
  from public,anon;
grant execute on function public.admin_set_sale_review_disposition(uuid,text,text)
  to authenticated;

comment on function public.admin_set_sale_review_disposition(uuid,text,text) is
  'Admin-only sale review. NOT A SALE removes linked McCoy and ISP evidence from the active Sales Bank while preserving audit history.';

-- Synchronize provider evidence for sales removed before this migration.
do $$
declare
  v_link record;
begin
  for v_link in
    select distinct on (p.id)
      p.id as provider_sale_row_id,
      p.admin_evidence_disposition as previous_disposition,
      s.id as sale_id,
      s.admin_reviewed_by as changed_by,
      lower(u.email) as changed_by_email,
      coalesce(nullif(trim(s.admin_review_reason),''),'Historical Admin sale removal') as reason
    from public.sales_records s
    join public.provider_sales_rows p
      on p.id=s.provider_sale_row_id or p.materialized_sale_id=s.id
    join auth.users u on u.id=s.admin_reviewed_by
    where s.sale_status='not_a_sale'
      and s.admin_review_disposition='not_a_sale'
      and p.admin_evidence_disposition is distinct from 'not_a_sale'
    order by p.id,s.admin_reviewed_at desc nulls last,s.created_at desc
  loop
    update public.provider_sales_rows set
      admin_evidence_disposition='not_a_sale',
      admin_evidence_reason='admin_sale_removed: '||v_link.reason,
      admin_evidence_reviewed_by=v_link.changed_by,
      admin_evidence_reviewed_at=now()
    where id=v_link.provider_sale_row_id;

    insert into public.provider_sale_evidence_review_history(
      provider_sale_row_id,sale_id,changed_by,changed_by_email,action,
      previous_disposition,new_disposition,reason
    ) values (
      v_link.provider_sale_row_id,v_link.sale_id,v_link.changed_by,v_link.changed_by_email,
      'not_a_sale',v_link.previous_disposition,'not_a_sale',
      'admin_sale_removed: '||v_link.reason
    );
  end loop;
end;
$$;
