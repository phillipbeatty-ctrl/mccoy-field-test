-- Home means the current end-of-shift destination, including temporary Blitz lodging.
-- Only the authenticated Edge handler calls these service-only operations.
alter table private.sph_home_setting_audit enable row level security;
alter table private.sph_home_setting_audit
  add column if not exists old_workday_timezone text,
  add column if not exists old_home_accuracy_meters double precision,
  add column if not exists new_workday_timezone text,
  add column if not exists actor_role text;

create or replace function private.can_manage_sph_home(
  p_actor_user_id uuid, p_target_user_id uuid, p_organization_id uuid
) returns boolean
language sql stable security invoker
set search_path = pg_catalog, public, auth
as $$
  select exists (
    select 1
    from auth.users actor
    join public.app_user_access a on lower(trim(a.email))=lower(trim(actor.email))
    join auth.users target on target.id=p_target_user_id
    join public.app_user_access t on lower(trim(t.email))=lower(trim(target.email))
    join public.users u on u.auth_user_id=target.id
      and lower(trim(u.email))=lower(trim(target.email))
    where actor.id=p_actor_user_id and a.active is true and t.active is true and u.active is true
      and a.organization_id=p_organization_id and t.organization_id=p_organization_id
      and u.organization_id=p_organization_id
      and (a.role='admin' or (
        a.role in ('manager','trainer') and t.role<>'admin' and actor.id<>target.id
        and lower(trim(t.assigned_manager_email))=lower(trim(actor.email))
      ))
  );
$$;
revoke all on function private.can_manage_sph_home(uuid,uuid,uuid) from public,anon,authenticated;

create or replace function public.get_managed_sph_home_settings(p_actor_user_id uuid,p_organization_id uuid)
returns jsonb language plpgsql stable security definer
set search_path = pg_catalog,public,private,auth
as $$
declare v_role text; v_users jsonb;
begin
  select a.role into v_role
  from auth.users au join public.app_user_access a on lower(trim(a.email))=lower(trim(au.email))
  where au.id=p_actor_user_id and a.organization_id=p_organization_id and a.active is true
    and a.role in ('admin','manager','trainer');
  if v_role is null then raise exception 'manager_or_admin_required' using errcode='42501'; end if;
  select coalesce(jsonb_agg(item order by item->>'display_name'),'[]'::jsonb) into v_users
  from (
    select jsonb_build_object(
      'user_id',u.auth_user_id,'display_name',coalesce(nullif(a.display_name,''),a.email),
      'role',a.role,'team_name',a.team_name,'home_label',s.home_label,
      'home_configured',nullif(trim(s.home_label),'') is not null
        and s.home_latitude is not null and s.home_longitude is not null,
      'workday_timezone',coalesce(s.workday_timezone,'America/Los_Angeles'),
      'updated_at',s.updated_at
    ) item
    from public.app_user_access a
    join public.users u on lower(trim(u.email))=lower(trim(a.email)) and u.organization_id=a.organization_id
    left join public.sph_rep_settings s on s.user_id=u.auth_user_id
    where a.organization_id=p_organization_id
      and private.can_manage_sph_home(p_actor_user_id,u.auth_user_id,p_organization_id)
  ) rows;
  return jsonb_build_object('ok',true,'users',v_users);
end;
$$;
revoke all on function public.get_managed_sph_home_settings(uuid,uuid) from public,anon,authenticated;
grant execute on function public.get_managed_sph_home_settings(uuid,uuid) to service_role;

create or replace function public.set_managed_sph_home_locations(
  p_actor_user_id uuid,p_target_user_ids uuid[],p_organization_id uuid,
  p_home_label text,p_latitude double precision,p_longitude double precision,p_accuracy_meters double precision,
  p_workday_timezone text,p_geocode_provider text,p_place_id text default null
) returns jsonb language plpgsql security definer
set search_path = pg_catalog,public,private,auth
as $$
declare
  v_targets uuid[]; v_target uuid; v_role text;
  v_old public.sph_rep_settings%rowtype;
  v_now timestamptz := clock_timestamp();
  v_label text := nullif(trim(regexp_replace(coalesce(p_home_label,''),'\s+',' ','g')),'');
  v_audit_id bigint; v_audit_ids jsonb := '[]'::jsonb;
