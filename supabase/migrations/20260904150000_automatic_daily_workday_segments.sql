-- Automatic Field Coach workdays and fair Sales/Hour accounting.
-- A rep starts the day once. The server derives Working, Break, and Tracking Gap
-- segments, accrues break allowance at 1 second per 8 working seconds, counts
-- excessive idle in the SPH denominator, excludes unverified tracking gaps, and
-- conservatively removes a sustained homeward drive from the field workday.

alter table public.sph_rep_settings
  add column if not exists workday_timezone text not null default 'America/Los_Angeles';

create table if not exists private.field_workdays (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id),
  rep_user_id uuid not null references auth.users(id) on delete cascade,
  work_date date not null,
  workday_timezone text not null,
  started_at timestamptz not null,
  effective_end_at timestamptz not null,
  calendar_end_at timestamptz not null,
  status text not null check (status in ('open','closed')),
  end_reason text not null check (end_reason in ('active','local_midnight','homeward_departure')),
  working_seconds numeric not null default 0 check (working_seconds >= 0),
  break_allowance_seconds numeric not null default 0 check (break_allowance_seconds >= 0),
  break_seconds numeric not null default 0 check (break_seconds >= 0),
  excessive_idle_seconds numeric not null default 0 check (excessive_idle_seconds >= 0),
  tracking_gap_seconds numeric not null default 0 check (tracking_gap_seconds >= 0),
  excluded_travel_seconds numeric not null default 0 check (excluded_travel_seconds >= 0),
  sph_counted_seconds numeric not null default 0 check (sph_counted_seconds >= 0),
  policy_version text not null default 'automatic-workday-v1',
  refreshed_at timestamptz not null default clock_timestamp(),
  unique (rep_user_id, work_date)
);

create table if not exists private.field_workday_segments (
  id bigint generated always as identity primary key,
  workday_id bigint not null references private.field_workdays(id) on delete cascade,
  segment_type text not null check (segment_type in ('working','break','tracking_gap')),
  started_at timestamptz not null,
  ended_at timestamptz not null,
  duration_seconds numeric not null check (duration_seconds >= 0),
  break_seconds_applied numeric not null default 0 check (break_seconds_applied >= 0),
  excessive_idle_seconds numeric not null default 0 check (excessive_idle_seconds >= 0),
  sph_counted_seconds numeric not null default 0 check (sph_counted_seconds >= 0),
  excluded_from_session boolean not null default false,
  reason text not null,
  evidence jsonb not null default '{}'::jsonb,
  check (ended_at >= started_at)
);

create index if not exists field_workdays_rep_date_idx
  on private.field_workdays (rep_user_id, work_date desc);
create index if not exists field_workdays_org_date_idx
  on private.field_workdays (organization_id, work_date desc);
create index if not exists field_workday_segments_day_start_idx
  on private.field_workday_segments (workday_id, started_at);
create index if not exists sph_presence_rep_event_idx
  on public.sph_presence_events (rep_user_id, event_at);
create index if not exists test_sessions_open_rep_started_idx
  on public.test_sessions (tester_user_id, started_at)
  where ended_at is null;

revoke all on table private.field_workdays, private.field_workday_segments
  from public, anon, authenticated;
revoke all on sequence private.field_workdays_id_seq, private.field_workday_segments_id_seq
  from public, anon, authenticated;
grant usage on schema private to service_role;
grant select, insert, update, delete on private.field_workdays, private.field_workday_segments to service_role;
grant usage, select on sequence private.field_workdays_id_seq, private.field_workday_segments_id_seq to service_role;

create or replace function private.automatic_break_totals(
  p_working_seconds numeric,
  p_idle_seconds numeric
)
returns jsonb
language sql
immutable
set search_path = pg_catalog
as $function$
  select jsonb_build_object(
    'working_seconds', greatest(coalesce(p_working_seconds, 0), 0),
    'break_allowance_seconds', greatest(coalesce(p_working_seconds, 0), 0) / 8,
    'break_seconds', least(
      greatest(coalesce(p_idle_seconds, 0), 0),
      greatest(coalesce(p_working_seconds, 0), 0) / 8
    ),
    'excessive_idle_seconds', greatest(
      greatest(coalesce(p_idle_seconds, 0), 0) - greatest(coalesce(p_working_seconds, 0), 0) / 8,
      0
    ),
    'sph_counted_seconds', greatest(coalesce(p_working_seconds, 0), 0) + greatest(
      greatest(coalesce(p_idle_seconds, 0), 0) - greatest(coalesce(p_working_seconds, 0), 0) / 8,
      0
    )
  );
$function$;
revoke all on function private.automatic_break_totals(numeric,numeric)
  from public, anon, authenticated;

