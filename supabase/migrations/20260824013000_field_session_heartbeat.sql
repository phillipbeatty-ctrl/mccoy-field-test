-- Keep genuinely active foreground field sessions alive with an authenticated,
-- server-timestamped heartbeat. Retain the 30-minute inactivity timeout and
-- add an absolute 16-hour safety cap so a forgotten foreground tablet cannot
-- keep a session open forever.

alter table public.field_session_auto_closures
  drop constraint field_session_auto_closures_reason_check;

alter table public.field_session_auto_closures
  add constraint field_session_auto_closures_reason_check
  check (reason in ('inactive_30_minutes', 'maximum_16_hours'));

create or replace function public.record_field_session_heartbeat(p_session_id uuid)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_server_at timestamptz := clock_timestamp();
  v_event_id bigint;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  insert into public.test_events(session_id, event_type, event_time, payload)
  select
    s.id,
    'field_session_heartbeat',
    v_server_at,
    jsonb_build_object(
      'server_generated', true,
      'activity', 'actively_knocking',
      'contains_location', false
    )
  from public.test_sessions s
  where s.id = p_session_id
    and s.tester_user_id = (select auth.uid())
    and s.ended_at is null
    and s.started_at <= v_server_at
    and s.started_at > v_server_at - interval '16 hours'
  returning id into v_event_id;

  if v_event_id is null then
    return jsonb_build_object('ok', false, 'reason', 'session_not_open_or_not_owned');
  end if;

  return jsonb_build_object(
    'ok', true,
    'session_id', p_session_id,
    'server_at', v_server_at,
    'event_id', v_event_id
  );
end;
$$;

revoke all on function public.record_field_session_heartbeat(uuid) from public, anon;
grant execute on function public.record_field_session_heartbeat(uuid) to authenticated;

comment on function public.record_field_session_heartbeat(uuid) is
  'Records a server-timestamped heartbeat only for the authenticated user own open field session; contains no GPS or customer data.';

create or replace function private.close_stale_field_sessions()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_closed integer := 0;
begin
  with candidates as materialized (
    select
      ts.id,
      greatest(ts.started_at, coalesce(events.last_event_at, ts.started_at)) as last_activity_at,
      case
        when ts.started_at <= now() - interval '16 hours' then ts.started_at + interval '16 hours'
        else greatest(
          ts.started_at,
          least(
            coalesce(events.last_event_at, ts.started_at + interval '30 minutes'),
            ts.started_at + interval '16 hours',
            now()
          )
        )
      end as close_at,
      case
        when ts.started_at <= now() - interval '16 hours' then 'maximum_16_hours'
        else 'inactive_30_minutes'
      end as close_reason
    from public.test_sessions ts
    left join lateral (
      select max(te.event_time) as last_event_at
      from public.test_events te
      where te.session_id = ts.id
    ) events on true
    where ts.ended_at is null
      and ts.started_at is not null
      and (
        ts.started_at <= now() - interval '16 hours'
        or greatest(ts.started_at, coalesce(events.last_event_at, ts.started_at))
          < now() - interval '30 minutes'
      )
  ),
  updated as (
    update public.test_sessions ts
    set ended_at = c.close_at
    from candidates c
    where ts.id = c.id
      and ts.ended_at is null
    returning ts.id, c.last_activity_at, ts.ended_at, c.close_reason
  )
  insert into public.field_session_auto_closures(session_id, last_activity_at, closed_at, reason)
  select id, last_activity_at, ended_at, close_reason
  from updated
  on conflict (session_id) do nothing;

  get diagnostics v_closed = row_count;
  return v_closed;
end;
$$;

revoke all on function private.close_stale_field_sessions() from public, anon, authenticated;
grant execute on function private.close_stale_field_sessions() to service_role;