begin
  if coalesce(cardinality(p_target_user_ids),0) not between 1 and 50
    or array_position(p_target_user_ids,null) is not null then
    raise exception 'select_1_to_50_users' using errcode='22023';
  end if;
  select array_agg(id order by id) into v_targets from (select distinct unnest(p_target_user_ids) id) ids;

  -- Hold role, active state and supervisor assignments through the transaction.
  perform 1 from public.app_user_access a
    join auth.users au on lower(trim(au.email))=lower(trim(a.email))
    where au.id=p_actor_user_id or au.id=any(v_targets)
    order by a.email for share of a;
  perform 1 from public.users u where u.auth_user_id=any(v_targets) order by u.auth_user_id for share;
  select a.role into v_role from auth.users au
    join public.app_user_access a on lower(trim(a.email))=lower(trim(au.email))
    where au.id=p_actor_user_id and a.active is true and a.organization_id=p_organization_id
      and a.role in ('admin','manager','trainer');
  if v_role is null then raise exception 'manager_or_admin_required' using errcode='42501'; end if;
  foreach v_target in array v_targets loop
    if not private.can_manage_sph_home(p_actor_user_id,v_target,p_organization_id) then
      raise exception 'assigned_users_only' using errcode='42501';
    end if;
  end loop;
  if v_label is null or char_length(v_label) not between 8 and 200 then
    raise exception 'valid_destination_address_required' using errcode='22023';
  end if;
  if p_latitude is null or p_latitude not between -90 and 90
    or p_longitude is null or p_longitude not between -180 and 180
    or p_accuracy_meters is null or p_accuracy_meters not between 1 and 100 then
    raise exception 'valid_geocoded_destination_required' using errcode='22023';
  end if;
  if p_workday_timezone is null or not exists(select 1 from pg_timezone_names where name=p_workday_timezone) then
    raise exception 'valid_workday_timezone_required' using errcode='22023';
  end if;
  if p_geocode_provider is distinct from 'google_geocoding' or nullif(trim(p_place_id),'') is null then
    raise exception 'verified_google_destination_required' using errcode='22023';
  end if;

  foreach v_target in array v_targets loop
    -- Serialize even the first setting for a user so old/new audit values stay accurate.
    perform pg_advisory_xact_lock(hashtextextended('sph-home:'||v_target::text,0));
    v_now := clock_timestamp();
    select * into v_old from public.sph_rep_settings where user_id=v_target for update;
    insert into public.sph_rep_settings(
      user_id,home_label,home_latitude,home_longitude,home_accuracy_meters,workday_timezone,
      home_geocode_provider,home_place_id,home_updated_by,updated_at
    ) values(v_target,v_label,p_latitude,p_longitude,p_accuracy_meters,p_workday_timezone,
      p_geocode_provider,p_place_id,p_actor_user_id,v_now)
    on conflict(user_id) do update set
      home_label=excluded.home_label,home_latitude=excluded.home_latitude,home_longitude=excluded.home_longitude,
      home_accuracy_meters=excluded.home_accuracy_meters,workday_timezone=excluded.workday_timezone,
      home_geocode_provider=excluded.home_geocode_provider,home_place_id=excluded.home_place_id,
      home_updated_by=excluded.home_updated_by,updated_at=excluded.updated_at;

    insert into private.sph_home_setting_audit(
      organization_id,target_user_id,changed_by,changed_at,old_home_label,old_home_latitude,old_home_longitude,
      new_home_label,new_home_latitude,new_home_longitude,new_home_accuracy_meters,geocode_provider,place_id,
      old_workday_timezone,new_workday_timezone,actor_role,old_home_accuracy_meters
    ) values(p_organization_id,v_target,p_actor_user_id,v_now,v_old.home_label,v_old.home_latitude,v_old.home_longitude,
      v_label,p_latitude,p_longitude,p_accuracy_meters,p_geocode_provider,p_place_id,
      coalesce(v_old.workday_timezone,'America/Los_Angeles'),p_workday_timezone,v_role,v_old.home_accuracy_meters)
    returning id into v_audit_id;
    v_audit_ids := v_audit_ids || jsonb_build_array(v_audit_id);
    -- Use the action accepted by the existing public audit constraint.
    insert into public.sph_home_setting_audit(user_id,changed_by,action)
      values(v_target,p_actor_user_id,'home_location_updated');
  end loop;
  return jsonb_build_object('ok',true,'updated_count',cardinality(v_targets),'target_user_ids',to_jsonb(v_targets),
    'home_label',v_label,'workday_timezone',p_workday_timezone,'audit_ids',v_audit_ids);
