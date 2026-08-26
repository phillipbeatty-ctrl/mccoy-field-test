-- Production-safe tenant isolation foundation for Field Coach.
-- McCoy Platform LLC remains the internal_unlimited default organization.

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  legal_name text not null,
  display_name text not null,
  billing_status text not null default 'trial_active' check (billing_status in ('internal_unlimited','trial_active','paid_active','past_due_grace','suspended','cancelled')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.organizations (slug,legal_name,display_name,billing_status,active)
values ('mccoy-platform-llc','McCoy Platform LLC','McCoy','internal_unlimited',true)
on conflict (slug) do update set legal_name=excluded.legal_name,display_name=excluded.display_name,billing_status='internal_unlimited',active=true,updated_at=now();

create or replace function private.mccoy_organization_id()
returns uuid language sql stable security definer set search_path=pg_catalog,public
as $$ select id from public.organizations where slug='mccoy-platform-llc' limit 1 $$;
revoke all on function private.mccoy_organization_id() from public;
grant execute on function private.mccoy_organization_id() to authenticated,service_role;

create table if not exists public.organization_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  role text not null check (role in ('owner','admin','manager','trainer','rep','tester','billing_admin')),
  active boolean not null default true,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id,auth_user_id)
);
create unique index if not exists organization_memberships_one_default_per_user on public.organization_memberships(auth_user_id) where is_default and active;
create index if not exists organization_memberships_org_idx on public.organization_memberships(organization_id,active);

insert into public.organization_memberships(organization_id,auth_user_id,email,role,active,is_default)
select private.mccoy_organization_id(), au.id, lower(au.email),
       case when a.role='admin' then 'admin' when a.role='manager' then 'manager' when a.role='trainer' then 'trainer' when a.role='tester' then 'tester' else 'rep' end,
       a.active, true
from auth.users au join public.app_user_access a on lower(a.email)=lower(au.email)
where au.email is not null
on conflict (organization_id,auth_user_id) do update set email=excluded.email,role=excluded.role,active=excluded.active,is_default=true,updated_at=now();

create or replace function private.current_organization_id()
returns uuid language sql stable security definer set search_path=pg_catalog,public
as $$
  select m.organization_id from public.organization_memberships m
  where m.auth_user_id=auth.uid() and m.active
  order by m.is_default desc,m.created_at asc limit 1
$$;
revoke all on function private.current_organization_id() from public;
grant execute on function private.current_organization_id() to authenticated,service_role;

do $$
declare t text;
begin
  foreach t in array array['app_user_access','users','teams','territories','leads','field_sessions','door_visits','door_activities','location_events','field_area_assignments','native_location_sessions','sales_records','sales_feed','provider_sale_captures','provider_sales_imports','provider_sales_rows'] loop
    execute format('alter table public.%I add column if not exists organization_id uuid references public.organizations(id)',t);
    execute format('update public.%I set organization_id=private.mccoy_organization_id() where organization_id is null',t);
    execute format('alter table public.%I alter column organization_id set default private.mccoy_organization_id(), alter column organization_id set not null',t);
    execute format('create index if not exists %I on public.%I(organization_id)',t||'_org_idx',t);
  end loop;
end $$;

alter table public.organizations enable row level security;
alter table public.organization_memberships enable row level security;
drop policy if exists organizations_select_member on public.organizations;
create policy organizations_select_member on public.organizations for select to authenticated using (id=private.current_organization_id());
drop policy if exists memberships_select_same_org on public.organization_memberships;
create policy memberships_select_same_org on public.organization_memberships for select to authenticated using (organization_id=private.current_organization_id());

-- Tenant guard is added to existing application scopes. Existing role/team logic remains intact.
drop policy if exists "admins can read all access" on public.app_user_access;
create policy "admins can read all access" on public.app_user_access for select to authenticated using (organization_id=private.current_organization_id() and is_mccoy_admin());
drop policy if exists "users can read own access" on public.app_user_access;
create policy "users can read own access" on public.app_user_access for select to authenticated using (organization_id=private.current_organization_id() and lower(email)=lower(coalesce(auth.jwt()->>'email','')));
drop policy if exists "managers can read direct report access" on public.app_user_access;
create policy "managers can read direct report access" on public.app_user_access for select to authenticated using (organization_id=private.current_organization_id() and private.current_app_role()=any(array['manager','trainer']) and role=any(array['rep','tester']) and active and lower(coalesce(assigned_manager_email,''))=lower(coalesce(auth.jwt()->>'email','')));

drop policy if exists users_select_scope on public.users;
create policy users_select_scope on public.users for select to authenticated using (organization_id=private.current_organization_id() and (id=private.current_app_user_id() or private.current_app_role()='admin' or (private.current_app_role()=any(array['manager','trainer']) and team_id=private.current_team_id())));

