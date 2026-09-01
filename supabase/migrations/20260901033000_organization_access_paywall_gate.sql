begin;

alter table public.organization_subscriptions
  add column if not exists grace_period_end timestamptz,
  add column if not exists cancel_at_period_end boolean not null default false,
  add column if not exists status_reason text,
  add column if not exists status_changed_at timestamptz not null default now();

create index if not exists organization_subscriptions_org_updated_idx
  on public.organization_subscriptions(organization_id, updated_at desc, created_at desc);

-- Browser clients may inspect only their own RLS-filtered organization state.
-- Subscription and entitlement changes remain service/Admin operations.
revoke all on table public.organizations from public, anon;
revoke all on table public.organization_subscriptions from public, anon;
revoke all on table public.organization_entitlements from public, anon;
revoke all on table public.organization_memberships from public, anon;
revoke all on table public.app_user_access from public, anon;

revoke insert, update, delete, truncate, references, trigger
  on table public.organizations,
           public.organization_subscriptions,
           public.organization_entitlements,
           public.organization_memberships,
           public.app_user_access
  from authenticated;

grant select on table public.organizations,
                      public.organization_subscriptions,
                      public.organization_entitlements,
                      public.organization_memberships,
                      public.app_user_access
  to authenticated;

-- Repair legacy active-access rows that predate organization memberships.
insert into public.organization_memberships(
  organization_id,
  auth_user_id,
  email,
  role,
  active,
  is_default,
  created_at,
  updated_at
)
select
  access.organization_id,
  auth_user.id,
  lower(auth_user.email),
  case
    when access.role in ('admin','manager','trainer','rep','tester') then access.role
    else 'rep'
  end,
  true,
  not exists (
    select 1
    from public.organization_memberships existing_default
    where existing_default.auth_user_id=auth_user.id
      and existing_default.active
      and existing_default.is_default
  ),
  now(),
  now()
from public.app_user_access access
join auth.users auth_user
  on lower(auth_user.email)=lower(access.email)
where access.active
  and auth_user.deleted_at is null
  and not exists (
    select 1
    from public.organization_memberships existing
    where existing.organization_id=access.organization_id
      and existing.auth_user_id=auth_user.id
  )
on conflict (organization_id, auth_user_id) do nothing;