create or replace function private.refresh_automatic_field_workdays(
  p_since date default null,
  p_now timestamptz default clock_timestamp()
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, private, auth
as $function$
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
      coalesce(nullif(trim(sr.workday_timezone), ''), 'America/Los_Angeles') as workday_timezone,
      timezone(coalesce(nullif(trim(sr.workday_timezone), ''), 'America/Los_Angeles'), ts.started_at)::date as work_date,
      min(ts.started_at) as started_at
    from public.test_sessions ts
    left join public.sph_rep_settings sr on sr.user_id = ts.tester_user_id
    where ts.tester_user_id is not null
      and ts.organization_id is not null
      and ts.started_at >= coalesce(
        p_since,
        timezone(coalesce(nullif(trim(sr.workday_timezone), ''), 'America/Los_Angeles'), p_now)::date - 8
      )::timestamp at time zone coalesce(nullif(trim(sr.workday_timezone), ''), 'America/Los_Angeles')
    group by ts.tester_user_id, ts.organization_id,
      coalesce(nullif(trim(sr.workday_timezone), ''), 'America/Los_Angeles'),
      timezone(coalesce(nullif(trim(sr.workday_timezone), ''), 'America/Los_Angeles'), ts.started_at)::date
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
        lag(p.distance_home_m) over (order by p.event_at, p.id) as prev_home_distance,
        lag(p.distance_outside_area_m) over (order by p.event_at, p.id) as prev_outside_distance
      from public.sph_presence_events p
      where p.rep_user_id = v_day.rep_user_id
        and p.event_at >= greatest(v_day.started_at, v_day_start)
        and p.event_at < v_raw_end
        and p.latitude is not null and p.longitude is not null
        and coalesce(p.accuracy_meters, 9999) <= 100
    ), candidates as (
      select o.prev_at as cutoff_at
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
        and o.prev_home_distance is not null and o.distance_home_m is not null
        and o.prev_home_distance - o.distance_home_m >= 250
        and (o.prev_home_distance - o.distance_home_m) /
          nullif(private.mccoy_distance_meters(
            o.prev_latitude, o.prev_longitude, o.latitude, o.longitude
          ), 0) >= 0.60
    )
    select min(c.cutoff_at) into v_travel_cutoff
    from candidates c
    join public.sph_rep_settings home on home.user_id = v_day.rep_user_id
    where home.home_latitude is not null and home.home_longitude is not null
      and exists (
        select 1 from public.sph_presence_events arrived
        where arrived.rep_user_id = v_day.rep_user_id
          and arrived.event_at >= c.cutoff_at and arrived.event_at < v_raw_end
          and arrived.distance_home_m <= greatest(250, coalesce(home.home_accuracy_meters, 0) * 3)
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
revoke all on function private.refresh_automatic_field_workdays(date,timestamptz)
  from public, anon, authenticated;
grant execute on function private.refresh_automatic_field_workdays(date,timestamptz) to service_role;

-- Stale telemetry is a Tracking Gap, not proof that the rep stopped working.
-- Only local midnight closes an open session. The derivation job later excludes
-- a verified homeward drive and applies the automatic break bank.
create or replace function private.close_stale_field_sessions()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare v_closed integer := 0;
begin
  with due as (
    select ts.id,
      (timezone(coalesce(nullif(trim(sr.workday_timezone),''),'America/Los_Angeles'),ts.started_at)::date + 1)::timestamp
        at time zone coalesce(nullif(trim(sr.workday_timezone),''),'America/Los_Angeles') as midnight_at
    from public.test_sessions ts
    left join public.sph_rep_settings sr on sr.user_id = ts.tester_user_id
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
revoke all on function private.close_stale_field_sessions() from public, anon, authenticated;
grant execute on function private.close_stale_field_sessions() to service_role;

alter table public.field_session_auto_closures drop constraint if exists field_session_auto_closures_reason_check;
alter table public.field_session_auto_closures add constraint field_session_auto_closures_reason_check
  check (reason in ('inactive_30_minutes','maximum_16_hours','local_midnight'));

select cron.schedule(
  'close-stale-field-sessions',
  '*/5 * * * *',
  $cron$select private.close_stale_field_sessions();$cron$
);

create or replace function public.record_field_session_heartbeat(p_session_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $function$
declare v_server_at timestamptz := clock_timestamp();v_event_id bigint;
begin
  if (select auth.uid()) is null then raise exception 'authentication_required' using errcode='42501';end if;
  insert into public.test_events(session_id,event_type,event_time,payload)
  select s.id,'field_session_heartbeat',v_server_at,
    jsonb_build_object('server_generated',true,'activity','workday_presence','contains_location',false)
  from public.test_sessions s
  where s.id=p_session_id and s.tester_user_id=(select auth.uid())
    and s.ended_at is null and s.started_at<=v_server_at
  returning id into v_event_id;
  if v_event_id is null then return jsonb_build_object('ok',false,'reason','session_not_open_or_not_owned');end if;
  return jsonb_build_object('ok',true,'session_id',p_session_id,'server_at',v_server_at,'event_id',v_event_id);
end;
$function$;
revoke all on function public.record_field_session_heartbeat(uuid) from public, anon;
grant execute on function public.record_field_session_heartbeat(uuid) to authenticated;

create or replace function private.get_authoritative_sph_metrics()
returns table(rep_name text, role text, team_name text, metric jsonb, sph_rank integer)
language sql
stable
security definer
set search_path = pg_catalog, public, auth, private
as $function$
with settings as (
  select lower(trim(ghost_email)) ghost_email from public.ghost_ranking_settings where singleton is true
), accounts as (
  select au.id auth_user_id, lower(trim(a.email)) email,
    coalesce(nullif(trim(a.display_name),''),'Rep') rep_name,
    lower(a.role) role, nullif(trim(a.team_name),'') team_name,
    coalesce(nullif(trim(sr.workday_timezone),''),'America/Los_Angeles') workday_timezone
  from public.app_user_access a
  join auth.users au on lower(trim(au.email))=lower(trim(a.email))
  left join public.sph_rep_settings sr on sr.user_id=au.id
  cross join settings s
  where a.active is true and lower(trim(a.email))<>s.ghost_email
), day_totals as (
  select a.auth_user_id,
    coalesce(sum(w.sph_counted_seconds),0)::numeric counted_seconds,
    coalesce(sum(w.working_seconds),0)::numeric working_seconds,
    coalesce(sum(w.break_seconds),0)::numeric break_seconds,
    coalesce(sum(w.excessive_idle_seconds),0)::numeric excessive_idle_seconds,
    coalesce(sum(w.tracking_gap_seconds),0)::numeric tracking_gap_seconds,
    coalesce(sum(w.excluded_travel_seconds),0)::numeric excluded_travel_seconds,
    count(w.id)::int days_counted
  from accounts a left join private.field_workdays w
    on w.rep_user_id=a.auth_user_id
    and w.work_date>=date_trunc('week',timezone(a.workday_timezone,clock_timestamp()))::date
    and w.work_date<=timezone(a.workday_timezone,clock_timestamp())::date
    and extract(isodow from w.work_date)<>7
  group by a.auth_user_id
), eligible_sales as (
  select a.auth_user_id,count(*)::int week_sales
  from accounts a
  join public.sales_records sr on lower(trim(sr.rep_email))=a.email
  left join public.provider_sales_rows p on p.id=sr.provider_sale_row_id
  where sr.ranking_eligible is true
    and private.sale_ranking_at(sr.order_date,p.sale_date,sr.created_at)
      >= date_trunc('week',timezone(a.workday_timezone,clock_timestamp())) at time zone a.workday_timezone
    and exists (
      select 1 from private.field_workdays w
      where w.rep_user_id=a.auth_user_id
        and private.sale_ranking_at(sr.order_date,p.sale_date,sr.created_at)
          between w.started_at and w.effective_end_at
    )
  group by a.auth_user_id
), aggregated as (
  select a.*,d.counted_seconds,d.working_seconds,d.break_seconds,
    d.excessive_idle_seconds,d.tracking_gap_seconds,d.excluded_travel_seconds,d.days_counted,
    coalesce(s.week_sales,0)::int week_sales,
    case when d.counted_seconds>0 then round(coalesce(s.week_sales,0)::numeric/(d.counted_seconds/3600),4) else 0::numeric end rate
  from accounts a join day_totals d using(auth_user_id)
  left join eligible_sales s using(auth_user_id)
), ranked as (
  select ag.*,row_number() over(order by (counted_seconds>0) desc,rate desc,week_sales desc,lower(rep_name),email)::int sph_rank
  from aggregated ag
)
select r.rep_name,r.role,r.team_name,jsonb_build_object(
  'period','week','rate',r.rate,'tracked_hours',round(r.counted_seconds/3600,4),'rank',r.sph_rank,
  'week_sales',r.week_sales,'qualified',r.counted_seconds>=3600,'provisional',r.counted_seconds<3600,
  'minimum_tracked_hours',1,'days_counted',r.days_counted,
  'working_hours',round(r.working_seconds/3600,4),
  'automatic_break_hours_excluded',round(r.break_seconds/3600,4),
  'excessive_idle_hours_counted',round(r.excessive_idle_seconds/3600,4),
  'tracking_gap_hours_excluded',round(r.tracking_gap_seconds/3600,4),
  'homeward_travel_hours_excluded',round(r.excluded_travel_seconds/3600,4),
  'source','automatic_daily_workday_segments','start_knocking_required',true,
  'manual_break_or_stop_required',false,'break_accrual_ratio','1:8',
  'segment_types',jsonb_build_array('working','break','tracking_gap'),
  'end_rules',jsonb_build_array('verified_homeward_departure','local_midnight')
) metric,r.sph_rank from ranked r;
$function$;
revoke all on function private.get_authoritative_sph_metrics() from public, anon, authenticated, service_role;

select private.refresh_automatic_field_workdays(
  date_trunc('week', timezone('America/Los_Angeles', clock_timestamp()))::date,
  clock_timestamp()
);
