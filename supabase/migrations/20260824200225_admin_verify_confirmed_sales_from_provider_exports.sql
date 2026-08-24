-- Admin may reconcile an authoritative ISP-export row into the rep's existing
-- two-button COMPLETE SALE record. The canonical McCoy sale is enriched only
-- where accounting fields are blank; an automatic provider-origin duplicate is
-- retired in the same transaction so one order produces one ranking credit.

alter table public.provider_sales_rows
  drop constraint if exists provider_sales_rows_materialization_status_check;
alter table public.provider_sales_rows
  add constraint provider_sales_rows_materialization_status_check check(materialization_status in(
    'pending','linked_existing_sale','created_pending_review','unmatched_seller','unmatched_capture',
    'ambiguous_capture','provider_cancelled','provider_abandoned','not_completed',
    'seller_mismatch_review','ambiguous_seller_review','linked_cancelled_ranking_retained',
    'linked_existing_ranking_verified','created_cancelled_ranking_retained',
    'created_ranking_only_unmatched_capture','created_ranking_verified_accounting_review',
    'linked_rep_ranking_verified','created_rep_ranking_only','created_rep_cancelled_ranking_retained',
    'admin_created_verified','admin_linked_verified_duplicate',
    'admin_linked_confirmed_sale','admin_merged_confirmed_sale'
  ));

alter table public.provider_sale_evidence_review_history
  drop constraint if exists provider_sale_evidence_review_history_action_check;
alter table public.provider_sale_evidence_review_history
  add constraint provider_sale_evidence_review_history_action_check check(action in(
    'assigned_approved','unverified','not_a_sale','restore','matched_confirmed_sale'
  ));

create table if not exists public.sale_provider_reconciliation_history(
  id bigint generated always as identity primary key,
  sale_id uuid not null references public.sales_records(id) on delete restrict,
  provider_sale_row_id uuid not null references public.provider_sales_rows(id) on delete restrict,
  archived_duplicate_sale_id uuid references public.sales_records(id) on delete restrict,
  changed_by uuid not null references auth.users(id) on delete restrict,
  changed_by_email text not null,
  filled_fields text[] not null default '{}'::text[],
  preserved_fields text[] not null default '{}'::text[],
  previous_ranking_eligible boolean not null,
  new_ranking_eligible boolean not null,
  reason text not null,
  created_at timestamptz not null default now(),
  unique(provider_sale_row_id)
);

create index if not exists sale_provider_reconciliation_history_sale_created_idx
  on public.sale_provider_reconciliation_history(sale_id,created_at desc);
create index if not exists provider_sales_rows_admin_confirm_match_idx
  on public.provider_sales_rows(lower(trim(provider)),sale_date desc)
  where admin_evidence_disposition is distinct from 'not_a_sale';

alter table public.sale_provider_reconciliation_history enable row level security;
revoke all on public.sale_provider_reconciliation_history from anon;
revoke insert,update,delete,truncate on public.sale_provider_reconciliation_history from authenticated;
grant select on public.sale_provider_reconciliation_history to authenticated;
drop policy if exists "Admins can read sale provider reconciliation history"
  on public.sale_provider_reconciliation_history;
create policy "Admins can read sale provider reconciliation history"
on public.sale_provider_reconciliation_history for select to authenticated
using ((select private.current_app_role())='admin');

create or replace function private.provider_export_speed_mbps(p_product text)
returns integer
language plpgsql
immutable
set search_path=pg_catalog
as $$
declare
  v text:=lower(trim(coalesce(p_product,'')));
  v_match text[];
begin
  v_match:=regexp_match(v,'([0-9]+(?:\.[0-9]+)?)\s*(?:gig|gbps|g\b)');
  if v_match is not null then return round((v_match[1])::numeric*1000)::integer; end if;
  v_match:=regexp_match(v,'([0-9]+)\s*(?:mbps|meg)');
  if v_match is not null then return (v_match[1])::integer; end if;
  return null;
exception when others then return null;
end;
$$;
revoke all on function private.provider_export_speed_mbps(text) from public,anon,authenticated;

