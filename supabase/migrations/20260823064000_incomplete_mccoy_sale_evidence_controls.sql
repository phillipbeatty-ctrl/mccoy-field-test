-- Give incomplete McCoy sale evidence the same Admin review path as provider
-- evidence while preserving the original record and every correction.
create table if not exists public.sale_incomplete_evidence_history(
  id bigint generated always as identity primary key,
  sale_id uuid not null references public.sales_records(id) on delete restrict,
  changed_by uuid not null references auth.users(id) on delete restrict,
  changed_by_email text not null,
  assigned_rep_user_id uuid not null references auth.users(id) on delete restrict,
  assigned_rep_email text not null,
  assigned_rep_name text not null,
  previous_evidence jsonb not null,
  corrected_evidence jsonb not null,
  reason text not null,
  created_at timestamptz not null default now()
);

create index if not exists sale_incomplete_evidence_history_sale_created_idx
  on public.sale_incomplete_evidence_history(sale_id,created_at desc);

alter table public.sale_incomplete_evidence_history enable row level security;
revoke all on public.sale_incomplete_evidence_history from anon;
revoke insert,update,delete,truncate on public.sale_incomplete_evidence_history from authenticated;
grant select on public.sale_incomplete_evidence_history to authenticated;

drop policy if exists "Admins can read incomplete sale evidence history"
  on public.sale_incomplete_evidence_history;
create policy "Admins can read incomplete sale evidence history"
on public.sale_incomplete_evidence_history for select to authenticated
using ((select private.current_app_role())='admin');

create or replace function public.admin_resolve_incomplete_sale_evidence(
  p_sale_id uuid,
  p_rep_email text,
  p_order_number text,
  p_customer_first_name text,
  p_customer_last_name text,
  p_service_address text,
  p_install_date date,
  p_order_date date,
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
  v_before public.sales_records%rowtype;
  v_corrected public.sales_records%rowtype;
  v_sale public.sales_records%rowtype;
  v_target_id uuid;
  v_target_email text;
  v_target_name text;
  v_reason text:=trim(coalesce(p_reason,''));
begin
  if v_actor is null then raise exception 'Authentication required'; end if;
  select lower(u.email) into v_actor_email
  from auth.users u join public.app_user_access a on lower(a.email)=lower(u.email)
  where u.id=v_actor and a.active=true and lower(a.role)='admin';
  if v_actor_email is null then raise exception 'Admin access required'; end if;
  if v_reason='' then raise exception 'An evidence correction reason is required'; end if;

  select u.id,lower(u.email),coalesce(nullif(trim(a.display_name),''),split_part(u.email,'@',1))
  into v_target_id,v_target_email,v_target_name
  from auth.users u join public.app_user_access a on lower(a.email)=lower(u.email)
  where lower(u.email)=lower(trim(coalesce(p_rep_email,''))) and a.active=true
  limit 1;
  if v_target_id is null then raise exception 'Target user must have active McCoy access'; end if;

  select * into v_before
  from public.sales_records
  where id=p_sale_id
  for update;
  if not found then raise exception 'McCoy sale evidence not found'; end if;
  if v_before.required_metrics_complete is true then
    raise exception 'This record is already complete; use the standard Sale Credit controls';
  end if;
  if v_before.sale_status='not_a_sale' or v_before.admin_review_disposition='not_a_sale' then
    raise exception 'This evidence is locked as NOT A SALE. Restore the Admin review decision first';
  end if;

  update public.sales_records set
    provider_order_number=nullif(trim(coalesce(p_order_number,'')),''),
    customer_first_name=coalesce(nullif(trim(coalesce(p_customer_first_name,'')),''),''),
    customer_last_name=coalesce(nullif(trim(coalesce(p_customer_last_name,'')),''),''),
    service_address=coalesce(nullif(trim(coalesce(p_service_address,'')),''),''),
    install_date=p_install_date,
    order_date=p_order_date
  where id=p_sale_id
  returning * into v_corrected;

  if v_corrected.required_metrics_complete is not true then
    raise exception 'Cannot approve: missing required sale data: %',
      array_to_string(v_corrected.required_metrics_missing,', ');
  end if;

  select * into v_sale
  from public.admin_apply_sale_credit(p_sale_id,v_target_email,
    'Incomplete McCoy evidence corrected: '||v_reason);

  insert into public.sale_incomplete_evidence_history(
    sale_id,changed_by,changed_by_email,
    assigned_rep_user_id,assigned_rep_email,assigned_rep_name,
    previous_evidence,corrected_evidence,reason
  ) values (
    p_sale_id,v_actor,v_actor_email,
    v_target_id,v_target_email,v_target_name,
    jsonb_build_object(
      'provider_order_number',v_before.provider_order_number,
      'customer_first_name',v_before.customer_first_name,
      'customer_last_name',v_before.customer_last_name,
      'service_address',v_before.service_address,
      'install_date',v_before.install_date,
      'order_date',v_before.order_date,
      'rep_user_id',v_before.rep_user_id,
      'rep_email',v_before.rep_email,
      'rep_name',v_before.rep_name,
      'required_metrics_missing',v_before.required_metrics_missing
    ),
    jsonb_build_object(
      'provider_order_number',v_sale.provider_order_number,
      'customer_first_name',v_sale.customer_first_name,
      'customer_last_name',v_sale.customer_last_name,
      'service_address',v_sale.service_address,
      'install_date',v_sale.install_date,
      'order_date',v_sale.order_date,
      'rep_user_id',v_sale.rep_user_id,
      'rep_email',v_sale.rep_email,
      'rep_name',v_sale.rep_name,
      'required_metrics_missing',v_sale.required_metrics_missing,
      'verification_status',v_sale.verification_status,
      'ranking_eligible',v_sale.ranking_eligible,
      'competition_eligible',v_sale.competition_eligible
    ),
    v_reason
  );
  return v_sale;
end;
$$;

revoke all on function public.admin_resolve_incomplete_sale_evidence(
  uuid,text,text,text,text,text,date,date,text
) from public,anon;
grant execute on function public.admin_resolve_incomplete_sale_evidence(
  uuid,text,text,text,text,text,date,date,text
) to authenticated;

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
  from public.sales_records s
  where s.required_metrics_complete is not true and s.sale_status<>'not_a_sale';

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',s.id,'created_at',s.created_at,
    'rep_user_id',s.rep_user_id,'rep_name',s.rep_name,'rep_email',s.rep_email,
    'provider',s.isp,'order_number',s.provider_order_number,
    'customer_first_name',s.customer_first_name,'customer_last_name',s.customer_last_name,
    'customer_name',trim(s.customer_first_name||' '||s.customer_last_name),
    'service_address',s.service_address,'install_date',s.install_date,'order_date',s.order_date,
    'missing',s.required_metrics_missing,'verification_status',s.verification_status,
    'sale_status',s.sale_status,'admin_review_disposition',s.admin_review_disposition,
    'admin_review_reason',s.admin_review_reason,'provider_sale_row_id',s.provider_sale_row_id,
    'review_history',coalesce((select jsonb_agg(to_jsonb(h) order by h.created_at desc)
      from public.sale_review_disposition_history h where h.sale_id=s.id),'[]'::jsonb),
    'evidence_history',coalesce((select jsonb_agg(to_jsonb(h) order by h.created_at desc)
      from public.sale_incomplete_evidence_history h where h.sale_id=s.id),'[]'::jsonb)
  ) order by s.created_at desc),'[]'::jsonb) into v_incomplete
  from public.sales_records s
  where s.required_metrics_complete is not true and s.sale_status<>'not_a_sale';

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
