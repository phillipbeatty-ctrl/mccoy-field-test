-- Resolve one unassigned provider row at a time without creating a seller-wide
-- alias. Provider source fields remain immutable; Admin decisions are separate
-- and audited.
alter table public.provider_sales_rows
  add column if not exists admin_evidence_disposition text,
  add column if not exists admin_evidence_reason text,
  add column if not exists admin_evidence_reviewed_by uuid references auth.users(id) on delete set null,
  add column if not exists admin_evidence_reviewed_at timestamptz;

alter table public.provider_sales_rows
  drop constraint if exists provider_sales_rows_admin_evidence_disposition_check,
  add constraint provider_sales_rows_admin_evidence_disposition_check
    check (admin_evidence_disposition is null or admin_evidence_disposition in ('unverified','not_a_sale'));

create index if not exists provider_sales_rows_admin_evidence_review_idx
  on public.provider_sales_rows(admin_evidence_disposition,created_at desc)
  where materialized_sale_id is null;

create table if not exists public.provider_sale_evidence_review_history(
  id bigint generated always as identity primary key,
  provider_sale_row_id uuid not null references public.provider_sales_rows(id) on delete restrict,
  sale_id uuid references public.sales_records(id) on delete restrict,
  changed_by uuid not null references auth.users(id) on delete restrict,
  changed_by_email text not null,
  action text not null check (action in ('assigned_approved','unverified','not_a_sale','restore')),
  previous_disposition text,
  new_disposition text,
  assigned_rep_user_id uuid references auth.users(id) on delete restrict,
  assigned_rep_email text,
  assigned_rep_name text,
  reason text not null,
  created_at timestamptz not null default now()
);
create index if not exists provider_sale_evidence_review_history_row_created_idx
  on public.provider_sale_evidence_review_history(provider_sale_row_id,created_at desc);
alter table public.provider_sale_evidence_review_history enable row level security;
revoke all on public.provider_sale_evidence_review_history from anon;
revoke insert,update,delete,truncate on public.provider_sale_evidence_review_history from authenticated;
grant select on public.provider_sale_evidence_review_history to authenticated;
drop policy if exists "Admins can read provider evidence review history" on public.provider_sale_evidence_review_history;
create policy "Admins can read provider evidence review history"
on public.provider_sale_evidence_review_history for select to authenticated
using ((select private.current_app_role())='admin');

-- Admin dispositions survive every later provider re-sync. The two automatic
-- materializers must not turn denied or held evidence into a ranked sale.
do $$
declare
  v_definition text;
  v_updated text;
begin
  select pg_get_functiondef('private.materialize_authoritative_provider_ranking()'::regprocedure)
  into v_definition;
  v_updated:=replace(
    v_definition,
    'if new.evidence_scope <> ''dealer_account'' or new.materialized_sale_id is not null then return new; end if;',
    'if new.evidence_scope <> ''dealer_account'' or new.materialized_sale_id is not null or new.admin_evidence_disposition is not null then return new; end if;'
  );
  if v_updated=v_definition then raise exception 'authoritative_materializer_guard_not_applied'; end if;
  execute v_updated;

  select pg_get_functiondef('private.materialize_rep_provider_ranking()'::regprocedure)
  into v_definition;
  v_updated:=replace(
    v_definition,
    'if new.evidence_scope<>''rep_account'' or new.materialized_sale_id is not null then return new; end if;',
    'if new.evidence_scope<>''rep_account'' or new.materialized_sale_id is not null or new.admin_evidence_disposition is not null then return new; end if;'
  );
  if v_updated=v_definition then raise exception 'rep_materializer_guard_not_applied'; end if;
  execute v_updated;
end $$;

alter table public.provider_sales_rows drop constraint if exists provider_sales_rows_materialization_status_check;
alter table public.provider_sales_rows add constraint provider_sales_rows_materialization_status_check check(materialization_status in(
  'pending','linked_existing_sale','created_pending_review','unmatched_seller','unmatched_capture','ambiguous_capture',
  'provider_cancelled','provider_abandoned','not_completed','seller_mismatch_review','ambiguous_seller_review',
  'linked_cancelled_ranking_retained','linked_existing_ranking_verified','created_cancelled_ranking_retained',
  'created_ranking_only_unmatched_capture','created_ranking_verified_accounting_review',
  'linked_rep_ranking_verified','created_rep_ranking_only','created_rep_cancelled_ranking_retained',
  'admin_created_verified','admin_linked_verified_duplicate'
));