-- One Admin-only candidate payload for the entire incomplete-sale bank avoids
-- an N+1 request per sale. It includes unlinked evidence and safe-to-merge
-- automatic provider materializations, never a row already tied to another
-- rep-confirmed sale.
create or replace function public.admin_confirmed_sale_provider_candidates()
returns jsonb
language plpgsql
stable
security definer
set search_path=pg_catalog,public,auth,private
as $$
declare
  v_actor uuid:=auth.uid();
  v_candidates jsonb;
begin
  if v_actor is null or not exists(
    select 1
    from auth.users u
    join public.app_user_access a on lower(a.email)=lower(u.email)
    where u.id=v_actor and a.active=true and lower(a.role)='admin'
  ) then raise exception 'Admin access required'; end if;

  select coalesce(jsonb_object_agg(s.id::text,coalesce(c.rows,'[]'::jsonb)),'{}'::jsonb)
  into v_candidates
  from public.sales_records s
  left join public.provider_sale_captures capture on capture.id=s.provider_capture_id
  left join lateral(
    select jsonb_agg(jsonb_build_object(
      'id',candidate.id,
      'provider',candidate.provider,
      'order_number',candidate.order_number,
      'account_number',candidate.account_number,
      'customer_name',candidate.customer_name,
      'service_address',candidate.service_address,
      'sale_date',candidate.sale_date,
      'provider_status',candidate.provider_status,
      'product_name',candidate.product_name,
      'install_date',candidate.install_date,
      'materialized_sale_id',candidate.materialized_sale_id,
      'will_archive_provider_duplicate',candidate.will_archive_provider_duplicate,
      'match_score',candidate.match_score
    ) order by candidate.match_score desc,candidate.sale_date desc nulls last,candidate.created_at desc) as rows
    from(
      select p.*,
        nullif(trim(p.raw_payload->>'Internet Product Name'),'') as product_name,
        coalesce(
          private.safe_provider_date(p.raw_payload->>'Order Due Date'),
          private.safe_provider_date(p.raw_payload->>'Due Date'),
          private.safe_provider_date(p.raw_payload->>'Install Date'),
          private.safe_provider_date(p.raw_payload->>'Installation')
        ) as install_date,
        (p.materialized_sale_id is not null and p.materialized_sale_id<>s.id) as will_archive_provider_duplicate,
        (case when private.provider_identity_key(split_part(coalesce(p.service_address,''),',',1))<>''
          and private.provider_identity_key(split_part(coalesce(p.service_address,''),',',1)) in(
            private.provider_identity_key(split_part(coalesce(s.service_address,''),',',1)),
            private.provider_identity_key(split_part(coalesce(capture.service_address,''),',',1))
          ) then 100 else 0 end)
        +(case when linked.rep_user_id=s.rep_user_id then 40 else 0 end)
        +(case when p.source_rep_user_id=s.rep_user_id then 30 else 0 end)
        +(case when p.sale_date is not null and abs(extract(epoch from(p.sale_date-s.created_at)))<=1209600 then 20 else 0 end)
        as match_score
      from public.provider_sales_rows p
      left join public.sales_records linked on linked.id=p.materialized_sale_id
      where lower(trim(coalesce(p.provider,'')))=lower(trim(s.isp))
        and p.admin_evidence_disposition is distinct from 'not_a_sale'
        and lower(coalesce(p.provider_status,'')) !~ '(abandon|cancel)'
        and lower(coalesce(p.provider_status,'')) ~ '(completed|fulfilled|active|submitted|provider in process)'
        and(
          p.materialized_sale_id is null
          or p.materialized_sale_id=s.id
          or(
            linked.rep_user_id=s.rep_user_id
            and linked.rep_reported_outcome is null
            and coalesce(linked.compensation_snapshot->>'sale_origin','') in(
              'authoritative_provider_ranking_materialization',
              'rep_provider_history_ranking'
            )
          )
        )
      order by match_score desc,p.sale_date desc nulls last,p.created_at desc
      limit 25
    ) candidate
  ) c on true
  where s.rep_reported_outcome='completed'
    and s.provider_capture_id is not null
    and s.required_metrics_complete is not true
    and lower(coalesce(s.sale_status,''))<>'not_a_sale';

  return v_candidates;
