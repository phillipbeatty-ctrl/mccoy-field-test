-- Admin-managed home locations and an Admin-only workday evidence timeline.

alter table public.sph_rep_settings
  add column if not exists home_geocode_provider text,
  add column if not exists home_place_id text,
  add column if not exists home_updated_by uuid;

create table if not exists private.sph_home_setting_audit (
  id bigint generated always as identity primary key,
  organization_id uuid not null,
  target_user_id uuid not null,
  changed_by uuid not null,
  changed_at timestamptz not null default clock_timestamp(),
  old_home_label text,
  old_home_latitude double precision,
  old_home_longitude double precision,
  new_home_label text not null,
  new_home_latitude double precision not null,
  new_home_longitude double precision not null,
  new_home_accuracy_meters double precision not null,
  geocode_provider text not null,
  place_id text
);

create index if not exists sph_home_setting_audit_target_time_idx
  on private.sph_home_setting_audit(target_user_id, changed_at desc);

revoke all on table private.sph_home_setting_audit from public, anon, authenticated;
grant select, insert on table private.sph_home_setting_audit to service_role;
grant usage, select on sequence private.sph_home_setting_audit_id_seq to service_role;

-- A rep can no longer set or replace Home. The Admin Edge operation below is the
-- only granted writer and records the old and new values in the same transaction.
revoke all on function public.set_sph_home_location(text,double precision,double precision,double precision)
  from public, anon, authenticated;

