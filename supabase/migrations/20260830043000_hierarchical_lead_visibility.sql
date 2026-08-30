begin;

create or replace function private.current_rep_manager_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select manager_profile.id
  from public.app_user_access as rep_access
  join public.app_user_access as manager_access
    on manager_access.organization_id = rep_access.organization_id
   and lower(manager_access.email) = lower(rep_access.assigned_manager_email)
   and manager_access.active is true
   and manager_access.role in ('manager','trainer')
  join public.users as manager_profile
    on manager_profile.organization_id = manager_access.organization_id
   and lower(manager_profile.email) = lower(manager_access.email)
   and manager_profile.active is true
  join public.app_user_access as administrator
    on administrator.organization_id = manager_access.organization_id
   and lower(administrator.email) = lower(manager_access.assigned_manager_email)
   and administrator.active is true
   and administrator.role = 'admin'
  where rep_access.organization_id = private.current_organization_id()
    and lower(rep_access.email) = lower(coalesce((select auth.jwt()) ->> 'email', ''))
    and rep_access.active is true
    and rep_access.role in ('rep','tester')
    and lower(manager_access.assigned_manager_email) = lower(manager_access.assigned_admin_email)
  limit 1;
$$;

create or replace function private.current_rep_admin_email()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select administrator.email
  from public.app_user_access as rep_access
  join public.app_user_access as manager_access
    on manager_access.organization_id = rep_access.organization_id
   and lower(manager_access.email) = lower(rep_access.assigned_manager_email)
   and manager_access.active is true
   and manager_access.role in ('manager','trainer')
  join public.app_user_access as administrator
    on administrator.organization_id = manager_access.organization_id
   and lower(administrator.email) = lower(manager_access.assigned_manager_email)
   and administrator.active is true
   and administrator.role = 'admin'
  where rep_access.organization_id = private.current_organization_id()
    and lower(rep_access.email) = lower(coalesce((select auth.jwt()) ->> 'email', ''))
    and rep_access.active is true
    and rep_access.role in ('rep','tester')
    and lower(manager_access.assigned_manager_email) = lower(manager_access.assigned_admin_email)
  limit 1;
$$;