end;
$$;
revoke all on function public.set_managed_sph_home_locations(uuid,uuid[],uuid,text,double precision,double precision,double precision,text,text,text)
  from public,anon,authenticated;
grant execute on function public.set_managed_sph_home_locations(uuid,uuid[],uuid,text,double precision,double precision,double precision,text,text,text)
  to service_role;

-- Preserve the legacy service-only Admin entry point with the repaired validation and audit.
create or replace function public.admin_set_sph_home_location(
  p_actor_user_id uuid,p_target_user_id uuid,p_organization_id uuid,p_home_label text,
  p_latitude double precision,p_longitude double precision,p_accuracy_meters double precision,
  p_workday_timezone text,p_geocode_provider text,p_place_id text default null
) returns jsonb language plpgsql security definer
set search_path = pg_catalog,public,auth
as $$
declare v_result jsonb;
begin
  if not exists(select 1 from auth.users au join public.app_user_access a
      on lower(trim(a.email))=lower(trim(au.email))
      where au.id=p_actor_user_id and a.active is true and a.role='admin' and a.organization_id=p_organization_id) then
    raise exception 'admin_required' using errcode='42501';
  end if;
  v_result := public.set_managed_sph_home_locations(p_actor_user_id,array[p_target_user_id],p_organization_id,
    p_home_label,p_latitude,p_longitude,p_accuracy_meters,p_workday_timezone,p_geocode_provider,p_place_id);
  return v_result || jsonb_build_object('audit_id',v_result->'audit_ids'->0);
end;
$$;
revoke all on function public.admin_set_sph_home_location(uuid,uuid,uuid,text,double precision,double precision,double precision,text,text,text)
  from public,anon,authenticated;
grant execute on function public.admin_set_sph_home_location(uuid,uuid,uuid,text,double precision,double precision,double precision,text,text,text)
  to service_role;
-- Ordinary users still cannot replace their own coordinates or view other users' settings.
revoke all on function public.set_sph_home_location(text,double precision,double precision,double precision)
  from public,anon,authenticated;
comment on function public.set_managed_sph_home_locations(uuid,uuid[],uuid,text,double precision,double precision,double precision,text,text,text) is
  'Service-only, audited end-of-shift destination updates. Admins manage their organization; managers/trainers manage explicitly assigned users.';

-- Keep old shifts in their original timezone when a Blitz destination changes.
alter table public.test_sessions add column if not exists sph_workday_timezone text;
update public.test_sessions ts set sph_workday_timezone=coalesce(
  (select workday_timezone from public.sph_rep_settings s where s.user_id=ts.tester_user_id),'America/Los_Angeles')
where ts.sph_workday_timezone is null;
create or replace function private.snapshot_sph_session_timezone()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public
as $$
begin
  if tg_op='UPDATE' then
    new.sph_workday_timezone:=old.sph_workday_timezone;
  else
    -- A workday can contain several knocking sessions. Keep all of them in
    -- the first session's timezone; the new destination timezone starts next workday.
    select ts.sph_workday_timezone into new.sph_workday_timezone
      from public.test_sessions ts
      where ts.tester_user_id=new.tester_user_id and ts.started_at<=new.started_at
        and ts.sph_workday_timezone is not null
        and new.started_at < ((ts.started_at at time zone ts.sph_workday_timezone)::date+1)::timestamp
          at time zone ts.sph_workday_timezone
      order by ts.started_at limit 1;
    if found then return new; end if;
    select coalesce(s.workday_timezone,'America/Los_Angeles') into new.sph_workday_timezone
      from public.sph_rep_settings s where s.user_id=new.tester_user_id;
    new.sph_workday_timezone:=coalesce(new.sph_workday_timezone,'America/Los_Angeles');
  end if;
  return new;
