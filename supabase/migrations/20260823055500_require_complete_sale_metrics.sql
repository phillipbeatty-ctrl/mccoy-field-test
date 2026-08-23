-- Required sale metrics are an eligibility gate. Incomplete evidence is preserved for Admin review.
alter table public.sales_records
  add column if not exists order_date date,
  add column if not exists required_metrics_complete boolean not null default false,
  add column if not exists required_metrics_missing text[] not null default '{}'::text[];

create or replace function private.safe_provider_date(p_value text)
returns date
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare v text := trim(coalesce(p_value,''));
begin
  if v = '' then return null; end if;
  if v ~ '^\d{4}-\d{2}-\d{2}' then return left(v,10)::date; end if;
  if v ~ '^\d{1,2}/\d{1,2}/\d{4}' then return to_date(split_part(v,' ',1),'MM/DD/YYYY'); end if;
  return null;
exception when others then return null;
end;
$$;
revoke all on function private.safe_provider_date(text) from public, anon, authenticated;

-- Use the authoritative provider row to fill historical data where the export supplied it.
update public.sales_records s
set provider_order_number = coalesce(nullif(trim(s.provider_order_number),''), nullif(trim(p.order_number),'')),
    order_date = coalesce(s.order_date, (p.sale_date at time zone 'America/Los_Angeles')::date),
    install_date = coalesce(
      s.install_date,
      private.safe_provider_date(p.raw_payload->>'Order Due Date'),
      private.safe_provider_date(p.raw_payload->>'Due Date')
    )
from public.provider_sales_rows p
where p.id = s.provider_sale_row_id;

-- Pre-existing McCoy submissions receive their recorded submission date as the historical order date.
-- Future McCoy submissions must supply order_date explicitly through sale-submit.
update public.sales_records
set order_date = (created_at at time zone 'America/Los_Angeles')::date
where order_date is null
  and coalesce(compensation_snapshot->>'sale_origin','') in ('mccoy_app','outside_system');

create or replace function private.enforce_sale_required_metrics()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_provider_date date;
  v_provider_install date;
  v_provider_order text;
  v_missing text[] := '{}'::text[];
begin
  if new.provider_sale_row_id is not null and (new.order_date is null or new.install_date is null or nullif(trim(new.provider_order_number),'') is null) then
    select
      (p.sale_date at time zone 'America/Los_Angeles')::date,
      coalesce(private.safe_provider_date(p.raw_payload->>'Order Due Date'),private.safe_provider_date(p.raw_payload->>'Due Date'))
    into v_provider_date,v_provider_install
    from public.provider_sales_rows p where p.id=new.provider_sale_row_id;
    new.order_date := coalesce(new.order_date,v_provider_date);
    new.install_date := coalesce(new.install_date,v_provider_install);
    if nullif(trim(new.provider_order_number),'') is null then
      select nullif(trim(p.order_number),'') into v_provider_order
      from public.provider_sales_rows p where p.id=new.provider_sale_row_id;
      new.provider_order_number := v_provider_order;
    end if;
  end if;

  if nullif(trim(coalesce(new.provider_order_number,'')),'') is null then v_missing:=array_append(v_missing,'order_number'); end if;
  if nullif(trim(coalesce(new.customer_first_name,'')),'') is null or lower(trim(new.customer_first_name))='unknown' then v_missing:=array_append(v_missing,'customer_first_name'); end if;
  if nullif(trim(coalesce(new.customer_last_name,'')),'') is null or lower(trim(new.customer_last_name))='unknown' then v_missing:=array_append(v_missing,'customer_last_name'); end if;
  if nullif(trim(coalesce(new.service_address,'')),'') is null then v_missing:=array_append(v_missing,'service_address'); end if;
  if new.install_date is null then v_missing:=array_append(v_missing,'install_date'); end if;
  if new.order_date is null then v_missing:=array_append(v_missing,'order_date'); end if;

  new.required_metrics_missing := v_missing;
  new.required_metrics_complete := cardinality(v_missing)=0;
  if not new.required_metrics_complete then
    new.ranking_eligible := false;
    new.competition_eligible := false;
    new.ranking_verified_at := null;
  end if;
  return new;
end;
$$;
revoke all on function private.enforce_sale_required_metrics() from public, anon, authenticated;

drop trigger if exists sales_records_required_metrics on public.sales_records;
create trigger sales_records_required_metrics
before insert or update of provider_order_number,customer_first_name,customer_last_name,
  service_address,install_date,order_date,provider_sale_row_id,ranking_eligible,competition_eligible
on public.sales_records
for each row execute function private.enforce_sale_required_metrics();

-- Re-evaluate every existing row once. The trigger removes incomplete rows from ranking eligibility.
update public.sales_records set order_date=order_date;

create or replace function public.admin_unassigned_sales_bank()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth, private
as $$
declare
  v_actor uuid := auth.uid();
  v_rows jsonb;
  v_count integer;
  v_incomplete jsonb;
  v_incomplete_count integer;
