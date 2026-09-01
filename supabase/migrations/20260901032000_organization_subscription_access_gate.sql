begin;

create schema if not exists private;

create table if not exists public.organization_access_gate_state (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  access_allowed boolean not null default false,
  denial_reason text,
  state jsonb not null default '{}'::jsonb,
  evaluated_at timestamptz not null default clock_timestamp(),
  changed_at timestamptz not null default clock_timestamp()
);

create table if not exists public.organization_access_gate_history (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  prior_access_allowed boolean,
  access_allowed boolean not null,
  denial_reason text,
  state jsonb not null default '{}'::jsonb,
  source text not null default 'database_trigger',
  created_at timestamptz not null default clock_timestamp()
);

alter table public.organization_access_gate_state enable row level security;
alter table public.organization_access_gate_history enable row level security;
revoke all on public.organization_access_gate_state from public, anon, authenticated;
revoke all on public.organization_access_gate_history from public, anon, authenticated;
grant all on public.organization_access_gate_state to service_role;
grant all on public.organization_access_gate_history to service_role;

alter table public.app_user_access
  add column if not exists manual_active boolean,
  add column if not exists organization_access_allowed boolean not null default false,
  add column if not exists organization_access_denial_reason text,
  add column if not exists organization_access_checked_at timestamptz;

update public.app_user_access
set manual_active = active
where manual_active is null;

alter table public.app_user_access
  alter column manual_active set default true,
  alter column manual_active set not null;

alter table public.organization_memberships
  add column if not exists manual_active boolean,
  add column if not exists organization_access_allowed boolean not null default false,
  add column if not exists organization_access_denial_reason text,
  add column if not exists organization_access_checked_at timestamptz;

update public.organization_memberships
set manual_active = active
where manual_active is null;

alter table public.organization_memberships
  alter column manual_active set default true,
  alter column manual_active set not null;