drop policy if exists teams_select_scope on public.teams;
create policy teams_select_scope on public.teams for select to authenticated using (organization_id=private.current_organization_id() and (private.current_app_role()='admin' or id=private.current_team_id()));
drop policy if exists territories_select_scope on public.territories;
create policy territories_select_scope on public.territories for select to authenticated using (organization_id=private.current_organization_id() and (private.current_app_role()='admin' or assigned_team_id=private.current_team_id()));

drop policy if exists leads_select_scope on public.leads;
create policy leads_select_scope on public.leads for select to authenticated using (organization_id=private.current_organization_id() and (private.current_app_role()='admin' or (private.current_app_role()=any(array['manager','trainer']) and assigned_manager_id=private.current_app_user_id() and assigned_admin_email is not null and lower(assigned_admin_email)=lower(private.current_manager_admin_email())) or (private.current_app_role()='rep' and assigned_rep_id=private.current_app_user_id())));
drop policy if exists leads_insert_admin on public.leads;
create policy leads_insert_admin on public.leads for insert to authenticated with check (organization_id=private.current_organization_id() and private.current_app_role()='admin');

drop policy if exists field_sessions_select_scope on public.field_sessions;
create policy field_sessions_select_scope on public.field_sessions for select to authenticated using (organization_id=private.current_organization_id() and (private.current_app_role()='admin' or rep_id=private.current_app_user_id() or (private.current_app_role()=any(array['manager','trainer']) and exists(select 1 from public.users r where r.id=field_sessions.rep_id and r.organization_id=field_sessions.organization_id and r.team_id=private.current_team_id()))));
drop policy if exists field_sessions_insert_self on public.field_sessions;
create policy field_sessions_insert_self on public.field_sessions for insert to authenticated with check (organization_id=private.current_organization_id() and rep_id=private.current_app_user_id());
drop policy if exists field_sessions_update_self on public.field_sessions;
create policy field_sessions_update_self on public.field_sessions for update to authenticated using (organization_id=private.current_organization_id() and (rep_id=private.current_app_user_id() or private.current_app_role()='admin')) with check (organization_id=private.current_organization_id() and (rep_id=private.current_app_user_id() or private.current_app_role()='admin'));

drop policy if exists door_visits_select_scope on public.door_visits;
create policy door_visits_select_scope on public.door_visits for select to authenticated using (organization_id=private.current_organization_id() and (private.current_app_role()='admin' or rep_id=private.current_app_user_id() or (private.current_app_role()=any(array['manager','trainer']) and exists(select 1 from public.users r where r.id=door_visits.rep_id and r.organization_id=door_visits.organization_id and r.team_id=private.current_team_id()))));
drop policy if exists door_activities_select_scope on public.door_activities;
create policy door_activities_select_scope on public.door_activities for select to authenticated using (organization_id=private.current_organization_id() and (private.current_app_role()='admin' or rep_id=private.current_app_user_id() or (private.current_app_role()=any(array['manager','trainer']) and exists(select 1 from public.users r where r.id=door_activities.rep_id and r.organization_id=door_activities.organization_id and r.team_id=private.current_team_id()))));
drop policy if exists door_activities_insert_self on public.door_activities;
create policy door_activities_insert_self on public.door_activities for insert to authenticated with check (organization_id=private.current_organization_id() and rep_id=private.current_app_user_id() and exists(select 1 from public.leads l where l.id=door_activities.lead_id and l.organization_id=door_activities.organization_id and l.assigned_rep_id=private.current_app_user_id()));

drop policy if exists location_events_select_scope on public.location_events;
create policy location_events_select_scope on public.location_events for select to authenticated using (organization_id=private.current_organization_id() and (private.current_app_role()='admin' or rep_id=private.current_app_user_id() or (private.current_app_role()=any(array['manager','trainer']) and exists(select 1 from public.users r where r.id=location_events.rep_id and r.organization_id=location_events.organization_id and r.team_id=private.current_team_id()))));
drop policy if exists location_events_insert_self on public.location_events;
create policy location_events_insert_self on public.location_events for insert to authenticated with check (organization_id=private.current_organization_id() and rep_id=private.current_app_user_id());

drop policy if exists "Admins can read sales records for credit assignment" on public.sales_records;
create policy "Admins can read sales records for credit assignment" on public.sales_records for select to authenticated using (organization_id=private.current_organization_id() and private.current_app_role()='admin');
drop policy if exists "authorized users read sales feed" on public.sales_feed;
create policy "authorized users read sales feed" on public.sales_feed for select to authenticated using (organization_id=private.current_organization_id() and exists(select 1 from public.app_user_access a where a.organization_id=sales_feed.organization_id and lower(a.email)=lower(coalesce(auth.jwt()->>'email','')) and a.active));
drop policy if exists "reps and admins read provider sale captures" on public.provider_sale_captures;
create policy "reps and admins read provider sale captures" on public.provider_sale_captures for select to authenticated using (organization_id=private.current_organization_id() and (rep_user_id=auth.uid() or exists(select 1 from public.app_user_access a where a.organization_id=provider_sale_captures.organization_id and lower(a.email)=lower(coalesce(auth.jwt()->>'email','')) and a.active and a.role='admin')));
