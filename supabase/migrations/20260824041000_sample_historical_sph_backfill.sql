-- The live telemetry stream can emit many events per minute. Sales/Hour only
-- needs the five-minute presence cadence used by the new client, plus exact
-- field-session boundaries and sale events. This keeps backfill resumable and
-- avoids repeatedly classifying redundant coordinates against large lead pools.
create or replace function private.backfill_sph_presence(p_limit integer default 200)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, auth, private
as $function$
declare v_count integer:=0;
begin
  if p_limit is null or p_limit not between 1 and 500 then raise exception 'backfill_limit_1_to_500' using errcode='22023';end if;
  with raw_candidates as (
    select e.*,s.tester_user_id,
      row_number() over(
        partition by s.tester_user_id,date_bin(interval '5 minutes',e.event_time,timestamptz '2000-01-01 00:00:00+00')
        order by e.event_time,e.id
      ) bucket_rank
    from public.test_events e
    join public.test_sessions s on s.id=e.session_id and s.tester_user_id is not null
    where e.latitude is not null and e.longitude is not null
      and coalesce(e.accuracy_meters,0)<=100
      and e.event_time>=date_trunc('week',timezone('America/Los_Angeles',clock_timestamp())) at time zone 'America/Los_Angeles'
  ), candidates as (
    select e.*
    from raw_candidates e
    where (e.bucket_rank=1
      or e.event_type in ('session_start','session_end')
      or (e.event_type='disposition' and lower(coalesce(e.disposition,''))='sale'))
      and not exists(select 1 from public.sph_presence_events p where p.source_test_event_id=e.id)
    order by e.id
    limit p_limit
  )
  insert into public.sph_presence_events(
    rep_user_id,event_at,event_type,latitude,longitude,accuracy_meters,
    inside_area,distance_outside_area_m,distance_home_m,area_basis,source_test_event_id
  )
  select e.tester_user_id,e.event_time,
    case when e.event_type='session_start' then 'field_start'
         when e.event_type='session_end' then 'field_end'
         when e.event_type='disposition' and lower(coalesce(e.disposition,''))='sale' then 'sale'
         else 'historical' end,
    e.latitude,e.longitude,e.accuracy_meters,
    (area.snapshot->>'inside_area')::boolean,
    (area.snapshot->>'distance_outside_area_m')::double precision,
    case when h.home_latitude is not null then private.mccoy_distance_meters(
      e.latitude,e.longitude,h.home_latitude,h.home_longitude) end,
    coalesce(area.snapshot->>'area_basis','none'),e.id
  from candidates e
  left join public.sph_rep_settings h on h.user_id=e.tester_user_id
  cross join lateral (select private.sph_area_snapshot(e.tester_user_id,e.latitude,e.longitude) snapshot) area
  on conflict(source_test_event_id) where source_test_event_id is not null do nothing;
  get diagnostics v_count=row_count;
  return v_count;
end;
$function$;

revoke all on function private.backfill_sph_presence(integer) from public,anon,authenticated;
grant execute on function private.backfill_sph_presence(integer) to service_role;
