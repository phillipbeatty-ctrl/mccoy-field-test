-- Billing and entitlement foundation. No external tenant is admitted by this migration.
-- McCoy Platform LLC remains permanently internal_unlimited.

create table if not exists public.organization_subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null default 'manual' check (provider in ('manual','stripe','apple','google')),
  external_customer_id text,
  external_subscription_id text,
  plan_code text not null default 'internal_unlimited',
  status text not null check (status in ('internal_unlimited','trialing','active','past_due','suspended','cancelled')),
  seat_limit integer check (seat_limit is null or seat_limit >= 0),
  current_period_start timestamptz,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists organization_subscriptions_one_live on public.organization_subscriptions(organization_id) where status in ('internal_unlimited','trialing','active','past_due');

create table if not exists public.organization_entitlements (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  entitlement_key text not null,
  enabled boolean not null default true,
  limit_value numeric,
  source text not null default 'subscription',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id,entitlement_key)
);

insert into public.organization_subscriptions(organization_id,provider,plan_code,status,seat_limit)
select id,'manual','internal_unlimited','internal_unlimited',null from public.organizations where slug='mccoy-platform-llc'
on conflict do nothing;

insert into public.organization_entitlements(organization_id,entitlement_key,enabled,source)
select id,k,true,'internal_unlimited'
from public.organizations cross join unnest(array['field_coach_access','native_background_location','lead_management','sales_tracking','rankings','provider_integrations','analytics','admin_controls']) k
where slug='mccoy-platform-llc'
on conflict (organization_id,entitlement_key) do update set enabled=true,source='internal_unlimited',updated_at=now();

alter table public.organization_subscriptions enable row level security;
alter table public.organization_entitlements enable row level security;
drop policy if exists organization_subscriptions_select_member on public.organization_subscriptions;
create policy organization_subscriptions_select_member on public.organization_subscriptions for select to authenticated using (organization_id=private.current_organization_id());
drop policy if exists organization_entitlements_select_member on public.organization_entitlements;
create policy organization_entitlements_select_member on public.organization_entitlements for select to authenticated using (organization_id=private.current_organization_id());

create or replace function private.current_org_has_entitlement(p_key text)
returns boolean language sql stable security definer set search_path=pg_catalog,public
as $$
  select exists(select 1 from public.organizations o where o.id=private.current_organization_id() and o.active and o.billing_status='internal_unlimited')
      or exists(select 1 from public.organization_entitlements e where e.organization_id=private.current_organization_id() and e.entitlement_key=p_key and e.enabled)
$$;
revoke all on function private.current_org_has_entitlement(text) from public;
grant execute on function private.current_org_has_entitlement(text) to authenticated,service_role;

-- Ensure lead updates cannot cross tenant boundaries.
drop policy if exists leads_update_scope on public.leads;
create policy leads_update_scope on public.leads for update to authenticated
using (
  organization_id=private.current_organization_id() and
  (private.current_app_role()='admin' or (
    private.current_app_role()=any(array['manager','trainer']) and
    assigned_manager_id=private.current_app_user_id() and assigned_admin_email is not null and
    lower(assigned_admin_email)=lower(private.current_manager_admin_email())
  ))
)
with check (
  organization_id=private.current_organization_id() and
  (private.current_app_role()='admin' or (
    private.current_app_role()=any(array['manager','trainer']) and
    assigned_manager_id=private.current_app_user_id() and assigned_admin_email is not null and
    lower(assigned_admin_email)=lower(private.current_manager_admin_email()) and
    (assigned_rep_id is null or exists(
      select 1 from public.users target_rep
      join public.app_user_access target_access on target_access.organization_id=target_rep.organization_id and lower(target_access.email)=lower(target_rep.email)
      where target_rep.id=leads.assigned_rep_id and target_rep.organization_id=leads.organization_id and
            target_rep.active is true and target_rep.role='rep' and target_access.active is true and
            target_access.role=any(array['rep','tester']) and
            lower(coalesce(target_access.assigned_manager_email,''))=lower(coalesce(auth.jwt()->>'email',''))
    ))
  ))
);