create or replace function private.organization_access_state(
  p_organization_id uuid,
  p_entitlement text default 'field_coach_access'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
declare
  organization_row public.organizations%rowtype;
  subscription_row public.organization_subscriptions%rowtype;
  has_subscription boolean := false;
  billing_allowed boolean := false;
  entitlement_allowed boolean := false;
  seat_allowed boolean := false;
  active_seats integer := 0;
  denial_reason text := null;
  access_allowed boolean := false;
  required_entitlement text := nullif(btrim(coalesce(p_entitlement,'')), '');
begin
  select *
  into organization_row
  from public.organizations
  where id=p_organization_id;

  if not found then
    return jsonb_build_object(
      'schema_version', 1,
      'access_allowed', false,
      'denial_reason', 'organization_not_found',
      'organization_id', p_organization_id,
      'entitlement_key', required_entitlement,
      'purchase_model', 'organization_managed_external',
      'purchase_action_available', false,
      'checked_at', clock_timestamp()
    );
  end if;

  select *
  into subscription_row
  from public.organization_subscriptions
  where organization_id=p_organization_id
  order by updated_at desc, created_at desc
  limit 1;
  has_subscription := found;

  select count(*)::integer
  into active_seats
  from public.app_user_access
  where organization_id=p_organization_id
    and active;

  if not organization_row.active then
    denial_reason := 'organization_inactive';
  elsif organization_row.billing_status='internal_unlimited' then
    billing_allowed := true;
  elsif organization_row.billing_status='trial_active' then
    if not has_subscription then
      denial_reason := 'subscription_missing';
    elsif subscription_row.status<>'trialing' then
      denial_reason := 'trial_subscription_inactive';
    elsif subscription_row.current_period_end is null then
      denial_reason := 'trial_expiration_missing';
    elsif subscription_row.current_period_end<=now() then
      denial_reason := 'trial_expired';
    else
      billing_allowed := true;
    end if;
  elsif organization_row.billing_status='paid_active' then
    if not has_subscription then
      denial_reason := 'subscription_missing';
    elsif subscription_row.status<>'active' then
      denial_reason := 'subscription_inactive';
    elsif subscription_row.provider<>'manual'
      and subscription_row.current_period_end is null then
      denial_reason := 'subscription_period_missing';
    elsif subscription_row.current_period_end is not null
      and subscription_row.current_period_end<=now() then
      denial_reason := 'subscription_expired';
    else
      billing_allowed := true;
    end if;
  elsif organization_row.billing_status='past_due_grace' then
    if not has_subscription then
      denial_reason := 'subscription_missing';
    elsif subscription_row.status<>'past_due' then
      denial_reason := 'past_due_status_mismatch';
    elsif subscription_row.grace_period_end is null then
      denial_reason := 'grace_period_missing';
    elsif subscription_row.grace_period_end<=now() then
      denial_reason := 'past_due_grace_expired';
    else
      billing_allowed := true;
    end if;
  elsif organization_row.billing_status='suspended' then
    denial_reason := 'organization_suspended';
  elsif organization_row.billing_status='cancelled' then
    denial_reason := 'organization_cancelled';
  else
    denial_reason := 'billing_status_not_allowed';
  end if;

  if billing_allowed then
    entitlement_allowed := organization_row.billing_status='internal_unlimited'
      or required_entitlement is null
      or exists(
        select 1
        from public.organization_entitlements entitlement
        where entitlement.organization_id=p_organization_id
          and entitlement.entitlement_key=required_entitlement
          and entitlement.enabled
      );
    if not entitlement_allowed then
      denial_reason := 'entitlement_disabled';
    end if;
  end if;

  seat_allowed := billing_allowed
    and entitlement_allowed
    and (
      not has_subscription
      or subscription_row.seat_limit is null
      or active_seats<=subscription_row.seat_limit
    );
  if billing_allowed and entitlement_allowed and not seat_allowed then
    denial_reason := 'seat_limit_exceeded';
  end if;

  access_allowed := organization_row.active
    and billing_allowed
    and entitlement_allowed
    and seat_allowed;

  return jsonb_build_object(
    'schema_version', 1,
    'access_allowed', access_allowed,
    'denial_reason', case when access_allowed then null else coalesce(denial_reason,'access_denied') end,
    'organization_id', organization_row.id,
    'organization_slug', organization_row.slug,
    'organization_name', organization_row.display_name,
    'organization_active', organization_row.active,
    'billing_status', organization_row.billing_status,
    'subscription_present', has_subscription,
    'subscription_provider', case when has_subscription then subscription_row.provider else null end,
    'subscription_status', case when has_subscription then subscription_row.status else null end,
    'plan_code', case when has_subscription then subscription_row.plan_code else null end,
    'current_period_end', case when has_subscription then subscription_row.current_period_end else null end,
    'grace_period_end', case when has_subscription then subscription_row.grace_period_end else null end,
    'cancel_at_period_end', case when has_subscription then subscription_row.cancel_at_period_end else false end,
    'seat_limit', case when has_subscription then subscription_row.seat_limit else null end,
    'active_seats', active_seats,
    'entitlement_key', required_entitlement,
    'entitlement_enabled', entitlement_allowed,
    'purchase_model', 'organization_managed_external',
    'purchase_action_available', false,
    'checked_at', clock_timestamp()
  );
end
$$;

create or replace function private.organization_access_allowed(
  p_organization_id uuid,
  p_entitlement text default 'field_coach_access'
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $$
  select coalesce(
    (private.organization_access_state(p_organization_id,p_entitlement)->>'access_allowed')::boolean,
    false
  )
$$;

create or replace function private.auth_user_organization_access_state(
  p_auth_user_id uuid,
  p_entitlement text default 'field_coach_access'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private, auth
as $$
declare
  auth_email text;
  membership_row public.organization_memberships%rowtype;
  access_row public.app_user_access%rowtype;
  organization_state jsonb;
begin
  select lower(email)
  into auth_email
  from auth.users
  where id=p_auth_user_id
    and deleted_at is null;

  if auth_email is null then
    return jsonb_build_object(
      'schema_version',1,
      'access_allowed',false,
      'denial_reason','auth_user_not_found',
      'membership_active',false,
      'user_access_active',false,
      'entitlement_key',nullif(btrim(coalesce(p_entitlement,'')),''),
      'purchase_model','organization_managed_external',
      'purchase_action_available',false,
      'checked_at',clock_timestamp()
    );
  end if;

  select *
  into membership_row
  from public.organization_memberships
  where auth_user_id=p_auth_user_id
    and active
  order by is_default desc, created_at asc
  limit 1;

  if not found then
    return jsonb_build_object(
      'schema_version',1,
      'access_allowed',false,
      'denial_reason','organization_membership_required',
      'user_email',auth_email,
      'membership_active',false,
      'user_access_active',false,
      'entitlement_key',nullif(btrim(coalesce(p_entitlement,'')),''),
      'purchase_model','organization_managed_external',
      'purchase_action_available',false,
      'checked_at',clock_timestamp()
    );
  end if;

  select *
  into access_row
  from public.app_user_access
  where organization_id=membership_row.organization_id
    and lower(email)=auth_email
  limit 1;

  if not found or not access_row.active then
    return jsonb_build_object(
      'schema_version',1,
      'access_allowed',false,
      'denial_reason','active_user_access_required',
      'user_email',auth_email,
      'organization_id',membership_row.organization_id,
      'membership_active',true,
      'membership_role',membership_row.role,
      'user_access_active',false,
      'entitlement_key',nullif(btrim(coalesce(p_entitlement,'')),''),
      'purchase_model','organization_managed_external',
      'purchase_action_available',false,
      'checked_at',clock_timestamp()
    );
  end if;

  organization_state := private.organization_access_state(
    membership_row.organization_id,
    p_entitlement
  );

  return organization_state || jsonb_build_object(
    'user_email',auth_email,
    'membership_active',true,
    'membership_role',membership_row.role,
    'user_access_active',true,
    'user_role',access_row.role
  );
end
$$;

create or replace function private.current_org_access_allowed(
  p_entitlement text default 'field_coach_access'
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $$
  select private.organization_access_allowed(
    private.current_organization_id(),
    p_entitlement
  )
$$;

create or replace function private.current_org_has_entitlement(p_key text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $$
  select private.current_org_access_allowed(p_key)
$$;

create or replace function public.current_organization_access_state(
  p_entitlement text default 'field_coach_access'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private, auth
as $$
begin
  if auth.uid() is null then
    raise exception 'authentication_required' using errcode='42501';
  end if;
  return private.auth_user_organization_access_state(auth.uid(),p_entitlement);
end
$$;

create or replace function public.service_organization_access_state(
  p_auth_user_id uuid,
  p_entitlement text default 'field_coach_access'
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, private, auth
as $$
  select private.auth_user_organization_access_state(p_auth_user_id,p_entitlement)
$$;

create or replace function public.service_assert_organization_access(
  p_auth_user_id uuid,
  p_entitlement text default 'field_coach_access'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private, auth
as $$
declare
  state jsonb;
begin
  state := private.auth_user_organization_access_state(p_auth_user_id,p_entitlement);
  if coalesce((state->>'access_allowed')::boolean,false) is not true then
    raise exception 'organization_access_denied:%',coalesce(state->>'denial_reason','access_denied')
      using errcode='42501';
  end if;
  return state;
end
$$;

revoke all on function private.organization_access_state(uuid,text) from public, anon, authenticated;
revoke all on function private.organization_access_allowed(uuid,text) from public, anon, authenticated;
revoke all on function private.auth_user_organization_access_state(uuid,text) from public, anon, authenticated;
revoke all on function private.current_org_access_allowed(text) from public, anon, authenticated;
revoke all on function private.current_org_has_entitlement(text) from public, anon, authenticated;

revoke all on function public.current_organization_access_state(text) from public, anon;
grant execute on function public.current_organization_access_state(text) to authenticated;

revoke all on function public.service_organization_access_state(uuid,text) from public, anon, authenticated;
revoke all on function public.service_assert_organization_access(uuid,text) from public, anon, authenticated;
grant execute on function public.service_organization_access_state(uuid,text) to service_role;
grant execute on function public.service_assert_organization_access(uuid,text) to service_role;

-- Add a restrictive subscription/entitlement condition to every organization-scoped
-- RLS table. Existing role/ownership policies remain responsible for row scope.
do $$
declare
  target record;
begin
  for target in
    select n.nspname as schema_name, c.relname as table_name
    from pg_class c
    join pg_namespace n on n.oid=c.relnamespace
    join pg_attribute a on a.attrelid=c.oid
    where n.nspname='public'
      and c.relkind in ('r','p')
      and c.relrowsecurity
      and a.attname='organization_id'
      and not a.attisdropped
  loop
    execute format(
      'drop policy if exists organization_subscription_gate on %I.%I',
      target.schema_name,
      target.table_name
    );
    execute format(
      'create policy organization_subscription_gate on %I.%I as restrictive for all to authenticated using (private.organization_access_allowed(organization_id,%L)) with check (private.organization_access_allowed(organization_id,%L))',
      target.schema_name,
      target.table_name,
      'field_coach_access',
      'field_coach_access'
    );
  end loop;
end
$$;

commit;