end;
$$;
revoke all on function private.snapshot_sph_session_timezone() from public,anon,authenticated;
create trigger snapshot_sph_session_timezone before insert or update of sph_workday_timezone
  on public.test_sessions for each row execute function private.snapshot_sph_session_timezone();

-- Distances from two different destinations must never form a homeward-travel signal.
alter table public.sph_presence_events
  add column if not exists home_revision_id bigint not null default 0,
  add column if not exists home_destination_accuracy_meters double precision;
create or replace function private.stamp_sph_destination_revision()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public,private
as $$
declare v_audit private.sph_home_setting_audit%rowtype; v_lat double precision; v_lng double precision;
begin
  select * into v_audit from private.sph_home_setting_audit
    where target_user_id=new.rep_user_id and changed_at<=new.event_at order by changed_at desc,id desc limit 1;
  if found then
    new.home_revision_id:=v_audit.id;
    new.home_destination_accuracy_meters:=v_audit.new_home_accuracy_meters;
    v_lat:=v_audit.new_home_latitude;v_lng:=v_audit.new_home_longitude;
  else
    new.home_revision_id:=0;
    select * into v_audit from private.sph_home_setting_audit
      where target_user_id=new.rep_user_id and changed_at>new.event_at order by changed_at,id limit 1;
    if found then
      v_lat:=v_audit.old_home_latitude;v_lng:=v_audit.old_home_longitude;
      new.home_destination_accuracy_meters:=v_audit.old_home_accuracy_meters;
    else
      select home_latitude,home_longitude,home_accuracy_meters into v_lat,v_lng,new.home_destination_accuracy_meters
        from public.sph_rep_settings where user_id=new.rep_user_id;
    end if;
  end if;
  new.distance_home_m:=case when v_lat is not null and v_lng is not null and new.latitude is not null and new.longitude is not null
    then private.mccoy_distance_meters(new.latitude,new.longitude,v_lat,v_lng) else null end;
  return new;
end;
$$;
revoke all on function private.stamp_sph_destination_revision() from public,anon,authenticated;
create trigger stamp_sph_destination_revision before insert on public.sph_presence_events
  for each row execute function private.stamp_sph_destination_revision();

CREATE OR REPLACE FUNCTION private.refresh_automatic_field_workdays(p_since date DEFAULT NULL::date, p_now timestamp with time zone DEFAULT clock_timestamp())
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'auth'
AS $function$
declare
  v_day record;
  v_workday_id bigint;
  v_day_start timestamptz;
  v_calendar_end timestamptz;
  v_raw_end timestamptz;
  v_effective_end timestamptz;
  v_travel_cutoff timestamptz;
  v_working numeric;
  v_idle numeric;
  v_gap numeric;
  v_allowance numeric;
  v_break numeric;
  v_excess numeric;
  v_counted numeric;
  v_processed integer := 0;