create or replace function public.admin_set_provider_evidence_disposition(
  p_provider_sale_row_id uuid,
  p_disposition text,
  p_reason text
)
returns public.provider_sales_rows
language plpgsql
security definer
set search_path=pg_catalog,public,auth,private
as $$
declare
  v_actor uuid:=auth.uid();
  v_actor_email text;
  v_before public.provider_sales_rows%rowtype;
  v_row public.provider_sales_rows%rowtype;
  v_disposition text:=lower(trim(coalesce(p_disposition,'')));
begin
  if v_actor is null then raise exception 'Authentication required'; end if;
  select lower(u.email) into v_actor_email
  from auth.users u join public.app_user_access a on lower(a.email)=lower(u.email)
  where u.id=v_actor and a.active=true and lower(a.role)='admin';
  if v_actor_email is null then raise exception 'Admin access required'; end if;
  if v_disposition not in ('unverified','not_a_sale','restore') then
    raise exception 'Choose UNVERIFIED, NOT A SALE, or RESTORE';
  end if;
  if nullif(trim(coalesce(p_reason,'')),'') is null then raise exception 'An evidence review reason is required'; end if;

  select * into v_before from public.provider_sales_rows where id=p_provider_sale_row_id for update;
  if not found then raise exception 'Provider evidence not found'; end if;
  if v_before.materialized_sale_id is not null then
    raise exception 'This evidence is already linked to a McCoy sale; use the verified Sale Credit controls';
  end if;
  if lower(coalesce(v_before.provider_status,'')) ~ '(abandon|cancel)' then
    raise exception 'ABANDONED and CANCELLED evidence is excluded and cannot be reviewed as a sale';
  end if;
  if v_disposition='restore' and v_before.admin_evidence_disposition is null then
    raise exception 'Provider evidence has no Admin decision to restore';
  end if;

  update public.provider_sales_rows set
    admin_evidence_disposition=case when v_disposition='restore' then null else v_disposition end,
    admin_evidence_reason=trim(p_reason),
    admin_evidence_reviewed_by=v_actor,
    admin_evidence_reviewed_at=now()
  where id=p_provider_sale_row_id
  returning * into v_row;

  insert into public.provider_sale_evidence_review_history(
    provider_sale_row_id,changed_by,changed_by_email,action,
    previous_disposition,new_disposition,reason
  ) values (
    p_provider_sale_row_id,v_actor,v_actor_email,v_disposition,
    v_before.admin_evidence_disposition,v_row.admin_evidence_disposition,trim(p_reason)
  );
  return v_row;
end;
$$;
revoke all on function public.admin_set_provider_evidence_disposition(uuid,text,text) from public,anon;
grant execute on function public.admin_set_provider_evidence_disposition(uuid,text,text) to authenticated;