create or replace function public.admin_set_sph_home_location(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_organization_id uuid,
  p_home_label text,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_meters double precision,
  p_workday_timezone text,
  p_geocode_provider text,
  p_place_id text default null
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth, private
as $$
declare
  v_actor_email text;
  v_target_email text;
  v_old public.sph_rep_settings%rowtype;
  v_label text := nullif(trim(regexp_replace(coalesce(p_home_label,''),'\s+',' ','g')),'');
  v_audit_id bigint;
begin
  select lower(trim(email)) into v_actor_email from auth.users where id=p_actor_user_id;
  if v_actor_email is null or not exists (
    select 1 from public.app_user_access a
    where lower(trim(a.email))=v_actor_email and a.active is true and a.role='admin'
      and a.organization_id=p_organization_id
  ) then raise exception 'admin_required' using errcode='42501'; end if;

  select lower(trim(email)) into v_target_email from auth.users where id=p_target_user_id;
  if v_target_email is null or not exists (
    select 1 from public.app_user_access a
    where lower(trim(a.email))=v_target_email and a.active is true
      and a.organization_id=p_organization_id
  ) then raise exception 'target_user_not_in_organization' using errcode='42501'; end if;

  if v_label is null or char_length(v_label)>240 then
    raise exception 'valid_home_address_required' using errcode='22023';
  end if;
  if p_latitude is null or p_latitude not between -90 and 90
     or p_longitude is null or p_longitude not between -180 and 180
     or p_accuracy_meters is null or p_accuracy_meters not between 1 and 100 then
    raise exception 'valid_geocoded_home_required' using errcode='22023';
  end if;
  if nullif(trim(p_workday_timezone),'') is null or char_length(p_workday_timezone)>80 then
    raise exception 'valid_workday_timezone_required' using errcode='22023';
  end if;

  select * into v_old from public.sph_rep_settings where user_id=p_target_user_id for update;

  insert into public.sph_rep_settings(
    user_id,home_label,home_latitude,home_longitude,home_accuracy_meters,
    workday_timezone,home_geocode_provider,home_place_id,home_updated_by,updated_at
  ) values (
    p_target_user_id,v_label,p_latitude,p_longitude,p_accuracy_meters,
    p_workday_timezone,p_geocode_provider,p_place_id,p_actor_user_id,clock_timestamp()
  ) on conflict(user_id) do update set
    home_label=excluded.home_label,
    home_latitude=excluded.home_latitude,
    home_longitude=excluded.home_longitude,
    home_accuracy_meters=excluded.home_accuracy_meters,
    workday_timezone=excluded.workday_timezone,
    home_geocode_provider=excluded.home_geocode_provider,
    home_place_id=excluded.home_place_id,
    home_updated_by=excluded.home_updated_by,
    updated_at=excluded.updated_at;

  insert into private.sph_home_setting_audit(
    organization_id,target_user_id,changed_by,
    old_home_label,old_home_latitude,old_home_longitude,
    new_home_label,new_home_latitude,new_home_longitude,new_home_accuracy_meters,
    geocode_provider,place_id
  ) values (
    p_organization_id,p_target_user_id,p_actor_user_id,
    v_old.home_label,v_old.home_latitude,v_old.home_longitude,
    v_label,p_latitude,p_longitude,p_accuracy_meters,
    p_geocode_provider,p_place_id
  ) returning id into v_audit_id;

  insert into public.sph_home_setting_audit(user_id,changed_by,action)
  values(p_target_user_id,p_actor_user_id,'admin_home_location_updated');

  return jsonb_build_object('ok',true,'audit_id',v_audit_id,'home_label',v_label,
    'workday_timezone',p_workday_timezone);
end;
$$;

revoke all on function public.admin_set_sph_home_location(uuid,uuid,uuid,text,double precision,double precision,double precision,text,text,text)
  from public, anon, authenticated;
grant execute on function public.admin_set_sph_home_location(uuid,uuid,uuid,text,double precision,double precision,double precision,text,text,text)
  to service_role;

create or replace function public.get_admin_workday_timeline(
  p_work_date date,
  p_rep_user_id uuid default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth, private
as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text;
  v_org uuid;
  v_result jsonb;
begin
  if v_uid is null then raise exception 'authentication_required' using errcode='42501'; end if;
  select lower(trim(email)) into v_email from auth.users where id=v_uid;
  select organization_id into v_org from public.app_user_access
    where lower(trim(email))=v_email and active is true and role='admin';
  if v_org is null then raise exception 'admin_required' using errcode='42501'; end if;
  if p_work_date is null or p_work_date > current_date then
    raise exception 'valid_non_future_work_date_required' using errcode='22023';
  end if;
  if p_rep_user_id is not null and not exists (
    select 1 from private.field_workdays w
    where w.organization_id=v_org and w.rep_user_id=p_rep_user_id
  ) then raise exception 'rep_not_in_organization' using errcode='42501'; end if;

  with selected_days as (
    select w.*,
      coalesce(a.display_name,au.email,'User') as user_name,
      au.email as user_email
    from private.field_workdays w
    join auth.users au on au.id=w.rep_user_id
    left join public.app_user_access a
      on lower(trim(a.email))=lower(trim(au.email)) and a.organization_id=w.organization_id
    where w.organization_id=v_org and w.work_date=p_work_date
      and (p_rep_user_id is null or w.rep_user_id=p_rep_user_id)
  ), expanded as (
    select d.id as workday_id,d.rep_user_id,
      case when s.excluded_from_session then 'homeward_travel'
           when s.segment_type='working' then 'working'
           when s.segment_type='tracking_gap' then 'tracking_gap'
           when part.kind='allowed' then 'allowed_break'
           else 'excessive_idle' end as display_type,
      case when s.segment_type='break' and part.kind='excessive'
           then s.started_at + make_interval(secs=>s.break_seconds_applied::double precision)
           else s.started_at end as started_at,
      case when s.segment_type='break' and part.kind='allowed'
           then s.started_at + make_interval(secs=>s.break_seconds_applied::double precision)
           else s.ended_at end as ended_at,
      case when s.segment_type='break' and part.kind='allowed' then s.break_seconds_applied
           when s.segment_type='break' and part.kind='excessive' then s.excessive_idle_seconds
           else s.duration_seconds end as duration_seconds,
      s.reason,s.evidence,s.excluded_from_session
    from selected_days d
    join private.field_workday_segments s on s.workday_id=d.id
    cross join lateral (
      select 'whole'::text as kind where s.segment_type<>'break'
      union all select 'allowed' where s.segment_type='break' and s.break_seconds_applied>0
      union all select 'excessive' where s.segment_type='break' and s.excessive_idle_seconds>0
    ) part
  ), detailed as (
    select e.*,
      samples.sample_count,samples.average_accuracy_meters,samples.maximum_accuracy_meters,
      samples.maximum_distance_outside_area_meters,samples.area_basis,
      case when coalesce(samples.sample_count,0)=0 or samples.average_accuracy_meters is null then 'unavailable'
           when samples.average_accuracy_meters<=20 then 'high'
           when samples.average_accuracy_meters<=50 then 'medium'
           when samples.average_accuracy_meters<=100 then 'low'
           else 'poor' end as gps_confidence
    from expanded e
    left join lateral (
      select count(*)::integer as sample_count,
        round(avg(p.accuracy_meters)::numeric,1) as average_accuracy_meters,
        round(max(p.accuracy_meters)::numeric,1) as maximum_accuracy_meters,
        round(max(coalesce(p.distance_outside_area_m,0))::numeric,1) as maximum_distance_outside_area_meters,
        string_agg(distinct coalesce(p.area_basis,'none'),', ' order by coalesce(p.area_basis,'none')) as area_basis
      from public.sph_presence_events p
      where p.rep_user_id=e.rep_user_id and p.event_at>=e.started_at and p.event_at<=e.ended_at
    ) samples on true
  ), day_json as (
    select d.id,jsonb_build_object(
      'id',d.id,'rep_user_id',d.rep_user_id,'user_name',d.user_name,'user_email',d.user_email,
      'work_date',d.work_date,'timezone',d.workday_timezone,'status',d.status,'end_reason',d.end_reason,
      'started_at',d.started_at,'effective_end_at',d.effective_end_at,'calendar_end_at',d.calendar_end_at,
      'working_seconds',d.working_seconds,'allowed_break_seconds',d.break_seconds,
      'excessive_idle_seconds',d.excessive_idle_seconds,'tracking_gap_seconds',d.tracking_gap_seconds,
      'excluded_travel_seconds',d.excluded_travel_seconds,'sph_counted_seconds',d.sph_counted_seconds,
      'segments',coalesce((select jsonb_agg(jsonb_build_object(
        'type',x.display_type,'started_at',x.started_at,'ended_at',x.ended_at,
        'duration_seconds',x.duration_seconds,'reason',x.reason,'gps_confidence',x.gps_confidence,
        'gps_sample_count',coalesce(x.sample_count,0),
        'average_accuracy_meters',x.average_accuracy_meters,
        'maximum_accuracy_meters',x.maximum_accuracy_meters,
        'maximum_distance_outside_area_meters',x.maximum_distance_outside_area_meters,
        'area_basis',x.area_basis,'evidence',x.evidence
      ) order by x.started_at,x.display_type) from detailed x where x.workday_id=d.id),'[]'::jsonb)
    ) as value
    from selected_days d
  )
  select jsonb_build_object('ok',true,'work_date',p_work_date,
    'generated_at',clock_timestamp(),'workdays',coalesce(jsonb_agg(value order by id),'[]'::jsonb))
  into v_result from day_json;
  return v_result;
end;
$$;

revoke all on function public.get_admin_workday_timeline(date,uuid) from public, anon;
grant execute on function public.get_admin_workday_timeline(date,uuid) to authenticated;

comment on function public.get_admin_workday_timeline(date,uuid) is
  'Admin-only derived workday timeline. Returns no raw GPS coordinates or home coordinates.';

