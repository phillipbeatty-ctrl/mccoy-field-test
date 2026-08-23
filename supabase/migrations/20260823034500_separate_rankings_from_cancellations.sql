-- Rankings preserve verified production. Cancellations affect accounting only.

alter table public.sales_records
  add column if not exists ranking_eligible boolean not null default false,
  add column if not exists ranking_verified_at timestamptz,
  add column if not exists commission_gross_amount numeric(12,2) not null default 0,
  add column if not exists commission_chargeback_applied numeric(12,2) not null default 0,
  add column if not exists commission_paid_amount numeric(12,2) not null default 0,
  add column if not exists commission_paid_at timestamptz,
  add column if not exists commission_paid_by uuid references auth.users(id),
  add column if not exists commission_chargeback_amount numeric(12,2) not null default 0;

update public.sales_records s
set ranking_eligible = true,
    ranking_verified_at = coalesce(s.ranking_verified_at, s.verified_at, s.created_at)
where s.verification_status = 'verified_processed'
  and s.provider_sale_row_id is not null
  and (
    coalesce(s.compensation_snapshot->>'sale_origin', '') <> 'outside_system'
    or lower(coalesce(s.compensation_snapshot#>>'{admin_approval,status}', '')) = 'approved'
  )
  and (
    coalesce(s.compensation_snapshot->>'sale_context', '') <> 'out_of_area_phone'
    or lower(coalesce(s.compensation_snapshot#>>'{admin_approval,status}', '')) = 'approved'
  );

create index if not exists sales_records_ranking_credit_idx
  on public.sales_records (ranking_verified_at, lower(rep_email))
  where ranking_eligible is true;

create table if not exists public.commission_chargebacks (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null unique references public.sales_records(id) on delete restrict,
  rep_user_id uuid references auth.users(id),
  rep_email text not null,
  original_paid_amount numeric(12,2) not null check (original_paid_amount > 0),
  remaining_amount numeric(12,2) not null check (remaining_amount >= 0),
  status text not null default 'outstanding' check (status in ('outstanding','recovered')),
  created_at timestamptz not null default now(),
  recovered_at timestamptz
);

create table if not exists public.commission_chargeback_allocations (
  id uuid primary key default gen_random_uuid(),
  chargeback_id uuid not null references public.commission_chargebacks(id) on delete restrict,
  payment_sale_id uuid not null references public.sales_records(id) on delete restrict,
  amount numeric(12,2) not null check (amount > 0),
  created_at timestamptz not null default now(),
  unique (chargeback_id, payment_sale_id)
);

alter table public.commission_chargebacks enable row level security;
alter table public.commission_chargeback_allocations enable row level security;
revoke all on public.commission_chargebacks, public.commission_chargeback_allocations from anon, authenticated;

create or replace function private.sync_cancelled_sale_chargeback()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if lower(coalesce(new.sale_status, '')) = 'cancelled' and new.commission_paid_amount > 0 then
    insert into public.commission_chargebacks(sale_id, rep_user_id, rep_email, original_paid_amount, remaining_amount)
    values(new.id, new.rep_user_id, lower(trim(new.rep_email)), new.commission_paid_amount, new.commission_paid_amount)
    on conflict (sale_id) do nothing;
    if new.commission_chargeback_amount <> new.commission_paid_amount then
      update public.sales_records set commission_chargeback_amount=new.commission_paid_amount where id=new.id;
    end if;
  elsif new.commission_chargeback_amount <> 0 then
    update public.sales_records set commission_chargeback_amount=0 where id=new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists sales_records_cancelled_chargeback on public.sales_records;
create trigger sales_records_cancelled_chargeback
after insert or update on public.sales_records
for each row execute function private.sync_cancelled_sale_chargeback();

create or replace function public.admin_record_sale_commission_payment(p_sale_id uuid, p_gross_amount numeric)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_actor uuid := (select auth.uid());
  v_email text;
  v_sale public.sales_records%rowtype;
  v_remaining numeric(12,2);
  v_applied numeric(12,2) := 0;
  v_take numeric(12,2);
  v_chargeback record;
begin
  if v_actor is null or p_gross_amount <= 0 then raise exception 'invalid_payment_request' using errcode='22023'; end if;
  select lower(trim(email)) into v_email from auth.users where id=v_actor;
  if not exists(select 1 from public.app_user_access where lower(trim(email))=v_email and active is true and role='admin') then
    raise exception 'admin_required' using errcode='42501';
  end if;
  select * into v_sale from public.sales_records where id=p_sale_id for update;
  if not found then raise exception 'sale_not_found' using errcode='P0002'; end if;
  if v_sale.commission_paid_at is not null then raise exception 'payment_already_recorded' using errcode='23505'; end if;
  v_remaining := p_gross_amount;
  for v_chargeback in
    select * from public.commission_chargebacks
    where lower(trim(rep_email))=lower(trim(v_sale.rep_email)) and remaining_amount>0
    order by created_at, id for update
  loop
    exit when v_remaining<=0;
    v_take := least(v_remaining, v_chargeback.remaining_amount);
    insert into public.commission_chargeback_allocations(chargeback_id,payment_sale_id,amount)
    values(v_chargeback.id,p_sale_id,v_take);
    update public.commission_chargebacks
    set remaining_amount=remaining_amount-v_take,
        status=case when remaining_amount-v_take=0 then 'recovered' else 'outstanding' end,
        recovered_at=case when remaining_amount-v_take=0 then now() else null end
    where id=v_chargeback.id;
    v_remaining := v_remaining-v_take;
    v_applied := v_applied+v_take;
  end loop;
  update public.sales_records set
    commission_gross_amount=p_gross_amount,
    commission_chargeback_applied=v_applied,
    commission_paid_amount=v_remaining,
    commission_paid_at=now(),
    commission_paid_by=v_actor
  where id=p_sale_id;
  return jsonb_build_object('ok',true,'gross_amount',p_gross_amount,'chargeback_applied',v_applied,'net_paid_amount',v_remaining);
end;
$$;

revoke all on function public.admin_record_sale_commission_payment(uuid,numeric) from public, anon;
grant execute on function public.admin_record_sale_commission_payment(uuid,numeric) to authenticated;

-- Update the existing authoritative calculation without creating a competing
-- ranking path. ranking_eligible is independent of cancellation/accounting.
do $$
declare v_definition text;
begin
  select pg_get_functiondef('public.get_verified_sales_rankings()'::regprocedure) into v_definition;
  v_definition := replace(v_definition,
    'where s.competition_eligible is true\n      and s.verification_status = ''verified_processed''\n      and lower(coalesce(s.sale_status, '''')) <> ''cancelled''',
    'where s.ranking_eligible is true');
  v_definition := replace(v_definition,
    'where lower(coalesce(s.sale_status, '''')) <> ''cancelled''\n      and not (s.competition_eligible is true and s.verification_status = ''verified_processed'')',
    'where s.ranking_eligible is not true and lower(coalesce(s.sale_status, '''')) <> ''cancelled''');
  v_definition := replace(v_definition,
    '''provider_verified_competition_eligible_non_cancelled_admin_approved''',
    '''provider_verified_ranking_credit_cancellations_accounting_only''');
  v_definition := replace(v_definition,
    'where lower(coalesce(s.sale_status, '''')) <> ''cancelled'' and not (s.competition_eligible is true and s.verification_status = ''verified_processed'')',
    'where s.ranking_eligible is not true and lower(coalesce(s.sale_status, '''')) <> ''cancelled''');
  execute v_definition;
end;
$$;

comment on column public.sales_records.ranking_eligible is
  'Permanent verified production credit. Provider cancellation changes accounting, not this ranking flag.';