begin
  if v_actor is null or not exists (
    select 1 from auth.users u join public.app_user_access a on lower(a.email)=lower(u.email)
    where u.id=v_actor and a.active=true and lower(a.role)='admin'
  ) then raise exception 'Admin access required'; end if;

  select count(*)::int into v_count
  from public.provider_sales_rows p
  where p.materialized_sale_id is null
    and lower(coalesce(p.provider_status,'')) !~ '(abandon|cancel)'
    and lower(coalesce(p.provider_status,'')) ~ '(completed|fulfilled|active|submitted|provider in process)';

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',q.id,'provider',q.provider,'order_number',q.order_number,'account_number',q.account_number,
    'seller_identifier',q.seller_identifier,'seller_name',q.seller_name,'seller_email',q.seller_email,
    'customer_name',q.customer_name,'service_address',q.service_address,'sale_date',q.sale_date,
    'provider_status',q.provider_status,'evidence_scope',q.evidence_scope,
    'source_rep_email',q.source_rep_email,'cross_reference_status',q.cross_reference_status,
    'materialization_status',q.materialization_status,'materialization_reason',q.materialization_reason,
    'why_considered_sale',case
      when lower(coalesce(q.provider_status,'')) like '%completed%' then 'Provider status reports a completed order.'
      when lower(coalesce(q.provider_status,'')) like '%provider in process%' then 'Provider reports the order is still in process.'
      when lower(coalesce(q.provider_status,'')) like '%submitted%' then 'Provider status reports a submitted order.'
      when lower(coalesce(q.provider_status,'')) like '%fulfilled%' then 'Provider status reports a fulfilled order.'
      when lower(coalesce(q.provider_status,'')) like '%active%' then 'Provider status reports an active account.'
      else 'Provider status matches an accepted sale-state pattern.' end
  ) order by q.sale_date desc nulls last, q.created_at desc),'[]'::jsonb) into v_rows
  from (
    select p.* from public.provider_sales_rows p
    where p.materialized_sale_id is null
      and lower(coalesce(p.provider_status,'')) !~ '(abandon|cancel)'
      and lower(coalesce(p.provider_status,'')) ~ '(completed|fulfilled|active|submitted|provider in process)'
    order by p.sale_date desc nulls last, p.created_at desc limit 2000
  ) q;

  select count(*)::int into v_incomplete_count
  from public.sales_records s where s.required_metrics_complete is not true and s.sale_status<>'not_a_sale';
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',s.id,'created_at',s.created_at,'rep_name',s.rep_name,'rep_email',s.rep_email,
    'provider',s.isp,'order_number',s.provider_order_number,'customer_name',trim(s.customer_first_name||' '||s.customer_last_name),
    'service_address',s.service_address,'install_date',s.install_date,'order_date',s.order_date,
    'missing',s.required_metrics_missing,'verification_status',s.verification_status
  ) order by s.created_at desc),'[]'::jsonb) into v_incomplete
  from public.sales_records s where s.required_metrics_complete is not true and s.sale_status<>'not_a_sale';

  return jsonb_build_object(
    'ok',true,'count',v_count,'rows',v_rows,
    'incomplete_count',v_incomplete_count,'incomplete_sales',v_incomplete,
    'excluded_statuses',jsonb_build_array('ABANDONED','CANCELLED')
  );
end;
$$;
revoke all on function public.admin_unassigned_sales_bank() from public, anon;
grant execute on function public.admin_unassigned_sales_bank() to authenticated;

-- Paginated Admin-only source for Sale Credit. It returns the complete McCoy sale row,
-- linked ISP evidence (including its raw import payload), and both audit histories.
create or replace function public.admin_sale_credit_dashboard_page(
  p_limit integer default 100,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth, private
as $$
declare
  v_actor uuid := auth.uid();
  v_limit integer := greatest(1,least(coalesce(p_limit,100),250));
  v_offset integer := greatest(0,coalesce(p_offset,0));
  v_total integer;
  v_rows jsonb;
begin
  if v_actor is null or not exists (
    select 1
    from auth.users u
    join public.app_user_access a on lower(a.email)=lower(u.email)
    where u.id=v_actor and a.active=true and lower(a.role)='admin'
  ) then
    raise exception 'Admin access required';
  end if;

  select count(*)::integer into v_total from public.sales_records;

  select coalesce(jsonb_agg(row_data order by created_at desc),'[]'::jsonb)
  into v_rows
  from (
    select
      s.created_at,
      jsonb_build_object(
        'sale',to_jsonb(s),
        'provider_account',case when p.id is null then null else to_jsonb(p) end,
        'credit_history',coalesce((
          select jsonb_agg(to_jsonb(h) order by h.created_at desc)
          from public.sale_credit_assignment_history h
          where h.sale_id=s.id
        ),'[]'::jsonb),
        'review_history',coalesce((
          select jsonb_agg(to_jsonb(r) order by r.created_at desc)
          from public.sale_review_disposition_history r
          where r.sale_id=s.id
        ),'[]'::jsonb)
      ) as row_data
    from public.sales_records s
    left join public.provider_sales_rows p on p.id=s.provider_sale_row_id
    order by s.created_at desc
    limit v_limit offset v_offset
  ) page;

  return jsonb_build_object(
    'ok',true,
    'total_count',v_total,
    'offset',v_offset,
    'limit',v_limit,
    'rows',v_rows
  );
end;
$$;
revoke all on function public.admin_sale_credit_dashboard_page(integer,integer) from public, anon;
grant execute on function public.admin_sale_credit_dashboard_page(integer,integer) to authenticated;