end;
$$;
revoke all on function public.admin_confirmed_sale_provider_candidates() from public,anon;
grant execute on function public.admin_confirmed_sale_provider_candidates() to authenticated;

create or replace function public.admin_verify_confirmed_sale_from_provider(
  p_sale_id uuid,
  p_provider_sale_row_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public,auth,private
as $$
declare
  v_actor uuid:=auth.uid();
  v_actor_email text;
  v_reason text:=trim(coalesce(p_reason,''));
  v_before public.sales_records%rowtype;
  v_sale public.sales_records%rowtype;
  v_provider public.provider_sales_rows%rowtype;
  v_linked public.sales_records%rowtype;
  v_capture_address text;
  v_customer text;
  v_first text;
  v_last text;
  v_install_date date;
  v_order_date date;
  v_product_name text;
  v_product text;
  v_speed integer;
  v_provider_rep_id uuid;
  v_provider_rep_count integer:=0;
  v_filled text[]:='{}'::text[];
  v_preserved text[]:='{}'::text[];
  v_duplicate_id uuid;
  v_duplicate_before public.sales_records%rowtype;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;
  select lower(u.email) into v_actor_email
  from auth.users u
  join public.app_user_access a on lower(a.email)=lower(u.email)
  where u.id=v_actor and a.active=true and lower(a.role)='admin';
  if v_actor_email is null then raise exception 'Admin access required'; end if;
  if v_reason='' then raise exception 'An ISP reconciliation reason is required'; end if;

  select * into v_before from public.sales_records where id=p_sale_id for update;
  if not found then raise exception 'User-confirmed sale not found'; end if;
  if v_before.rep_reported_outcome is distinct from 'completed' or v_before.provider_capture_id is null then
    raise exception 'Only a two-button COMPLETE SALE record can receive exported customer information';
  end if;
  if lower(coalesce(v_before.sale_status,''))='not_a_sale'
     or lower(coalesce(v_before.admin_review_disposition,''))='not_a_sale' then
    raise exception 'A NOT A SALE record cannot be verified from provider evidence';
  end if;

  select * into v_provider
  from public.provider_sales_rows
  where id=p_provider_sale_row_id
  for update;
  if not found then raise exception 'ISP export row not found'; end if;
  if lower(trim(coalesce(v_provider.provider,'')))<>lower(trim(v_before.isp)) then
    raise exception 'The ISP export provider does not match the user-confirmed sale';
  end if;
  if v_provider.admin_evidence_disposition='not_a_sale'
     or lower(coalesce(v_provider.provider_status,'')) ~ '(abandon|cancel)'
     or lower(coalesce(v_provider.provider_status,'')) !~ '(completed|fulfilled|active|submitted|provider in process)' then
    raise exception 'The selected ISP export row is not eligible sale evidence';
  end if;

  if v_provider.materialized_sale_id=p_sale_id
     and v_before.provider_sale_row_id=p_provider_sale_row_id
     and v_before.required_metrics_complete is true
     and v_before.ranking_eligible is true then
    return jsonb_build_object(
      'ok',true,'already_applied',true,'sale',to_jsonb(v_before),
      'filled_fields','[]'::jsonb,'preserved_fields','[]'::jsonb,
      'archived_duplicate_sale_id',null
    );
  end if;

  if nullif(trim(coalesce(v_before.provider_order_number,'')),'') is not null
     and nullif(trim(coalesce(v_provider.order_number,'')),'') is not null
     and private.provider_identity_key(v_before.provider_order_number)<>private.provider_identity_key(v_provider.order_number) then
    raise exception 'The existing order number conflicts with the selected ISP export row';
  end if;
  if nullif(trim(coalesce(v_before.provider_account_number,'')),'') is not null
     and nullif(trim(coalesce(v_provider.account_number,'')),'') is not null
     and private.provider_identity_key(v_before.provider_account_number)<>private.provider_identity_key(v_provider.account_number) then
    raise exception 'The existing account number conflicts with the selected ISP export row';
  end if;

  select c.service_address into v_capture_address
  from public.provider_sale_captures c where c.id=v_before.provider_capture_id;

  if v_provider.materialized_sale_id is not null and v_provider.materialized_sale_id<>p_sale_id then
    select * into v_linked
    from public.sales_records where id=v_provider.materialized_sale_id for update;
    if not found then raise exception 'ISP export has an invalid materialized sale link'; end if;
    if v_linked.rep_user_id<>v_before.rep_user_id then
      raise exception 'ISP export is already credited to a different McCoy user';
    end if;
    if v_linked.rep_reported_outcome is not null or v_linked.provider_capture_id is not null
       or coalesce(v_linked.compensation_snapshot->>'sale_origin','') not in(
         'authoritative_provider_ranking_materialization','rep_provider_history_ranking'
       ) then
      raise exception 'ISP export is already linked to another user-confirmed sale';
    end if;
    v_provider_rep_id:=v_linked.rep_user_id;
    v_duplicate_id:=v_linked.id;
    v_duplicate_before:=v_linked;
  elsif v_provider.source_rep_user_id is not null then
    v_provider_rep_id:=v_provider.source_rep_user_id;
  else
    select count(distinct l.rep_user_id),(array_agg(l.rep_user_id order by l.updated_at desc))[1]
    into v_provider_rep_count,v_provider_rep_id
    from public.provider_seller_links l
    where l.provider=v_provider.provider and l.active=true
      and(
        private.provider_identity_key(l.seller_identifier) in(
          private.provider_identity_key(coalesce(v_provider.seller_identifier,'')),
          private.provider_identity_key(coalesce(v_provider.seller_name,'')),
          private.provider_identity_key(coalesce(v_provider.seller_email,''))
        )
        or private.provider_identity_key(coalesce(l.seller_name,''))=
           private.provider_identity_key(coalesce(v_provider.seller_name,''))
      );
    if v_provider_rep_count<>1 then v_provider_rep_id:=null; end if;
  end if;

  if v_provider_rep_id is not null and v_provider_rep_id<>v_before.rep_user_id then
    raise exception 'The provider seller identity belongs to a different McCoy user';
  end if;
  if v_provider_rep_id is null and not(
    nullif(private.provider_identity_key(split_part(coalesce(v_provider.service_address,''),',',1)),'') is not null
    and private.provider_identity_key(split_part(coalesce(v_provider.service_address,''),',',1)) in(
      private.provider_identity_key(split_part(coalesce(v_before.service_address,''),',',1)),
      private.provider_identity_key(split_part(coalesce(v_capture_address,''),',',1))
    )
  ) then
    raise exception 'Unmapped ISP evidence requires an exact service-address match';
  end if;

  v_customer:=regexp_replace(trim(coalesce(v_provider.customer_name,'')),'\s+',' ','g');
  if position(',' in v_customer)>0 then
    v_last:=nullif(trim(split_part(v_customer,',',1)),'');
    v_first:=nullif(trim(split_part(v_customer,',',2)),'');
  else
    v_first:=nullif(split_part(v_customer,' ',1),'');
    v_last:=nullif(trim(substr(v_customer,length(coalesce(v_first,''))+1)),'');
  end if;
  v_install_date:=coalesce(
    private.safe_provider_date(v_provider.raw_payload->>'Order Due Date'),
    private.safe_provider_date(v_provider.raw_payload->>'Due Date'),
    private.safe_provider_date(v_provider.raw_payload->>'Install Date'),
    private.safe_provider_date(v_provider.raw_payload->>'Installation')
  );
  v_order_date:=(v_provider.sale_date at time zone 'America/Los_Angeles')::date;
  v_product_name:=nullif(trim(v_provider.raw_payload->>'Internet Product Name'),'');
  v_product:=case
    when lower(v_before.isp)='at&t' and lower(coalesce(v_product_name,'')) like '%air%' then 'Internet Air'
    when lower(v_before.isp)='at&t' and v_product_name is not null then 'Fiber'
    else v_product_name
  end;
  v_speed:=private.provider_export_speed_mbps(v_product_name);

  if nullif(trim(coalesce(v_before.provider_order_number,'')),'') is null and nullif(trim(coalesce(v_provider.order_number,'')),'') is not null then v_filled:=array_append(v_filled,'provider_order_number'); else v_preserved:=array_append(v_preserved,'provider_order_number'); end if;
  if nullif(trim(coalesce(v_before.provider_account_number,'')),'') is null and nullif(trim(coalesce(v_provider.account_number,'')),'') is not null then v_filled:=array_append(v_filled,'provider_account_number'); else v_preserved:=array_append(v_preserved,'provider_account_number'); end if;
  if nullif(trim(coalesce(v_before.customer_first_name,'')),'') is null or lower(trim(v_before.customer_first_name))='unknown' then if v_first is not null then v_filled:=array_append(v_filled,'customer_first_name'); end if; else v_preserved:=array_append(v_preserved,'customer_first_name'); end if;
  if nullif(trim(coalesce(v_before.customer_last_name,'')),'') is null or lower(trim(v_before.customer_last_name))='unknown' then if v_last is not null then v_filled:=array_append(v_filled,'customer_last_name'); end if; else v_preserved:=array_append(v_preserved,'customer_last_name'); end if;
  if nullif(trim(coalesce(v_before.service_address,'')),'') is null and nullif(trim(coalesce(v_provider.service_address,'')),'') is not null then v_filled:=array_append(v_filled,'service_address'); else v_preserved:=array_append(v_preserved,'service_address'); end if;
  if v_before.install_date is null and v_install_date is not null then v_filled:=array_append(v_filled,'install_date'); else v_preserved:=array_append(v_preserved,'install_date'); end if;
  if v_before.order_date is null and v_order_date is not null then v_filled:=array_append(v_filled,'order_date'); else v_preserved:=array_append(v_preserved,'order_date'); end if;
  if nullif(trim(coalesce(v_before.internet_product,'')),'') is null and v_product is not null then v_filled:=array_append(v_filled,'internet_product'); else v_preserved:=array_append(v_preserved,'internet_product'); end if;
  if coalesce(v_before.internet_speed_mbps,0)<=0 and v_speed is not null then v_filled:=array_append(v_filled,'internet_speed_mbps'); else v_preserved:=array_append(v_preserved,'internet_speed_mbps'); end if;

  update public.sales_records set
    provider_order_number=coalesce(nullif(trim(provider_order_number),''),nullif(trim(v_provider.order_number),'')),
    provider_account_number=coalesce(nullif(trim(provider_account_number),''),nullif(trim(v_provider.account_number),'')),
    customer_first_name=case when nullif(trim(coalesce(customer_first_name,'')),'') is null or lower(trim(customer_first_name))='unknown' then v_first else customer_first_name end,
    customer_last_name=case when nullif(trim(coalesce(customer_last_name,'')),'') is null or lower(trim(customer_last_name))='unknown' then v_last else customer_last_name end,
    service_address=coalesce(nullif(trim(service_address),''),nullif(trim(v_provider.service_address),''),nullif(trim(v_capture_address),'')),
    install_date=coalesce(install_date,v_install_date),
    order_date=coalesce(order_date,v_order_date),
    internet_product=coalesce(nullif(trim(internet_product),''),v_product),
    internet_speed_mbps=case when coalesce(internet_speed_mbps,0)<=0 then v_speed else internet_speed_mbps end,
    provider_sale_row_id=v_provider.id,
    provider_reported_rep_user_id=coalesce(provider_reported_rep_user_id,v_provider_rep_id),
    provider_reported_rep_email=coalesce(provider_reported_rep_email,v_provider.seller_email,v_provider.source_rep_email),
    provider_reported_rep_name=coalesce(provider_reported_rep_name,v_provider.seller_name),
    compensation_snapshot=jsonb_set(
      jsonb_set(coalesce(compensation_snapshot,'{}'::jsonb),'{accounting_review_required}','false'::jsonb,true),
      '{provider_reconciliation}',
      jsonb_build_object(
        'status','admin_verified','provider_sale_row_id',v_provider.id,
        'verified_by',v_actor_email,'verified_at',now(),'reason',v_reason,
        'filled_fields',to_jsonb(v_filled),'preserved_fields',to_jsonb(v_preserved),
        'archived_duplicate_sale_id',v_duplicate_id
      ),true
    )
  where id=p_sale_id
  returning * into v_sale;

  if v_sale.required_metrics_complete is not true then
    raise exception 'ISP export is still missing required accounting data: %',
      array_to_string(v_sale.required_metrics_missing,', ');
  end if;

  if v_duplicate_id is not null then
    update public.sales_records set
      provider_sale_row_id=null,
      sale_status='not_a_sale',
      admin_review_disposition='not_a_sale',
      admin_review_reason='Merged duplicate provider materialization into user-confirmed sale '||p_sale_id,
      admin_reviewed_by=v_actor,
      admin_reviewed_at=now(),
      verification_status='merged_duplicate',
      verification_reason='merged_into_user_confirmed_sale:'||p_sale_id,
      ranking_credit_excluded=true,
      ranking_credit_excluded_at=now(),
      ranking_credit_excluded_by=v_actor,
      ranking_credit_exclusion_reason='Merged duplicate provider materialization into user-confirmed sale '||p_sale_id,
      ranking_eligible=false,
      ranking_verified_at=null,
      competition_eligible=false,
      compensation_snapshot=jsonb_set(
        coalesce(compensation_snapshot,'{}'::jsonb),'{provider_reconciliation}',
        jsonb_build_object('status','merged_duplicate','canonical_sale_id',p_sale_id,'merged_by',v_actor_email,'merged_at',now()),true
      ),
      notes=concat_ws(E'\n',nullif(notes,''),'Duplicate provider-origin record merged into user-confirmed sale '||p_sale_id||'.')
    where id=v_duplicate_id;

    insert into public.sale_review_disposition_history(
      sale_id,changed_by,changed_by_email,previous_disposition,new_disposition,
      previous_verification_status,new_verification_status,previous_sale_status,new_sale_status,
      previous_ranking_eligible,new_ranking_eligible,reason
    ) values(
      v_duplicate_id,v_actor,v_actor_email,v_duplicate_before.admin_review_disposition,'not_a_sale',
      v_duplicate_before.verification_status,'merged_duplicate',v_duplicate_before.sale_status,'not_a_sale',
      v_duplicate_before.ranking_eligible,false,
      'Duplicate provider materialization merged into user-confirmed sale '||p_sale_id
    );
  end if;

  select * into v_sale
  from public.admin_apply_sale_credit(
    p_sale_id,v_before.rep_email,'ISP export matched to user-confirmed sale: '||v_reason
  );

  update public.provider_sales_rows set
    materialized_sale_id=p_sale_id,
    materialization_status=case when v_duplicate_id is null then 'admin_linked_confirmed_sale' else 'admin_merged_confirmed_sale' end,
    materialization_reason='Admin matched authoritative ISP export to the existing user-confirmed sale; blank accounting fields were filled and duplicate credit was prevented.',
    materialized_at=now(),
    admin_evidence_disposition=null,
    admin_evidence_reason=v_reason,
    admin_evidence_reviewed_by=v_actor,
    admin_evidence_reviewed_at=now()
  where id=v_provider.id;

  insert into public.provider_sale_evidence_review_history(
    provider_sale_row_id,sale_id,changed_by,changed_by_email,action,
    previous_disposition,new_disposition,assigned_rep_user_id,assigned_rep_email,assigned_rep_name,reason
  ) values(
    v_provider.id,p_sale_id,v_actor,v_actor_email,'matched_confirmed_sale',
    v_provider.admin_evidence_disposition,null,v_sale.rep_user_id,v_sale.rep_email,v_sale.rep_name,v_reason
  );

  insert into public.sale_provider_reconciliation_history(
    sale_id,provider_sale_row_id,archived_duplicate_sale_id,changed_by,changed_by_email,
    filled_fields,preserved_fields,previous_ranking_eligible,new_ranking_eligible,reason
  ) values(
    p_sale_id,v_provider.id,v_duplicate_id,v_actor,v_actor_email,
    v_filled,v_preserved,v_before.ranking_eligible,v_sale.ranking_eligible,v_reason
  );

  return jsonb_build_object(
    'ok',true,'already_applied',false,'sale',to_jsonb(v_sale),
    'filled_fields',to_jsonb(v_filled),'preserved_fields',to_jsonb(v_preserved),
    'archived_duplicate_sale_id',v_duplicate_id
  );
end;
$$;
revoke all on function public.admin_verify_confirmed_sale_from_provider(uuid,uuid,text) from public,anon;
grant execute on function public.admin_verify_confirmed_sale_from_provider(uuid,uuid,text) to authenticated;

-- Add reconciliation history to the existing Admin Sale Credit detail payload.
create or replace function public.admin_sale_credit_dashboard_page(
  p_limit integer default 100,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path=pg_catalog,public,auth,private
as $$
declare
  v_actor uuid:=auth.uid();
  v_limit integer:=greatest(1,least(coalesce(p_limit,100),250));
  v_offset integer:=greatest(0,coalesce(p_offset,0));
  v_total integer;
  v_rows jsonb;
begin
  if v_actor is null or not exists(
    select 1 from auth.users u
    join public.app_user_access a on lower(a.email)=lower(u.email)
    where u.id=v_actor and a.active=true and lower(a.role)='admin'
  ) then raise exception 'Admin access required'; end if;

  select count(*)::integer into v_total from public.sales_records;
  select coalesce(jsonb_agg(row_data order by created_at desc),'[]'::jsonb)
  into v_rows
  from(
    select s.created_at,jsonb_build_object(
      'sale',to_jsonb(s),
      'region',private.sale_credit_region(t.name,l.state,s.service_address,a.team_name),
      'provider_account',case when p.id is null then null else to_jsonb(p) end,
      'credit_history',coalesce((select jsonb_agg(to_jsonb(h) order by h.created_at desc) from public.sale_credit_assignment_history h where h.sale_id=s.id),'[]'::jsonb),
      'ranking_credit_history',coalesce((select jsonb_agg(to_jsonb(rh) order by rh.created_at desc) from public.sale_ranking_credit_history rh where rh.sale_id=s.id),'[]'::jsonb),
      'review_queue_history',coalesce((select jsonb_agg(to_jsonb(qh) order by qh.created_at desc) from public.sale_credit_review_queue_history qh where qh.sale_id=s.id),'[]'::jsonb),
      'review_history',coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc) from public.sale_review_disposition_history r where r.sale_id=s.id),'[]'::jsonb),
      'provider_reconciliation_history',coalesce((select jsonb_agg(to_jsonb(pr) order by pr.created_at desc) from public.sale_provider_reconciliation_history pr where pr.sale_id=s.id or pr.archived_duplicate_sale_id=s.id),'[]'::jsonb)
    ) as row_data
    from public.sales_records s
    left join public.provider_sales_rows p on p.id=s.provider_sale_row_id
    left join public.app_user_access a on lower(a.email)=lower(s.rep_email)
    left join public.leads l on l.id=s.distance_lead_id
    left join public.teams t on t.id=l.assigned_team_id
    order by s.created_at desc
    limit v_limit offset v_offset
  ) page;

  return jsonb_build_object('ok',true,'total_count',v_total,'offset',v_offset,'limit',v_limit,'rows',v_rows);
end;
$$;
revoke all on function public.admin_sale_credit_dashboard_page(integer,integer) from public,anon;
grant execute on function public.admin_sale_credit_dashboard_page(integer,integer) to authenticated;

comment on function public.admin_verify_confirmed_sale_from_provider(uuid,uuid,text) is
  'Admin-only atomic reconciliation: fills blank accounting fields on a two-button completed sale from ISP export evidence, archives a safe provider-origin duplicate, approves ranking/pay, and writes immutable audits.';