create or replace function public.admin_assign_provider_evidence(
  p_provider_sale_row_id uuid,
  p_rep_email text,
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
  v_provider public.provider_sales_rows%rowtype;
  v_target_id uuid;
  v_target_email text;
  v_target_name text;
  v_sale public.sales_records%rowtype;
  v_customer text;
  v_first text;
  v_last text;
  v_install_date date;
  v_order_date date;
  v_missing text[]:='{}'::text[];
  v_reason text:=trim(coalesce(p_reason,''));
begin
  if v_actor is null then raise exception 'Authentication required'; end if;
  select lower(u.email) into v_actor_email
  from auth.users u join public.app_user_access a on lower(a.email)=lower(u.email)
  where u.id=v_actor and a.active=true and lower(a.role)='admin';
  if v_actor_email is null then raise exception 'Admin access required'; end if;
  if v_reason='' then raise exception 'An assignment reason is required'; end if;

  select u.id,lower(u.email),coalesce(nullif(trim(a.display_name),''),split_part(u.email,'@',1))
  into v_target_id,v_target_email,v_target_name
  from auth.users u join public.app_user_access a on lower(a.email)=lower(u.email)
  where lower(u.email)=lower(trim(coalesce(p_rep_email,''))) and a.active=true
  limit 1;
  if v_target_id is null then raise exception 'Target user must have active McCoy access'; end if;

  select * into v_provider from public.provider_sales_rows where id=p_provider_sale_row_id for update;
  if not found then raise exception 'Provider evidence not found'; end if;
  if v_provider.materialized_sale_id is not null then raise exception 'Provider evidence is already linked to a McCoy sale'; end if;
  if v_provider.admin_evidence_disposition='not_a_sale' then
    raise exception 'Evidence is locked as NOT A SALE. Restore the evidence decision before assigning it';
  end if;
  if lower(coalesce(v_provider.provider_status,'')) ~ '(abandon|cancel)' then
    raise exception 'ABANDONED and CANCELLED provider evidence cannot be assigned';
  end if;
  if lower(coalesce(v_provider.provider_status,'')) !~ '(completed|fulfilled|active|submitted|provider in process)' then
    raise exception 'Provider status is not an accepted sale state';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    lower(trim(coalesce(v_provider.provider,'')))||'|'||
    lower(trim(coalesce(v_provider.order_number,v_provider.account_number,v_provider.id::text,''))),0
  ));

  v_customer:=regexp_replace(trim(coalesce(v_provider.customer_name,'')),'\s+',' ','g');
  v_first:=nullif(split_part(v_customer,' ',1),'');
  v_last:=nullif(trim(substr(v_customer,length(coalesce(v_first,''))+1)),'');
  v_install_date:=coalesce(
    private.safe_provider_date(v_provider.raw_payload->>'Order Due Date'),
    private.safe_provider_date(v_provider.raw_payload->>'Due Date'),
    private.safe_provider_date(v_provider.raw_payload->>'Install Date')
  );
  v_order_date:=(v_provider.sale_date at time zone 'America/Los_Angeles')::date;

  if nullif(trim(coalesce(v_provider.order_number,'')),'') is null then v_missing:=array_append(v_missing,'order_number'); end if;
  if v_first is null then v_missing:=array_append(v_missing,'customer_first_name'); end if;
  if v_last is null then v_missing:=array_append(v_missing,'customer_last_name'); end if;
  if nullif(trim(coalesce(v_provider.service_address,'')),'') is null then v_missing:=array_append(v_missing,'service_address'); end if;
  if v_install_date is null then v_missing:=array_append(v_missing,'install_date'); end if;
  if v_order_date is null then v_missing:=array_append(v_missing,'order_date'); end if;
  if cardinality(v_missing)>0 then
    raise exception 'Cannot assign: missing required provider evidence: %',array_to_string(v_missing,', ');
  end if;

  select s.* into v_sale
  from public.sales_records s
  where lower(trim(s.isp))=lower(trim(v_provider.provider)) and (
    (nullif(trim(v_provider.order_number),'') is not null and private.provider_identity_key(s.provider_order_number)=private.provider_identity_key(v_provider.order_number)) or
    (nullif(trim(v_provider.account_number),'') is not null and private.provider_identity_key(s.provider_account_number)=private.provider_identity_key(v_provider.account_number))
  )
  order by s.created_at desc limit 1 for update;

  if v_sale.id is null then
    insert into public.sales_records(
      rep_user_id,rep_email,rep_name,lead_label,customer_first_name,customer_last_name,
      service_address,isp,internet_product,provider_order_number,provider_account_number,
      sale_status,verification_status,verification_reason,verified_at,provider_sale_row_id,
      competition_eligible,ranking_eligible,ranking_verified_at,
      provider_reported_rep_email,provider_reported_rep_name,
      install_date,order_date,compensation_snapshot,notes
    ) values (
      v_target_id,v_target_email,v_target_name,v_provider.service_address,v_first,v_last,
      v_provider.service_address,v_provider.provider,
      coalesce(nullif(v_provider.raw_payload->>'Internet Product Name',''),'Fiber'),
      v_provider.order_number,v_provider.account_number,
      'reported','pending_verification','admin_provider_evidence_assignment_pending',null,v_provider.id,
      false,false,null,v_provider.seller_email,v_provider.seller_name,
      v_install_date,v_order_date,
      jsonb_build_object(
        'sale_origin','admin_assigned_provider_evidence',
        'provider_evidence_scope',v_provider.evidence_scope,
        'provider_evidence_row_id',v_provider.id,
        'original_provider_seller',coalesce(v_provider.seller_name,v_provider.seller_email,v_provider.seller_identifier),
        'accounting_review_required',false
      ),
      'Admin assigned one unassigned provider evidence row; the provider source record was preserved.'
    ) returning * into v_sale;
  else
    update public.sales_records set
      provider_order_number=coalesce(nullif(trim(provider_order_number),''),v_provider.order_number),
      provider_account_number=coalesce(nullif(trim(provider_account_number),''),v_provider.account_number),
      customer_first_name=case when lower(trim(customer_first_name))='unknown' then v_first else customer_first_name end,
      customer_last_name=case when lower(trim(customer_last_name))='unknown' then v_last else customer_last_name end,
      service_address=coalesce(nullif(trim(service_address),''),v_provider.service_address),
      install_date=coalesce(install_date,v_install_date),
      order_date=coalesce(order_date,v_order_date)
    where id=v_sale.id returning * into v_sale;
  end if;

  select * into v_sale
  from public.admin_apply_sale_credit(v_sale.id,v_target_email,
    'Assigned from unassigned provider evidence: '||v_reason);

  update public.provider_sales_rows set
    materialized_sale_id=v_sale.id,
    materialization_status=case when v_sale.provider_sale_row_id=v_provider.id then 'admin_created_verified' else 'admin_linked_verified_duplicate' end,
    materialization_reason='Admin assigned this individual provider evidence row to '||v_target_email||' and approved rankings/pay eligibility.',
    materialized_at=now(),
    admin_evidence_disposition=null,
    admin_evidence_reason=v_reason,
    admin_evidence_reviewed_by=v_actor,
    admin_evidence_reviewed_at=now()
  where id=v_provider.id;

  insert into public.provider_sale_evidence_review_history(
    provider_sale_row_id,sale_id,changed_by,changed_by_email,action,
    previous_disposition,new_disposition,assigned_rep_user_id,assigned_rep_email,assigned_rep_name,reason
  ) values (
    v_provider.id,v_sale.id,v_actor,v_actor_email,'assigned_approved',
    v_provider.admin_evidence_disposition,null,v_target_id,v_target_email,v_target_name,v_reason
  );
  return v_sale;