create or replace function private.organization_entitlement_enabled(
  p_organization_id uuid,
  p_entitlement_key text
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $$
  select coalesce(bool_or(
    lower(coalesce(
      to_jsonb(e)->>'entitlement_key',
      to_jsonb(e)->>'feature_key',
      to_jsonb(e)->>'key',
      to_jsonb(e)->>'entitlement',
      ''
    )) = lower(trim(p_entitlement_key))
    and lower(coalesce(to_jsonb(e)->>'enabled', 'false')) in ('true','t','1','yes','on')
  ), false)
  from public.organization_entitlements e
  where e.organization_id = p_organization_id;
$$;

revoke all on function private.organization_entitlement_enabled(uuid,text) from public, anon, authenticated;
grant execute on function private.organization_entitlement_enabled(uuid,text) to service_role;

create or replace function private.organization_access_state(p_organization_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_org jsonb;
  v_subscription jsonb;
  v_org_active boolean := false;
  v_billing_status text := '';
  v_subscription_status text := '';
  v_plan_code text := '';
  v_period_end timestamptz;
  v_period_text text := '';
  v_billing_allowed boolean := false;
  v_entitlement_allowed boolean := false;
  v_allowed boolean := false;
  v_reason text;
begin
  select to_jsonb(o)
  into v_org
  from public.organizations o
  where o.id = p_organization_id;

  if v_org is null then
    return jsonb_build_object(
      'organization_id', p_organization_id,
      'access_allowed', false,
      'denial_reason', 'organization_not_found',
      'evaluated_at', clock_timestamp()
    );
  end if;

  select to_jsonb(s)
  into v_subscription
  from public.organization_subscriptions s
  where s.organization_id = p_organization_id
  order by
    case lower(coalesce(to_jsonb(s)->>'status', to_jsonb(s)->>'subscription_status', ''))
      when 'internal_unlimited' then 0
      when 'active' then 1
      when 'trialing' then 2
      else 9
    end,
    coalesce(to_jsonb(s)->>'updated_at', to_jsonb(s)->>'created_at', '') desc
  limit 1;

  v_org_active := lower(coalesce(v_org->>'active','false')) in ('true','t','1','yes','on');
  v_billing_status := lower(trim(coalesce(v_org->>'billing_status','')));
  v_subscription_status := lower(trim(coalesce(v_subscription->>'status', v_subscription->>'subscription_status', '')));
  v_plan_code := lower(trim(coalesce(v_subscription->>'plan_code', v_subscription->>'plan', '')));
  v_period_text := coalesce(v_subscription->>'current_period_end', v_subscription->>'period_end', '');

  if v_period_text ~ '^\d{4}-\d{2}-\d{2}' then
    begin
      v_period_end := v_period_text::timestamptz;
    exception when others then
      v_period_end := null;
    end;
  end if;

  v_billing_allowed :=
    v_billing_status = 'internal_unlimited'
    or v_subscription_status = 'internal_unlimited'
    or (
      v_subscription_status = 'active'
      and (v_period_end is null or v_period_end > clock_timestamp())
    )
    or (
      v_subscription_status = 'trialing'
      and v_period_end is not null
      and v_period_end > clock_timestamp()
    );

  v_entitlement_allowed := private.organization_entitlement_enabled(
    p_organization_id,
    'field_coach_access'
  );

  v_allowed := v_org_active and v_billing_allowed and v_entitlement_allowed;

  v_reason := case
    when not v_org_active then 'organization_inactive'
    when not v_billing_allowed and v_subscription_status in ('past_due','unpaid') then 'subscription_payment_required'
    when not v_billing_allowed and v_subscription_status in ('cancelled','canceled') then 'subscription_cancelled'
    when not v_billing_allowed and v_subscription_status in ('suspended','paused') then 'subscription_suspended'
    when not v_billing_allowed and v_subscription_status in ('expired','ended') then 'subscription_expired'
    when not v_billing_allowed and v_subscription is null then 'subscription_required'
    when not v_billing_allowed then 'subscription_inactive'
    when not v_entitlement_allowed then 'field_coach_access_entitlement_required'
    else null
  end;

  return jsonb_build_object(
    'organization_id', p_organization_id,
    'organization_slug', v_org->>'slug',
    'organization_name', coalesce(v_org->>'display_name', v_org->>'legal_name'),
    'organization_active', v_org_active,
    'billing_status', nullif(v_billing_status,''),
    'subscription_status', nullif(v_subscription_status,''),
    'plan_code', nullif(v_plan_code,''),
    'current_period_end', v_period_end,
    'billing_allowed', v_billing_allowed,
    'required_entitlement', 'field_coach_access',
    'entitlement_allowed', v_entitlement_allowed,
    'access_allowed', v_allowed,
    'denial_reason', v_reason,
    'purchase_location', 'outside_app_organization_billing',
    'evaluated_at', clock_timestamp()
  );
end;
$$;

revoke all on function private.organization_access_state(uuid) from public, anon, authenticated;
grant execute on function private.organization_access_state(uuid) to service_role;

create or replace function private.sync_organization_access(
  p_organization_id uuid,
  p_source text default 'database_trigger'
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_state jsonb;
  v_allowed boolean;
  v_reason text;
  v_prior boolean;
  v_now timestamptz := clock_timestamp();
begin
  v_state := private.organization_access_state(p_organization_id);
  v_allowed := coalesce((v_state->>'access_allowed')::boolean, false);
  v_reason := v_state->>'denial_reason';

  select access_allowed
  into v_prior
  from public.organization_access_gate_state
  where organization_id = p_organization_id;

  perform set_config('field_coach.organization_gate_sync', 'on', true);

  update public.app_user_access
  set
    active = manual_active and v_allowed,
    organization_access_allowed = v_allowed,
    organization_access_denial_reason = v_reason,
    organization_access_checked_at = v_now
  where organization_id = p_organization_id
    and (
      active is distinct from (manual_active and v_allowed)
      or organization_access_allowed is distinct from v_allowed
      or organization_access_denial_reason is distinct from v_reason
      or organization_access_checked_at is null
    );

  update public.organization_memberships
  set
    active = manual_active and v_allowed,
    organization_access_allowed = v_allowed,
    organization_access_denial_reason = v_reason,
    organization_access_checked_at = v_now
  where organization_id = p_organization_id
    and (
      active is distinct from (manual_active and v_allowed)
      or organization_access_allowed is distinct from v_allowed
      or organization_access_denial_reason is distinct from v_reason
      or organization_access_checked_at is null
    );

  perform set_config('field_coach.organization_gate_sync', 'off', true);

  insert into public.organization_access_gate_state(
    organization_id, access_allowed, denial_reason, state, evaluated_at, changed_at
  ) values (
    p_organization_id, v_allowed, v_reason, v_state, v_now, v_now
  )
  on conflict (organization_id) do update
  set
    access_allowed = excluded.access_allowed,
    denial_reason = excluded.denial_reason,
    state = excluded.state,
    evaluated_at = excluded.evaluated_at,
    changed_at = case
      when public.organization_access_gate_state.access_allowed is distinct from excluded.access_allowed
        or public.organization_access_gate_state.denial_reason is distinct from excluded.denial_reason
      then excluded.evaluated_at
      else public.organization_access_gate_state.changed_at
    end;

  if v_prior is null or v_prior is distinct from v_allowed then
    insert into public.organization_access_gate_history(
      organization_id, prior_access_allowed, access_allowed, denial_reason, state, source
    ) values (
      p_organization_id, v_prior, v_allowed, v_reason, v_state, coalesce(nullif(trim(p_source),''),'database_trigger')
    );
  end if;

  return v_state;
end;
$$;

revoke all on function private.sync_organization_access(uuid,text) from public, anon, authenticated;
grant execute on function private.sync_organization_access(uuid,text) to service_role;

create or replace function private.enforce_app_user_effective_access()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_state jsonb;
  v_allowed boolean;
  v_sync boolean := current_setting('field_coach.organization_gate_sync', true) = 'on';
begin
  if not v_sync then
    if tg_op = 'INSERT' then
      new.manual_active := coalesce(new.active, new.manual_active, true);
    elsif new.active is distinct from old.active then
      new.manual_active := new.active;
    end if;
  end if;

  v_state := private.organization_access_state(new.organization_id);
  v_allowed := coalesce((v_state->>'access_allowed')::boolean, false);
  new.organization_access_allowed := v_allowed;
  new.organization_access_denial_reason := v_state->>'denial_reason';
  new.organization_access_checked_at := clock_timestamp();
  new.active := coalesce(new.manual_active, false) and v_allowed;
  return new;
end;
$$;

create or replace function private.enforce_membership_effective_access()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_state jsonb;
  v_allowed boolean;
  v_sync boolean := current_setting('field_coach.organization_gate_sync', true) = 'on';
begin
  if not v_sync then
    if tg_op = 'INSERT' then
      new.manual_active := coalesce(new.active, new.manual_active, true);
    elsif new.active is distinct from old.active then
      new.manual_active := new.active;
    end if;
  end if;

  v_state := private.organization_access_state(new.organization_id);
  v_allowed := coalesce((v_state->>'access_allowed')::boolean, false);
  new.organization_access_allowed := v_allowed;
  new.organization_access_denial_reason := v_state->>'denial_reason';
  new.organization_access_checked_at := clock_timestamp();
  new.active := coalesce(new.manual_active, false) and v_allowed;
  return new;
end;
$$;

drop trigger if exists app_user_access_effective_access on public.app_user_access;
create trigger app_user_access_effective_access
before insert or update of active, manual_active, organization_id
on public.app_user_access
for each row execute function private.enforce_app_user_effective_access();

drop trigger if exists organization_memberships_effective_access on public.organization_memberships;
create trigger organization_memberships_effective_access
before insert or update of active, manual_active, organization_id
on public.organization_memberships
for each row execute function private.enforce_membership_effective_access();

create or replace function private.sync_organization_access_trigger()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_org_id uuid;
begin
  if tg_table_name = 'organizations' then
    v_org_id := coalesce(new.id, old.id);
  else
    v_org_id := coalesce(new.organization_id, old.organization_id);
  end if;
  if v_org_id is not null then
    perform private.sync_organization_access(v_org_id, tg_table_name || ':' || lower(tg_op));
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists organizations_sync_access_gate on public.organizations;
create trigger organizations_sync_access_gate
after insert or update on public.organizations
for each row execute function private.sync_organization_access_trigger();

drop trigger if exists subscriptions_sync_access_gate on public.organization_subscriptions;
create trigger subscriptions_sync_access_gate
after insert or update or delete on public.organization_subscriptions
for each row execute function private.sync_organization_access_trigger();

drop trigger if exists entitlements_sync_access_gate on public.organization_entitlements;
create trigger entitlements_sync_access_gate
after insert or update or delete on public.organization_entitlements
for each row execute function private.sync_organization_access_trigger();

create or replace function private.assert_user_organization_access(
  p_user_id uuid,
  p_entitlement_key text default 'field_coach_access'
)
returns uuid
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, private, auth
as $$
declare
  v_email text;
  v_access public.app_user_access%rowtype;
  v_state jsonb;
begin
  select lower(email) into v_email from auth.users where id = p_user_id;
  if v_email is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;

  select * into v_access
  from public.app_user_access
  where lower(email) = v_email
  limit 1;

  if not found or not v_access.manual_active then
    raise exception using errcode = '42501', message = 'user_access_inactive';
  end if;

  v_state := private.organization_access_state(v_access.organization_id);
  if not coalesce((v_state->>'access_allowed')::boolean,false) then
    raise exception using errcode = '42501', message = coalesce(v_state->>'denial_reason','organization_access_denied');
  end if;

  if p_entitlement_key is not null
    and trim(p_entitlement_key) <> ''
    and not private.organization_entitlement_enabled(v_access.organization_id,p_entitlement_key)
  then
    raise exception using errcode = '42501', message = 'organization_entitlement_required:' || trim(p_entitlement_key);
  end if;

  return v_access.organization_id;
end;
$$;

revoke all on function private.assert_user_organization_access(uuid,text) from public, anon, authenticated;
grant execute on function private.assert_user_organization_access(uuid,text) to service_role;

create or replace function public.current_organization_access_state()
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, private, auth
as $$
declare
  v_user_id uuid := auth.uid();
  v_email text;
  v_access public.app_user_access%rowtype;
  v_state jsonb;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;

  select lower(email) into v_email from auth.users where id = v_user_id;

  select * into v_access
  from public.app_user_access
  where lower(email) = v_email
  limit 1;

  if not found or v_access.organization_id is null then
    return jsonb_build_object(
      'access_allowed', false,
      'denial_reason', 'organization_access_record_required',
      'user_id', v_user_id,
      'evaluated_at', clock_timestamp()
    );
  end if;

  v_state := private.organization_access_state(v_access.organization_id);
  return v_state || jsonb_build_object(
    'user_id', v_user_id,
    'email', v_email,
    'role', v_access.role,
    'manual_user_access_active', v_access.manual_active,
    'effective_user_access_active', v_access.active,
    'access_allowed', coalesce((v_state->>'access_allowed')::boolean,false) and v_access.manual_active,
    'denial_reason', case
      when not v_access.manual_active then 'user_access_inactive'
      else v_state->>'denial_reason'
    end
  );
end;
$$;

revoke all on function public.current_organization_access_state() from public, anon;
grant execute on function public.current_organization_access_state() to authenticated, service_role;

create or replace function public.current_organization_has_entitlement(p_entitlement_key text)
returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, private, auth
as $$
declare
  v_state jsonb;
begin
  v_state := public.current_organization_access_state();
  if not coalesce((v_state->>'access_allowed')::boolean,false) then
    return false;
  end if;
  return private.organization_entitlement_enabled(
    (v_state->>'organization_id')::uuid,
    p_entitlement_key
  );
end;
$$;

revoke all on function public.current_organization_has_entitlement(text) from public, anon;
grant execute on function public.current_organization_has_entitlement(text) to authenticated, service_role;

do $$
declare
  v_org record;
begin
  for v_org in select id from public.organizations loop
    perform private.sync_organization_access(v_org.id, 'migration_initial_sync');
  end loop;
end;
$$;

commit;
