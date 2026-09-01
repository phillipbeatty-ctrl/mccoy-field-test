begin;

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

create temporary table field_coach_allowed_access_preflight on commit drop as
select
  a.organization_id,
  count(*) filter (where a.active) as active_access_before
from public.app_user_access a
where coalesce(
  (private.organization_access_state(a.organization_id)->>'access_allowed')::boolean,
  false
)
group by a.organization_id;

create temporary table field_coach_allowed_membership_preflight on commit drop as
select
  m.organization_id,
  count(*) filter (where m.active) as active_memberships_before
from public.organization_memberships m
where coalesce(
  (private.organization_access_state(m.organization_id)->>'access_allowed')::boolean,
  false
)
group by m.organization_id;

do $$
declare
  v_org record;
  v_state jsonb;
begin
  for v_org in
    select o.id, o.slug
    from public.organizations o
    where lower(coalesce(to_jsonb(o)->>'billing_status','')) = 'internal_unlimited'
      and exists (
        select 1 from public.app_user_access a
        where a.organization_id = o.id and a.active
      )
  loop
    v_state := private.organization_access_state(v_org.id);
    if not coalesce((v_state->>'access_allowed')::boolean,false) then
      raise exception using
        errcode = 'P0001',
        message = 'organization_access_preflight_failed',
        detail = format('Internal organization %s would be denied: %s',v_org.slug,coalesce(v_state->>'denial_reason','unknown'));
    end if;
  end loop;
end;
$$;

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
  v_allowed := coalesce((v_state->>'access_allowed')::boolean,false);
  new.organization_access_allowed := v_allowed;
  new.organization_access_denial_reason := v_state->>'denial_reason';
  new.organization_access_checked_at := clock_timestamp();
  new.active := coalesce(new.manual_active,false) and v_allowed;
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
  v_allowed := coalesce((v_state->>'access_allowed')::boolean,false);
  new.organization_access_allowed := v_allowed;
  new.organization_access_denial_reason := v_state->>'denial_reason';
  new.organization_access_checked_at := clock_timestamp();
  new.active := coalesce(new.manual_active,false) and v_allowed;
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
  v_allowed := coalesce((v_state->>'access_allowed')::boolean,false);
  v_reason := v_state->>'denial_reason';

  select access_allowed into v_prior
  from public.organization_access_gate_state
  where organization_id = p_organization_id;

  perform set_config('field_coach.organization_gate_sync','on',true);

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

  perform set_config('field_coach.organization_gate_sync','off',true);

  perform private.refresh_organization_access_gate_state(p_organization_id,p_source);
  return v_state;
exception when others then
  perform set_config('field_coach.organization_gate_sync','off',true);
  raise;
end;
$$;

revoke all on function private.sync_organization_access(uuid,text) from public, anon, authenticated;
grant execute on function private.sync_organization_access(uuid,text) to service_role;

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
    v_org_id := coalesce(new.id,old.id);
  else
    v_org_id := coalesce(new.organization_id,old.organization_id);
  end if;

  if v_org_id is not null then
    perform private.sync_organization_access(v_org_id,tg_table_name || ':' || lower(tg_op));
  end if;
  return coalesce(new,old);
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
    raise exception using
      errcode = '42501',
      message = coalesce(v_state->>'denial_reason','organization_access_denied');
  end if;

  if p_entitlement_key is not null
    and trim(p_entitlement_key) <> ''
    and not private.organization_entitlement_enabled(v_access.organization_id,p_entitlement_key)
  then
    raise exception using
      errcode = '42501',
      message = 'organization_entitlement_required:' || trim(p_entitlement_key);
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

do $$
declare
  v_org record;
begin
  for v_org in select id from public.organizations loop
    perform private.sync_organization_access(v_org.id,'enforcement_initial_sync');
  end loop;
end;
$$;

do $$
declare
  v_mismatch record;
begin
  select p.organization_id, p.active_access_before, count(a.*) filter (where a.active) as active_access_after
  into v_mismatch
  from field_coach_allowed_access_preflight p
  left join public.app_user_access a on a.organization_id = p.organization_id
  group by p.organization_id,p.active_access_before
  having count(a.*) filter (where a.active) <> p.active_access_before
  limit 1;

  if found then
    raise exception using
      errcode = 'P0001',
      message = 'organization_access_enforcement_count_mismatch',
      detail = format(
        'Allowed organization %s active access changed from %s to %s',
        v_mismatch.organization_id,
        v_mismatch.active_access_before,
        v_mismatch.active_access_after
      );
  end if;

  select p.organization_id, p.active_memberships_before, count(m.*) filter (where m.active) as active_memberships_after
  into v_mismatch
  from field_coach_allowed_membership_preflight p
  left join public.organization_memberships m on m.organization_id = p.organization_id
  group by p.organization_id,p.active_memberships_before
  having count(m.*) filter (where m.active) <> p.active_memberships_before
  limit 1;

  if found then
    raise exception using
      errcode = 'P0001',
      message = 'organization_membership_enforcement_count_mismatch',
      detail = format(
        'Allowed organization %s active memberships changed from %s to %s',
        v_mismatch.organization_id,
        v_mismatch.active_memberships_before,
        v_mismatch.active_memberships_after
      );
  end if;
end;
$$;

commit;