begin
  for v_day in
    select
      ts.tester_user_id as rep_user_id,
      ts.organization_id,
      coalesce(nullif(trim(ts.sph_workday_timezone), ''), 'America/Los_Angeles') as workday_timezone,
      timezone(coalesce(nullif(trim(ts.sph_workday_timezone), ''), 'America/Los_Angeles'), ts.started_at)::date as work_date,
      min(ts.started_at) as started_at
    from public.test_sessions ts
    where ts.tester_user_id is not null
      and ts.organization_id is not null
      and ts.started_at >= coalesce(
        p_since,
        timezone(coalesce(nullif(trim(ts.sph_workday_timezone), ''), 'America/Los_Angeles'), p_now)::date - 8
      )::timestamp at time zone coalesce(nullif(trim(ts.sph_workday_timezone), ''), 'America/Los_Angeles')
    group by ts.tester_user_id, ts.organization_id,
      coalesce(nullif(trim(ts.sph_workday_timezone), ''), 'America/Los_Angeles'),
      timezone(coalesce(nullif(trim(ts.sph_workday_timezone), ''), 'America/Los_Angeles'), ts.started_at)::date
  loop
    v_day_start := v_day.work_date::timestamp at time zone v_day.workday_timezone;
    v_calendar_end := (v_day.work_date + 1)::timestamp at time zone v_day.workday_timezone;
    v_raw_end := least(p_now, v_calendar_end);
    v_travel_cutoff := null;

    -- A field exit is accepted only when a sampled interval is vehicle-speed,
    -- moves materially closer to the saved Home point, finishes near Home, and
    -- has no later field/door activity. This avoids treating lunch or territory
    -- changes as the end of the day.
    with ordered as (
      select p.*,
        lag(p.event_at) over (order by p.event_at, p.id) as prev_at,
        lag(p.latitude) over (order by p.event_at, p.id) as prev_latitude,
        lag(p.longitude) over (order by p.event_at, p.id) as prev_longitude,
        lag(p.inside_area) over (order by p.event_at, p.id) as prev_inside_area,
        lag(p.home_revision_id) over (order by p.event_at, p.id) as prev_home_revision_id,
        lag(p.distance_home_m) over (order by p.event_at, p.id) as prev_home_distance,
        lag(p.distance_outside_area_m) over (order by p.event_at, p.id) as prev_outside_distance
      from public.sph_presence_events p
      where p.rep_user_id = v_day.rep_user_id
        and p.event_at >= greatest(v_day.started_at, v_day_start)
        and p.event_at < v_raw_end
        and p.latitude is not null and p.longitude is not null
        and coalesce(p.accuracy_meters, 9999) <= 100
    ), candidates as (
      select o.prev_at as cutoff_at, o.home_revision_id, o.home_destination_accuracy_meters
      from ordered o
      where o.prev_at is not null
        and o.prev_at >= v_day.started_at + interval '1 hour'
        and extract(epoch from o.event_at - o.prev_at) between 10 and 900
        and private.mccoy_distance_meters(
          o.prev_latitude, o.prev_longitude, o.latitude, o.longitude
        ) >= 300
        and private.mccoy_distance_meters(
          o.prev_latitude, o.prev_longitude, o.latitude, o.longitude
        ) / extract(epoch from o.event_at - o.prev_at) > 2.5
        and o.inside_area is false
        and (o.prev_inside_area is true
          or coalesce(o.distance_outside_area_m, 0) > coalesce(o.prev_outside_distance, 0))
        and o.home_revision_id=o.prev_home_revision_id
        and o.prev_home_distance is not null and o.distance_home_m is not null
        and o.prev_home_distance - o.distance_home_m >= 250
        and (o.prev_home_distance - o.distance_home_m) /
          nullif(private.mccoy_distance_meters(
            o.prev_latitude, o.prev_longitude, o.latitude, o.longitude
          ), 0) >= 0.60
    )
    select min(c.cutoff_at) into v_travel_cutoff
    from candidates c
    where exists (
        select 1 from public.sph_presence_events arrived
        where arrived.rep_user_id = v_day.rep_user_id
          and arrived.event_at >= c.cutoff_at and arrived.event_at < v_raw_end
          and arrived.home_revision_id=c.home_revision_id
          and arrived.distance_home_m <= greatest(250, coalesce(c.home_destination_accuracy_meters, 0) * 3)
      )
      and not exists (
        select 1 from public.sph_presence_events returned
        where returned.rep_user_id = v_day.rep_user_id
          and returned.event_at > c.cutoff_at + interval '10 minutes'
          and (returned.inside_area is true or returned.event_type in ('field_start','sale'))
      )
      and not exists (
        select 1
        from public.test_events te
        join public.test_sessions ts on ts.id = te.session_id
        where ts.tester_user_id = v_day.rep_user_id
          and te.event_time > c.cutoff_at + interval '10 minutes'
          and te.event_time < v_raw_end
          and te.event_type in ('door_arrival','disposition','lead_pool_disposition')
      );

    v_effective_end := greatest(v_day.started_at, least(v_raw_end, coalesce(v_travel_cutoff, v_raw_end)));

    insert into private.field_workdays(
      organization_id, rep_user_id, work_date, workday_timezone, started_at,
      effective_end_at, calendar_end_at, status, end_reason, refreshed_at
    ) values (
      v_day.organization_id, v_day.rep_user_id, v_day.work_date, v_day.workday_timezone,
      v_day.started_at, v_effective_end, v_calendar_end,
      case when p_now >= v_calendar_end then 'closed' else 'open' end,
      case when v_travel_cutoff is not null then 'homeward_departure'
           when p_now >= v_calendar_end then 'local_midnight' else 'active' end,
      clock_timestamp()
    )
    on conflict (rep_user_id, work_date) do update set
      organization_id = excluded.organization_id,
      workday_timezone = excluded.workday_timezone,
      started_at = excluded.started_at,
      effective_end_at = excluded.effective_end_at,
      calendar_end_at = excluded.calendar_end_at,
      status = excluded.status,
      end_reason = excluded.end_reason,
      refreshed_at = excluded.refreshed_at
    returning id into v_workday_id;

    delete from private.field_workday_segments where workday_id = v_workday_id;

    with door_ranges as (
      select a.event_time as started_at,
        coalesce((
          select min(d.event_time) from public.test_events d
          where d.session_id = a.session_id
            and d.event_type in ('disposition','door_visit_corrected')
            and d.event_time >= a.event_time
        ), v_effective_end) as ended_at
      from public.test_events a
      join public.test_sessions ts on ts.id = a.session_id
      where ts.tester_user_id = v_day.rep_user_id
        and a.event_type = 'door_arrival'
        and a.event_time >= v_day.started_at and a.event_time < v_effective_end
    ), source_points as (
      select p.event_at, p.latitude, p.longitude, p.accuracy_meters
      from public.sph_presence_events p
      where p.rep_user_id = v_day.rep_user_id
        and p.event_at >= v_day.started_at and p.event_at <= v_effective_end
      union
      select te.event_time, te.latitude, te.longitude, te.accuracy_meters
      from public.test_events te
      join public.test_sessions ts on ts.id = te.session_id
      where ts.tester_user_id = v_day.rep_user_id
        and te.event_time >= v_day.started_at and te.event_time <= v_effective_end
        and te.event_type in ('session_start','door_arrival','disposition','lead_pool_disposition')
      union all select v_day.started_at, null::double precision, null::double precision, null::double precision
      union all select v_effective_end, null::double precision, null::double precision, null::double precision
    ), points as (
      select distinct on (event_at) event_at, latitude, longitude, accuracy_meters
      from source_points order by event_at, latitude nulls last
    ), intervals as (
      select event_at as started_at,
        lead(event_at) over (order by event_at) as ended_at,
        latitude, longitude,
        lead(latitude) over (order by event_at) as next_latitude,
        lead(longitude) over (order by event_at) as next_longitude,
        accuracy_meters,
        lead(accuracy_meters) over (order by event_at) as next_accuracy
      from points
    ), classified as (
      select i.*,
        extract(epoch from i.ended_at - i.started_at)::numeric as seconds,
        private.mccoy_distance_meters(i.latitude, i.longitude, i.next_latitude, i.next_longitude) as movement_m,
        exists(select 1 from door_ranges d where d.started_at < i.ended_at and d.ended_at > i.started_at) as at_door
      from intervals i
      where i.ended_at is not null and i.ended_at > i.started_at
    )
    insert into private.field_workday_segments(
      workday_id, segment_type, started_at, ended_at, duration_seconds,
      sph_counted_seconds, reason, evidence
    )
    select v_workday_id,
      case
        when c.at_door then 'working'
        when c.seconds > 900 then 'tracking_gap'
        when c.latitude is null or c.longitude is null
          or c.next_latitude is null or c.next_longitude is null then 'tracking_gap'
        when coalesce(c.accuracy_meters,9999) > 100 or coalesce(c.next_accuracy,9999) > 100 then 'tracking_gap'
        when coalesce(c.movement_m,0) >= 15 then 'working'
        else 'break'
      end,
      c.started_at, c.ended_at, c.seconds,
      case when c.at_door or (c.seconds <= 900 and coalesce(c.movement_m,0) >= 15) then c.seconds else 0 end,
      case
        when c.at_door then 'customer_interaction'
        when c.seconds > 900 then 'telemetry_missing_over_15_minutes'
        when c.latitude is null or c.longitude is null
          or c.next_latitude is null or c.next_longitude is null then 'location_unavailable'
        when coalesce(c.accuracy_meters,9999) > 100 or coalesce(c.next_accuracy,9999) > 100 then 'location_accuracy_over_100m'
        when coalesce(c.movement_m,0) >= 15 then 'verified_movement'
        else 'automatic_idle'
      end,
      jsonb_build_object(
        'movement_meters', c.movement_m,
        'start_accuracy_meters', c.accuracy_meters,
        'end_accuracy_meters', c.next_accuracy,
        'door_interaction', c.at_door
      )
    from classified c;

    if v_travel_cutoff is not null and v_raw_end > v_travel_cutoff then
      insert into private.field_workday_segments(
        workday_id, segment_type, started_at, ended_at, duration_seconds,
        sph_counted_seconds, excluded_from_session, reason, evidence
      ) values (
        v_workday_id, 'tracking_gap', v_travel_cutoff, v_raw_end,
        extract(epoch from v_raw_end - v_travel_cutoff), 0, true,
        'homeward_travel_and_post_work_idle_excluded',
        jsonb_build_object('policy','sustained_vehicle_speed_toward_saved_home_no_later_field_activity')
      );
    end if;

    select
      coalesce(sum(duration_seconds) filter (where segment_type = 'working'), 0),
      coalesce(sum(duration_seconds) filter (where segment_type = 'break'), 0),
      coalesce(sum(duration_seconds) filter (where segment_type = 'tracking_gap' and excluded_from_session is false), 0)
    into v_working, v_idle, v_gap
    from private.field_workday_segments where workday_id = v_workday_id;

    v_allowance := v_working / 8;
    v_break := least(v_idle, v_allowance);
    v_excess := greatest(v_idle - v_allowance, 0);
    v_counted := v_working + v_excess;

    with allocation as (
      select id, duration_seconds,
        coalesce(sum(duration_seconds) over (
          order by started_at, id rows between unbounded preceding and 1 preceding
        ), 0) as prior_idle
      from private.field_workday_segments
      where workday_id = v_workday_id and segment_type = 'break'
    )
    update private.field_workday_segments s set
      break_seconds_applied = least(a.duration_seconds, greatest(v_allowance - a.prior_idle, 0)),
      excessive_idle_seconds = greatest(a.duration_seconds - greatest(v_allowance - a.prior_idle, 0), 0),
      sph_counted_seconds = greatest(a.duration_seconds - greatest(v_allowance - a.prior_idle, 0), 0)
    from allocation a where s.id = a.id;

    update private.field_workdays set
      working_seconds = v_working,
      break_allowance_seconds = v_allowance,
      break_seconds = v_break,
      excessive_idle_seconds = v_excess,
      tracking_gap_seconds = v_gap,
      excluded_travel_seconds = case when v_travel_cutoff is null then 0 else extract(epoch from v_raw_end - v_travel_cutoff) end,
      sph_counted_seconds = v_counted,
      refreshed_at = clock_timestamp()
    where id = v_workday_id;
    v_processed := v_processed + 1;
  end loop;
  return v_processed;