create or replace function private.current_user_can_access_lead(p_lead_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = 'pg_catalog', 'public', 'private', 'auth'
as $$
declare
  v_email text := lower(coalesce((select auth.jwt()) ->> 'email', ''));
  v_access public.app_user_access%rowtype;
  v_profile public.users%rowtype;
  v_lead public.leads%rowtype;
  v_manager_id uuid;
  v_admin_email text;
begin
  if (select auth.uid()) is null or v_email = '' then return false; end if;

  select * into v_access
  from public.app_user_access
  where lower(email) = v_email
    and active is true
  limit 1;
  if not found then return false; end if;

  select * into v_profile
  from public.users
  where auth_user_id = (select auth.uid())
    and organization_id = v_access.organization_id
    and active is true
  limit 1;
  if not found then return false; end if;

  select * into v_lead
  from public.leads
  where id = p_lead_id
    and organization_id = v_access.organization_id
    and deleted_at is null
    and upper(coalesce(source_system, '')) not like '%DEMO%'
  limit 1;
  if not found then return false; end if;

  if v_access.role = 'admin' then
    return true;
  elsif v_access.role in ('manager','trainer') then
    v_admin_email := private.current_manager_admin_email();
    return v_admin_email is not null
      and v_lead.assigned_manager_id = v_profile.id
      and lower(coalesce(v_lead.assigned_admin_email, '')) = lower(v_admin_email);
  elsif v_access.role in ('rep','tester') then
    v_manager_id := private.current_rep_manager_id();
    v_admin_email := private.current_rep_admin_email();
    return v_manager_id is not null
      and v_admin_email is not null
      and v_lead.assigned_rep_id = v_profile.id
      and v_lead.assigned_manager_id = v_manager_id
      and lower(coalesce(v_lead.assigned_admin_email, '')) = lower(v_admin_email);
  end if;
  return false;
end;
$$;

revoke all on function private.current_rep_manager_id() from public, anon;
revoke all on function private.current_rep_admin_email() from public, anon;
revoke all on function private.current_user_can_access_lead(uuid) from public, anon;
grant execute on function private.current_rep_manager_id() to authenticated, service_role;
grant execute on function private.current_rep_admin_email() to authenticated, service_role;
grant execute on function private.current_user_can_access_lead(uuid) to authenticated, service_role;

drop policy if exists leads_select_scope on public.leads;
create policy leads_select_scope
on public.leads
for select
to authenticated
using (
  organization_id = private.current_organization_id()
  and (
    private.current_app_role() = 'admin'
    or (
      private.current_app_role() in ('manager','trainer')
      and assigned_manager_id = private.current_app_user_id()
      and assigned_admin_email is not null
      and lower(assigned_admin_email) = lower(private.current_manager_admin_email())
    )
    or (
      private.current_app_role() in ('rep','tester')
      and assigned_rep_id = private.current_app_user_id()
      and assigned_manager_id = private.current_rep_manager_id()
      and assigned_admin_email is not null
      and lower(assigned_admin_email) = lower(private.current_rep_admin_email())
    )
  )
);

create index if not exists leads_org_manager_assignment_scope_idx
  on public.leads (organization_id, assigned_manager_id, lower(assigned_admin_email), address1, id)
  where deleted_at is null and assigned_manager_id is not null;

create index if not exists leads_org_rep_assignment_scope_idx
  on public.leads (organization_id, assigned_rep_id, assigned_manager_id, lower(assigned_admin_email), address1, id)
  where deleted_at is null and assigned_rep_id is not null;

do $$
begin
  if to_regprocedure('public.record_lead_pool_pin_disposition_internal(uuid,uuid,uuid,text,text,text,timestamptz,integer,double precision,double precision,double precision,timestamptz)') is null then
    if to_regprocedure('public.record_lead_pool_pin_disposition(uuid,uuid,uuid,text,text,text,timestamptz,integer,double precision,double precision,double precision,timestamptz)') is null then
      raise exception 'record_lead_pool_pin_disposition_missing';
    end if;
    alter function public.record_lead_pool_pin_disposition(
      uuid,uuid,uuid,text,text,text,timestamptz,integer,
      double precision,double precision,double precision,timestamptz
    ) rename to record_lead_pool_pin_disposition_internal;
  end if;
end;
$$;

revoke all on function public.record_lead_pool_pin_disposition_internal(
  uuid,uuid,uuid,text,text,text,timestamptz,integer,
  double precision,double precision,double precision,timestamptz
) from public, anon, authenticated;

create or replace function public.record_lead_pool_pin_disposition(
  p_session_id uuid,
  p_lead_id uuid,
  p_client_request_id uuid,
  p_activity_type text,
  p_visit_result text,
  p_stage text,
  p_occurred_at timestamptz,
  p_dwell_seconds integer,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_meters double precision,
  p_gps_captured_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = 'pg_catalog', 'public', 'private', 'auth'
as $$
begin
  if not private.current_user_can_access_lead(p_lead_id) then
    raise exception 'lead_outside_assigned_scope' using errcode = '42501';
  end if;

  return public.record_lead_pool_pin_disposition_internal(
    p_session_id,
    p_lead_id,
    p_client_request_id,
    p_activity_type,
    p_visit_result,
    p_stage,
    p_occurred_at,
    p_dwell_seconds,
    p_latitude,
    p_longitude,
    p_accuracy_meters,
    p_gps_captured_at
  );
end;
$$;

revoke all on function public.record_lead_pool_pin_disposition(
  uuid,uuid,uuid,text,text,text,timestamptz,integer,
  double precision,double precision,double precision,timestamptz
) from public, anon;
grant execute on function public.record_lead_pool_pin_disposition(
  uuid,uuid,uuid,text,text,text,timestamptz,integer,
  double precision,double precision,double precision,timestamptz
) to authenticated, service_role;

create or replace function public.get_closest_mccoy_lead(
  p_lat double precision,
  p_lng double precision
)
returns jsonb
language plpgsql
security definer
set search_path = 'pg_catalog', 'public', 'private', 'auth'
as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text := lower(coalesce((select auth.jwt()) ->> 'email', ''));
  v_access public.app_user_access%rowtype;
  v_profile public.users%rowtype;
  v_manager_id uuid;
  v_admin_email text;
  v_result jsonb;
begin
  if p_lat is null or p_lng is null
     or p_lat < -90 or p_lat > 90
     or p_lng < -180 or p_lng > 180 then
    raise exception 'valid_location_required' using errcode = '22023';
  end if;
  if v_uid is null or v_email = '' then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  select * into v_access
  from public.app_user_access
  where lower(email) = v_email
    and active is true
  limit 1;
  if not found then raise exception 'active_access_required' using errcode = '42501'; end if;

  select * into v_profile
  from public.users
  where auth_user_id = v_uid
    and organization_id = v_access.organization_id
    and active is true
  limit 1;
  if not found then raise exception 'active_user_profile_required' using errcode = '42501'; end if;

  if v_access.role in ('manager','trainer') then
    v_admin_email := private.current_manager_admin_email();
    if v_admin_email is null then return null; end if;
  elsif v_access.role in ('rep','tester') then
    v_manager_id := private.current_rep_manager_id();
    v_admin_email := private.current_rep_admin_email();
    if v_manager_id is null or v_admin_email is null then return null; end if;
  elsif v_access.role <> 'admin' then
    raise exception 'field_role_required' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'id', l.id,
    'address', concat_ws(', ',
      nullif(concat_ws(' ', l.address1, l.address2), ''),
      nullif(l.city, ''),
      nullif(concat_ws(' ', l.state, l.zip), '')
    ),
    'latitude', l.latitude,
    'longitude', l.longitude,
    'distance_meters', round((
      2 * 6371000 * asin(
        least(1, sqrt(
          power(sin(radians(l.latitude - p_lat) / 2), 2)
          + cos(radians(p_lat)) * cos(radians(l.latitude))
            * power(sin(radians(l.longitude - p_lng) / 2), 2)
        ))
      )
    )::numeric, 1),
    'owner_email', owner.email,
    'organization_id', l.organization_id
  )
  into v_result
  from public.leads l
  left join public.users owner
    on owner.id = l.assigned_rep_id
   and owner.organization_id = l.organization_id
  where l.organization_id = v_access.organization_id
    and l.deleted_at is null
    and upper(coalesce(l.source_system, '')) not like '%DEMO%'
    and l.latitude between -90 and 90
    and l.longitude between -180 and 180
    and nullif(l.address1, '') is not null
    and (
      v_access.role = 'admin'
      or (
        v_access.role in ('manager','trainer')
        and l.assigned_manager_id = v_profile.id
        and lower(coalesce(l.assigned_admin_email, '')) = lower(v_admin_email)
      )
      or (
        v_access.role in ('rep','tester')
        and l.assigned_rep_id = v_profile.id
        and l.assigned_manager_id = v_manager_id
        and lower(coalesce(l.assigned_admin_email, '')) = lower(v_admin_email)
      )
    )
  order by
    2 * 6371000 * asin(
      least(1, sqrt(
        power(sin(radians(l.latitude - p_lat) / 2), 2)
        + cos(radians(p_lat)) * cos(radians(l.latitude))
          * power(sin(radians(l.longitude - p_lng) / 2), 2)
      ))
    ),
    l.id
  limit 1;

  return v_result;
end;
$$;

revoke all on function public.get_closest_mccoy_lead(double precision,double precision) from public, anon;
grant execute on function public.get_closest_mccoy_lead(double precision,double precision) to authenticated, service_role;

notify pgrst, 'reload schema';
commit;