end;
$$;
revoke all on function public.admin_assign_provider_evidence(uuid,text,text) from public,anon;
grant execute on function public.admin_assign_provider_evidence(uuid,text,text) to authenticated;

create or replace function public.admin_unassigned_sales_bank()
returns jsonb
language plpgsql
stable
security definer
set search_path=pg_catalog,public,auth,private
as $$
declare
  v_actor uuid:=auth.uid();
  v_rows jsonb;
  v_count integer;
  v_incomplete jsonb;
  v_incomplete_count integer;
  v_denied jsonb;
  v_denied_count integer;
begin
  if v_actor is null or not exists(
    select 1 from auth.users u join public.app_user_access a on lower(a.email)=lower(u.email)
    where u.id=v_actor and a.active=true and lower(a.role)='admin'
  ) then raise exception 'Admin access required'; end if;

  select count(*)::int into v_count
  from public.provider_sales_rows p
  where p.materialized_sale_id is null
    and p.admin_evidence_disposition is distinct from 'not_a_sale'
    and lower(coalesce(p.provider_status,'')) !~ '(abandon|cancel)'
    and lower(coalesce(p.provider_status,'')) ~ '(completed|fulfilled|active|submitted|provider in process)';

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',q.id,'provider',q.provider,'order_number',q.order_number,'account_number',q.account_number,
    'seller_identifier',q.seller_identifier,'seller_name',q.seller_name,'seller_email',q.seller_email,
    'customer_name',q.customer_name,'service_address',q.service_address,'sale_date',q.sale_date,
    'provider_status',q.provider_status,'evidence_scope',q.evidence_scope,'raw_payload',q.raw_payload,
    'source_rep_email',q.source_rep_email,'cross_reference_status',q.cross_reference_status,
    'materialization_status',q.materialization_status,'materialization_reason',q.materialization_reason,
    'admin_evidence_disposition',q.admin_evidence_disposition,
    'admin_evidence_reason',q.admin_evidence_reason,
    'admin_evidence_reviewed_at',q.admin_evidence_reviewed_at,
    'review_history',coalesce((select jsonb_agg(to_jsonb(h) order by h.created_at desc)
      from public.provider_sale_evidence_review_history h where h.provider_sale_row_id=q.id),'[]'::jsonb),
    'why_considered_sale',case
      when lower(coalesce(q.provider_status,'')) like '%completed%' then 'Provider status reports a completed order.'
      when lower(coalesce(q.provider_status,'')) like '%provider in process%' then 'Provider reports the order is still in process.'
      when lower(coalesce(q.provider_status,'')) like '%submitted%' then 'Provider status reports a submitted order.'
      when lower(coalesce(q.provider_status,'')) like '%fulfilled%' then 'Provider status reports a fulfilled order.'
      when lower(coalesce(q.provider_status,'')) like '%active%' then 'Provider status reports an active account.'
      else 'Provider status matches an accepted sale-state pattern.' end
  ) order by q.sale_date desc nulls last,q.created_at desc),'[]'::jsonb) into v_rows
  from(
    select p.* from public.provider_sales_rows p
    where p.materialized_sale_id is null
      and p.admin_evidence_disposition is distinct from 'not_a_sale'
      and lower(coalesce(p.provider_status,'')) !~ '(abandon|cancel)'
      and lower(coalesce(p.provider_status,'')) ~ '(completed|fulfilled|active|submitted|provider in process)'
    order by p.sale_date desc nulls last,p.created_at desc limit 2000
  ) q;

  select count(*)::int into v_incomplete_count
  from public.sales_records s where s.required_metrics_complete is not true and s.sale_status<>'not_a_sale';
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',s.id,'created_at',s.created_at,'rep_name',s.rep_name,'rep_email',s.rep_email,
    'provider',s.isp,'order_number',s.provider_order_number,
    'customer_name',trim(s.customer_first_name||' '||s.customer_last_name),
    'service_address',s.service_address,'install_date',s.install_date,'order_date',s.order_date,
    'missing',s.required_metrics_missing,'verification_status',s.verification_status
  ) order by s.created_at desc),'[]'::jsonb) into v_incomplete
  from public.sales_records s where s.required_metrics_complete is not true and s.sale_status<>'not_a_sale';

  select count(*)::int into v_denied_count
  from public.provider_sales_rows p
  where p.materialized_sale_id is null and p.admin_evidence_disposition='not_a_sale';
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',p.id,'provider',p.provider,'order_number',p.order_number,'account_number',p.account_number,
    'seller_identifier',p.seller_identifier,'seller_name',p.seller_name,'seller_email',p.seller_email,
    'customer_name',p.customer_name,'service_address',p.service_address,'sale_date',p.sale_date,
    'provider_status',p.provider_status,'evidence_scope',p.evidence_scope,
    'admin_evidence_disposition',p.admin_evidence_disposition,
    'admin_evidence_reason',p.admin_evidence_reason,
    'admin_evidence_reviewed_at',p.admin_evidence_reviewed_at,
    'review_history',coalesce((select jsonb_agg(to_jsonb(h) order by h.created_at desc)
      from public.provider_sale_evidence_review_history h where h.provider_sale_row_id=p.id),'[]'::jsonb)
  ) order by p.admin_evidence_reviewed_at desc nulls last,p.created_at desc),'[]'::jsonb)
  into v_denied
  from public.provider_sales_rows p
  where p.materialized_sale_id is null and p.admin_evidence_disposition='not_a_sale';

  return jsonb_build_object(
    'ok',true,'count',v_count,'rows',v_rows,
    'incomplete_count',v_incomplete_count,'incomplete_sales',v_incomplete,
    'denied_count',v_denied_count,'denied_rows',v_denied,
    'excluded_statuses',jsonb_build_array('ABANDONED','CANCELLED'),
    'denied_rows_retained',true
  );
end;
$$;
revoke all on function public.admin_unassigned_sales_bank() from public,anon;
grant execute on function public.admin_unassigned_sales_bank() to authenticated;
