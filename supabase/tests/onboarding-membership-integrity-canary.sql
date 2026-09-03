begin;

do $$
declare
  target record;
  state jsonb;
begin
  select
    a.email,
    a.organization_id,
    a.role,
    u.id as auth_user_id
  into target
  from public.app_user_access a
  join auth.users u
    on lower(u.email)=lower(a.email)
   and u.deleted_at is null
  where a.active
    and a.role='rep'
    and lower(a.email)<>'phillipkbeatty@gmail.com'
  order by a.created_at asc
  limit 1;

  if target.auth_user_id is null then
    raise exception 'onboarding_canary_user_unavailable';
  end if;

  delete from public.organization_memberships
  where organization_id=target.organization_id
    and auth_user_id=target.auth_user_id;

  state:=public.service_organization_access_state(target.auth_user_id,'field_coach_access');
  if coalesce((state->>'access_allowed')::boolean,false) then
    raise exception 'membership_deletion_did_not_fail_closed';
  end if;

  -- Listing the column in SET fires the synchronization trigger even when the
  -- access flag is already true, exactly matching the service repair operation.
  update public.app_user_access
  set active=active
  where email=target.email
    and organization_id=target.organization_id;

  if not exists(
    select 1
    from public.organization_memberships m
    where m.organization_id=target.organization_id
      and m.auth_user_id=target.auth_user_id
      and m.active
      and m.is_default
      and m.role=target.role
      and lower(m.email)=lower(target.email)
  ) then
    raise exception 'organization_membership_repair_failed';
  end if;

  if not exists(
    select 1
    from public.users profile
    where profile.auth_user_id=target.auth_user_id
      and profile.organization_id=target.organization_id
      and profile.active
      and profile.role='rep'
      and lower(profile.email)=lower(target.email)
  ) then
    raise exception 'app_user_profile_sync_failed';
  end if;

  state:=public.service_organization_access_state(target.auth_user_id,'field_coach_access');
  if coalesce((state->>'access_allowed')::boolean,false) is not true then
    raise exception 'organization_access_remained_unavailable_after_repair';
  end if;

  update public.app_user_access
  set active=false
  where email=target.email
    and organization_id=target.organization_id;

  if exists(
    select 1
    from public.organization_memberships m
    where m.organization_id=target.organization_id
      and m.auth_user_id=target.auth_user_id
      and (m.active or m.is_default)
  ) then
    raise exception 'organization_membership_deactivation_failed';
  end if;

  if exists(
    select 1
    from public.users profile
    where profile.auth_user_id=target.auth_user_id
      and profile.organization_id=target.organization_id
      and profile.active
  ) then
    raise exception 'app_user_profile_deactivation_failed';
  end if;

  raise notice 'onboarding_membership_integrity_canary_passed';
end
$$;

rollback;
