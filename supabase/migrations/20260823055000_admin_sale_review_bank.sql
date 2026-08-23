-- Admin sale disposition review and an evidence bank for unassigned provider sales.
alter table public.sales_records
  add column if not exists admin_review_disposition text,
  add column if not exists admin_review_reason text,
  add column if not exists admin_reviewed_by uuid references auth.users(id) on delete set null,
  add column if not exists admin_reviewed_at timestamptz;

alter table public.sales_records
  drop constraint if exists sales_records_admin_review_disposition_check,
  add constraint sales_records_admin_review_disposition_check
    check (admin_review_disposition is null or admin_review_disposition in ('unverified','not_a_sale'));

alter table public.sales_records
  drop constraint if exists sales_records_sale_status_check,
  add constraint sales_records_sale_status_check
    check (sale_status in ('reported','qualified','installed','cancelled','charged_back','not_a_sale'));

create table if not exists public.sale_review_disposition_history(
  id bigint generated always as identity primary key,
  sale_id uuid not null references public.sales_records(id) on delete cascade,
  changed_by uuid not null references auth.users(id) on delete restrict,
  changed_by_email text not null,
  previous_disposition text,
  new_disposition text,
  previous_verification_status text not null,
  new_verification_status text not null,
  previous_sale_status text not null,
  new_sale_status text not null,
  previous_ranking_eligible boolean not null,
  new_ranking_eligible boolean not null,
  reason text not null,
  created_at timestamptz not null default now()
);
create index if not exists sale_review_disposition_history_sale_created_idx
  on public.sale_review_disposition_history(sale_id, created_at desc);
alter table public.sale_review_disposition_history enable row level security;
revoke all on public.sale_review_disposition_history from anon;
revoke insert, update, delete, truncate on public.sale_review_disposition_history from authenticated;
grant select on public.sale_review_disposition_history to authenticated;
drop policy if exists "Admins can read sale review history" on public.sale_review_disposition_history;
create policy "Admins can read sale review history"
on public.sale_review_disposition_history for select to authenticated
using ((select private.current_app_role()) = 'admin');

create or replace function private.enforce_admin_sale_review_lock()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if old.admin_review_disposition in ('unverified','not_a_sale')
     and new.admin_review_disposition = old.admin_review_disposition then
    new.ranking_eligible := false;
    new.competition_eligible := false;
    new.ranking_verified_at := null;
    if old.admin_review_disposition = 'unverified' then
      new.verification_status := 'admin_unverified';
    else
      new.verification_status := 'not_a_sale';
      new.sale_status := 'not_a_sale';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.enforce_admin_sale_review_lock() from public, anon, authenticated;
drop trigger if exists sales_records_admin_review_lock on public.sales_records;
create trigger sales_records_admin_review_lock
before update on public.sales_records
for each row execute function private.enforce_admin_sale_review_lock();

create or replace function public.admin_set_sale_review_disposition(
  p_sale_id uuid,
  p_disposition text,
  p_reason text
)
returns public.sales_records
language plpgsql
security definer
set search_path = pg_catalog, public, auth, private
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_email text;
  v_sale public.sales_records%rowtype;
  v_before public.sales_records%rowtype;
  v_disposition text := lower(trim(coalesce(p_disposition,'')));
  v_provider_status text;
  v_restore_verified boolean := false;
  v_outside_approved boolean := false;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;
  select lower(u.email) into v_actor_email
  from auth.users u join public.app_user_access a on lower(a.email)=lower(u.email)
  where u.id=v_actor and a.active=true and lower(a.role)='admin';
  if v_actor_email is null then raise exception 'Admin access required'; end if;
  if v_disposition not in ('unverified','not_a_sale','restore') then raise exception 'Invalid sale review disposition'; end if;
  if nullif(trim(coalesce(p_reason,'')),'') is null then raise exception 'A review reason is required'; end if;

  select * into v_sale from public.sales_records where id=p_sale_id for update;
  if not found then raise exception 'Sale not found'; end if;
  v_before := v_sale;

  if v_disposition = 'unverified' then
    update public.sales_records set
      admin_review_disposition='unverified', admin_review_reason=trim(p_reason),
      admin_reviewed_by=v_actor, admin_reviewed_at=now(),
      verification_status='admin_unverified', verification_reason='admin_marked_unverified: '||trim(p_reason),
      ranking_eligible=false, competition_eligible=false, ranking_verified_at=null
    where id=p_sale_id returning * into v_sale;
  elsif v_disposition = 'not_a_sale' then
    update public.sales_records set
      admin_review_disposition='not_a_sale', admin_review_reason=trim(p_reason),
      admin_reviewed_by=v_actor, admin_reviewed_at=now(),
      sale_status='not_a_sale', verification_status='not_a_sale',
      verification_reason='admin_marked_not_a_sale: '||trim(p_reason),
      ranking_eligible=false, competition_eligible=false, ranking_verified_at=null
    where id=p_sale_id returning * into v_sale;
  else
    select lower(coalesce(p.provider_status,'')) into v_provider_status
    from public.provider_sales_rows p where p.id=v_sale.provider_sale_row_id;
    v_restore_verified := v_sale.provider_sale_row_id is not null
      and coalesce(v_provider_status,'') !~ '(abandon|cancel)'
      and coalesce(v_provider_status,'') ~ '(completed|fulfilled|active|submitted|provider in process)';
    v_outside_approved := coalesce(v_sale.compensation_snapshot->>'sale_origin','') <> 'outside_system'
      or lower(coalesce(v_sale.compensation_snapshot#>>'{admin_approval,status}',''))='approved';
    update public.sales_records set
      admin_review_disposition=null, admin_review_reason=trim(p_reason),
      admin_reviewed_by=v_actor, admin_reviewed_at=now(),
      sale_status=case when sale_status='not_a_sale' then 'reported' else sale_status end,
      verification_status=case when v_restore_verified then 'verified_processed' else 'pending_verification' end,
      verification_reason=case when v_restore_verified then 'admin_restored_provider_decision' else 'admin_restored_pending_provider_verification' end,
      ranking_eligible=v_restore_verified and v_outside_approved,
      competition_eligible=v_restore_verified and v_outside_approved and sale_status<>'cancelled',
      ranking_verified_at=case when v_restore_verified and v_outside_approved then coalesce(ranking_verified_at,verified_at,now()) else null end
    where id=p_sale_id returning * into v_sale;
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
revoke all on function public.admin_set_sale_review_disposition(uuid,text,text) from public, anon;
grant execute on function public.admin_set_sale_review_disposition(uuid,text,text) to authenticated;

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
    order by p.sale_date desc nulls last, p.created_at desc
    limit 2000
  ) q;
  return jsonb_build_object('ok',true,'count',v_count,'rows',v_rows,'excluded_statuses',jsonb_build_array('ABANDONED','CANCELLED'));
end;
$$;
revoke all on function public.admin_unassigned_sales_bank() from public, anon;
grant execute on function public.admin_unassigned_sales_bank() to authenticated;

