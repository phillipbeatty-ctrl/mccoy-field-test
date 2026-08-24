create or replace function public.record_door_visit_start(
  p_session_id uuid,
  p_lead_id uuid,
  p_selection_source text,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_meters double precision,
  p_gps_captured_at timestamptz
)
returns jsonb
language plpgsql
volatile
security definer
set search_path=pg_catalog,public,private,auth
as $$
declare
  v_uid uuid:=(select auth.uid());
  v_email text:=lower(coalesce((select auth.jwt())->>'email',''));
  v_access public.app_user_access%rowtype;
  v_profile public.users%rowtype;
  v_session public.test_sessions%rowtype;
  v_lead public.leads%rowtype;
  v_existing public.door_visits%rowtype;
  v_source text:=lower(trim(coalesce(p_selection_source,'')));
  v_distance double precision;
  v_label text;
  v_visit public.door_visits%rowtype;
begin
  if v_uid is null or v_email='' then raise exception 'authentication_required' using errcode='42501'; end if;
  select * into v_access from public.app_user_access where lower(email)=v_email and active is true;
  if not found then raise exception 'active_mccoy_account_required' using errcode='42501'; end if;
  if coalesce(v_access.role,'') not in ('admin','manager','trainer','rep','tester') then raise exception 'field_role_required' using errcode='42501'; end if;
  select * into v_profile from public.users where auth_user_id=v_uid and active is true limit 1;
  if not found then raise exception 'active_user_profile_required' using errcode='42501'; end if;
  select * into v_session from public.test_sessions where id=p_session_id and tester_user_id=v_uid and ended_at is null for update;
  if not found then raise exception 'open_owned_field_session_required' using errcode='42501'; end if;
  if v_session.started_at<clock_timestamp()-interval '16 hours' then raise exception 'field_session_expired' using errcode='22023'; end if;
  if v_source not in ('automatic_nearest','manual_lead') then raise exception 'invalid_lead_selection_source' using errcode='22023'; end if;
  if p_latitude is null or p_latitude not between -90 and 90 or p_longitude is null or p_longitude not between -180 and 180 then raise exception 'valid_current_location_required' using errcode='22023'; end if;
  if p_accuracy_meters is null or p_accuracy_meters<0 or p_accuracy_meters>150 then raise exception 'usable_location_accuracy_required' using errcode='22023'; end if;
  if p_gps_captured_at is null or p_gps_captured_at<clock_timestamp()-interval '2 minutes' or p_gps_captured_at>clock_timestamp()+interval '10 seconds' then raise exception 'fresh_current_location_required' using errcode='22023'; end if;

  select * into v_lead from public.leads where id=p_lead_id for update;
  if not found then raise exception 'lead_not_found' using errcode='P0002'; end if;
  if lower(coalesce(v_lead.geocode_status,'')) not in ('verified','exact','matched','google_mymaps','field_gps','rooftop','parcel','address','manual','field_verified','spotio_verified')
     or v_lead.latitude is null or v_lead.longitude is null then
    raise exception 'verified_lead_location_required' using errcode='22023';
  end if;

  v_distance:=private.mccoy_distance_meters(p_latitude,p_longitude,v_lead.latitude,v_lead.longitude);
  if v_distance>402.336 then raise exception 'outside_quarter_mile_sale_only' using errcode='22023'; end if;
  v_label:=concat_ws(', ',nullif(concat_ws(' ',v_lead.address1,v_lead.address2),''),nullif(v_lead.city,''),nullif(concat_ws(' ',v_lead.state,v_lead.zip),''));

  select * into v_existing from public.door_visits where session_id=p_session_id and rep_id=v_profile.id and status='active' for update;
  if found then
    if v_existing.lead_id=p_lead_id then
      return jsonb_build_object('ok',true,'duplicate',true,'visit_id',v_existing.id,'started_at',v_existing.arrived_at,'distance_meters',v_existing.arrival_distance_from_lead_meters,'lead_id',v_existing.lead_id,'lead_label',v_existing.service_address,'disposition_scope','all_leads');
    end if;
    raise exception 'active_visit_must_be_completed_or_corrected' using errcode='23505';
  end if;

  insert into public.door_visits(
    session_id,rep_id,lead_id,service_address,selection_source,status,arrived_at,
    arrival_latitude,arrival_longitude,arrival_accuracy_meters,arrival_distance_from_lead_meters,gps_verified_at_arrival
  ) values (
    p_session_id,v_profile.id,p_lead_id,v_label,v_source,'active',clock_timestamp(),
    p_latitude,p_longitude,p_accuracy_meters,v_distance,(p_accuracy_meters<=35)
  ) returning * into v_visit;

  update public.leads set attempt_count=attempt_count+1,last_activity_at=v_visit.arrived_at where id=p_lead_id;
  insert into public.test_events(
    session_id,event_type,lead_label,event_time,latitude,longitude,accuracy_meters,
    gps_fix_age_ms,lead_latitude,lead_longitude,distance_to_lead_meters,payload
  ) values (
    p_session_id,'door_arrival',v_label,v_visit.arrived_at,p_latitude,p_longitude,p_accuracy_meters,
    greatest(0,extract(epoch from(v_visit.arrived_at-p_gps_captured_at))*1000)::integer,
    v_lead.latitude,v_lead.longitude,v_distance,
    jsonb_build_object('server_generated',true,'visit_id',v_visit.id,'lead_id',p_lead_id,'selection_source',v_source,
      'quarter_mile_limit_meters',402.336,'disposition_scope','all_leads','lead_assignment_changed',false)
  );
  return jsonb_build_object('ok',true,'visit_id',v_visit.id,'started_at',v_visit.arrived_at,'distance_meters',v_distance,'lead_id',p_lead_id,'lead_label',v_label,'disposition_scope','all_leads');
end;
$$;

revoke all on function public.record_door_visit_start(uuid,uuid,text,double precision,double precision,double precision,timestamptz) from public,anon;
grant execute on function public.record_door_visit_start(uuid,uuid,text,double precision,double precision,double precision,timestamptz) to authenticated;

comment on function public.record_door_visit_start(uuid,uuid,text,double precision,double precision,double precision,timestamptz) is
  'Starts an owned-session visit to any real lead for any active McCoy field role. Assignment ownership is not changed. Verified lead coordinates, fresh GPS, and the 402.336-meter mapped-lead limit remain mandatory.';