end;
$function$;

revoke all on function private.refresh_automatic_field_workdays(date,timestamptz) from public,anon,authenticated;
grant execute on function private.refresh_automatic_field_workdays(date,timestamptz) to service_role;
CREATE OR REPLACE FUNCTION private.close_stale_field_sessions()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare v_closed integer := 0;
begin
  with due as (
    select ts.id,
      (timezone(coalesce(nullif(trim(ts.sph_workday_timezone),''),'America/Los_Angeles'),ts.started_at)::date + 1)::timestamp
        at time zone coalesce(nullif(trim(ts.sph_workday_timezone),''),'America/Los_Angeles') as midnight_at
    from public.test_sessions ts
    where ts.ended_at is null and ts.started_at is not null
  ), updated as (
    update public.test_sessions ts set ended_at = due.midnight_at
    from due where ts.id = due.id and due.midnight_at <= clock_timestamp()
    returning ts.id, ts.ended_at
  )
  insert into public.field_session_auto_closures(session_id,last_activity_at,closed_at,reason)
  select u.id, u.ended_at, u.ended_at, 'local_midnight' from updated u
  on conflict(session_id) do update set
    last_activity_at = excluded.last_activity_at,
    closed_at = excluded.closed_at,
    reason = excluded.reason;
  get diagnostics v_closed = row_count;
  perform private.refresh_automatic_field_workdays(null, clock_timestamp());
  return v_closed;
end;
$function$;
