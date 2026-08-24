-- Door-location verification is coaching evidence, never disposition authorization.
-- Authentication, active-user checks, owned sessions, and owned visits remain mandatory.

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
  v_now timestamptz:=clock_timestamp();
  v_latitude double precision;
  v_longitude double precision;
  v_accuracy double precision;
  v_captured_at timestamptz;
  v_gps_usable boolean:=false;
  v_gps_fresh boolean:=false;
  v_door_verified boolean:=false;
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
  if v_session.started_at<v_now-interval '16 hours' then raise exception 'field_session_expired' using errcode='22023'; end if;
  if v_source not in ('automatic_nearest','manual_lead') then raise exception 'invalid_lead_selection_source' using errcode='22023'; end if;

  select * into v_lead from public.leads where id=p_lead_id for update;
  if not found then raise exception 'lead_not_found' using errcode='P0002'; end if;

  -- Invalid, missing, inaccurate, or stale GPS is omitted or marked unverified; it never blocks work.
  if p_latitude between -90 and 90 and p_longitude between -180 and 180 then
    v_latitude:=p_latitude;v_longitude:=p_longitude;v_gps_usable:=true;
  end if;
  if p_accuracy_meters between 0 and 100000 then v_accuracy:=p_accuracy_meters; end if;
  if p_gps_captured_at between v_now-interval '24 hours' and v_now+interval '10 seconds' then v_captured_at:=p_gps_captured_at; end if;
  v_gps_fresh:=v_gps_usable and v_captured_at is not null and v_captured_at>=v_now-interval '2 minutes';
  if v_gps_usable and v_lead.latitude between -90 and 90 and v_lead.longitude between -180 and 180 then
    v_distance:=private.mccoy_distance_meters(v_latitude,v_longitude,v_lead.latitude,v_lead.longitude);
  end if;
  v_door_verified:=v_gps_fresh and coalesce(v_accuracy<=35,false) and coalesce(v_distance<=402.336,false)
    and lower(coalesce(v_lead.geocode_status,'')) in ('verified','exact','matched','google_mymaps','field_gps','rooftop','parcel','address','manual','field_verified','spotio_verified');
  v_label:=concat_ws(', ',nullif(concat_ws(' ',v_lead.address1,v_lead.address2),''),nullif(v_lead.city,''),nullif(concat_ws(' ',v_lead.state,v_lead.zip),''));

  select * into v_existing from public.door_visits where session_id=p_session_id and rep_id=v_profile.id and status='active' for update;
  if found then
    if v_existing.lead_id=p_lead_id then
      return jsonb_build_object(
        'ok',true,'duplicate',true,'visit_id',v_existing.id,'started_at',v_existing.arrived_at,
        'distance_meters',v_existing.arrival_distance_from_lead_meters,'lead_id',v_existing.lead_id,
        'lead_label',v_existing.service_address,'disposition_scope','all_leads',
        'door_location_verified',coalesce(v_existing.gps_verified_at_arrival,false),'door_location_coaching_only',true
      );
    end if;
    raise exception 'active_visit_must_be_completed_or_corrected' using errcode='23505';
  end if;

  insert into public.door_visits(
    session_id,rep_id,lead_id,service_address,selection_source,status,arrived_at,
    arrival_latitude,arrival_longitude,arrival_accuracy_meters,arrival_distance_from_lead_meters,gps_verified_at_arrival
  ) values (
    p_session_id,v_profile.id,p_lead_id,v_label,v_source,'active',v_now,
    v_latitude,v_longitude,v_accuracy,v_distance,v_door_verified
  ) returning * into v_visit;

  update public.leads set attempt_count=attempt_count+1,last_activity_at=v_visit.arrived_at where id=p_lead_id;
  insert into public.test_events(
    session_id,event_type,lead_label,event_time,latitude,longitude,accuracy_meters,
    gps_fix_age_ms,lead_latitude,lead_longitude,distance_to_lead_meters,payload
  ) values (
    p_session_id,'door_arrival',v_label,v_visit.arrived_at,v_latitude,v_longitude,v_accuracy,
    case when v_captured_at is null then null else greatest(0,extract(epoch from(v_visit.arrived_at-v_captured_at))*1000)::integer end,
    v_lead.latitude,v_lead.longitude,v_distance,
    jsonb_build_object(
      'server_generated',true,'visit_id',v_visit.id,'lead_id',p_lead_id,'selection_source',v_source,
      'door_location_authorization_required',false,'door_location_coaching_only',true,
      'door_location_verified',v_door_verified,'gps_fix_fresh',v_gps_fresh,
      'quarter_mile_coaching_threshold_meters',402.336,'disposition_scope','all_leads',
      'lead_assignment_changed',false
    )
  );
  return jsonb_build_object(
    'ok',true,'visit_id',v_visit.id,'started_at',v_visit.arrived_at,'distance_meters',v_distance,
    'lead_id',p_lead_id,'lead_label',v_label,'disposition_scope','all_leads',
    'door_location_verified',v_door_verified,'door_location_coaching_only',true
  );
end;
$$;

revoke all on function public.record_door_visit_start(uuid,uuid,text,double precision,double precision,double precision,timestamptz) from public,anon;
grant execute on function public.record_door_visit_start(uuid,uuid,text,double precision,double precision,double precision,timestamptz) to authenticated;

create or replace function public.record_ad_hoc_door_visit_start(
  p_session_id uuid,
  p_service_address text,
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
  v_existing public.door_visits%rowtype;
  v_address text;
  v_now timestamptz:=clock_timestamp();
  v_latitude double precision;
  v_longitude double precision;
  v_accuracy double precision;
  v_captured_at timestamptz;
  v_gps_usable boolean:=false;
  v_gps_fresh boolean:=false;
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
  if v_session.started_at<v_now-interval '16 hours' then raise exception 'field_session_expired' using errcode='22023'; end if;

  v_address:=regexp_replace(trim(coalesce(p_service_address,'')),'[[:cntrl:]]+',' ','g');
  v_address:=regexp_replace(v_address,'[[:space:]]+',' ','g');
  if length(v_address)<5 or length(v_address)>240 then raise exception 'typed_address_required' using errcode='22023'; end if;

  if p_latitude between -90 and 90 and p_longitude between -180 and 180 then
    v_latitude:=p_latitude;v_longitude:=p_longitude;v_gps_usable:=true;
  end if;
  if p_accuracy_meters between 0 and 100000 then v_accuracy:=p_accuracy_meters; end if;
  if p_gps_captured_at between v_now-interval '24 hours' and v_now+interval '10 seconds' then v_captured_at:=p_gps_captured_at; end if;
  v_gps_fresh:=v_gps_usable and v_captured_at is not null and v_captured_at>=v_now-interval '2 minutes';

  select * into v_existing from public.door_visits where session_id=p_session_id and rep_id=v_profile.id and status='active' for update;
  if found then
    if v_existing.lead_id is null and v_existing.selection_source='typed_address' and lower(v_existing.service_address)=lower(v_address) then
      return jsonb_build_object(
        'ok',true,'duplicate',true,'visit_id',v_existing.id,'started_at',v_existing.arrived_at,
        'distance_meters',null,'lead_id',null,'lead_label',v_existing.service_address,
        'selection_source','typed_address','door_location_verified',false,'door_location_coaching_only',true
      );
    end if;
    raise exception 'active_visit_must_be_completed_or_corrected' using errcode='23505';
  end if;

  insert into public.door_visits(
    session_id,rep_id,lead_id,service_address,selection_source,status,arrived_at,
    arrival_latitude,arrival_longitude,arrival_accuracy_meters,arrival_distance_from_lead_meters,gps_verified_at_arrival
  ) values (
    p_session_id,v_profile.id,null,v_address,'typed_address','active',v_now,
    v_latitude,v_longitude,v_accuracy,null,false
  ) returning * into v_visit;

  insert into public.test_events(
    session_id,event_type,lead_label,event_time,latitude,longitude,accuracy_meters,gps_fix_age_ms,distance_to_lead_meters,payload
  ) values (
    p_session_id,'door_arrival',v_address,v_visit.arrived_at,v_latitude,v_longitude,v_accuracy,
    case when v_captured_at is null then null else greatest(0,extract(epoch from(v_visit.arrived_at-v_captured_at))*1000)::integer end,null,
    jsonb_build_object(
      'server_generated',true,'visit_id',v_visit.id,'lead_id',null,'selection_source','typed_address',
      'assigned_area_required',false,'lead_pool_membership_created',false,
      'door_location_authorization_required',false,'door_location_coaching_only',true,
      'door_location_verified',false,'door_location_verification_possible',false,'gps_fix_fresh',v_gps_fresh
    )
  );
  return jsonb_build_object(
    'ok',true,'visit_id',v_visit.id,'started_at',v_visit.arrived_at,'distance_meters',null,
    'lead_id',null,'lead_label',v_address,'selection_source','typed_address',
    'door_location_verified',false,'door_location_coaching_only',true
  );
end;
$$;

revoke all on function public.record_ad_hoc_door_visit_start(uuid,text,double precision,double precision,double precision,timestamptz) from public,anon;
grant execute on function public.record_ad_hoc_door_visit_start(uuid,text,double precision,double precision,double precision,timestamptz) to authenticated;

create or replace function public.record_door_visit_completion(
  p_visit_id uuid,
  p_disposition text,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_meters double precision,
  p_gps_captured_at timestamptz,
  p_automatic boolean default false,
  p_auto_reason text default null,
  p_provider_sale_id uuid default null,
  p_service_address text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path=pg_catalog,public,private,auth
as $$
declare
  v_uid uuid:=(select auth.uid());
  v_profile_id uuid;
  v_now timestamptz:=clock_timestamp();
  v_visit public.door_visits%rowtype;
  v_lead public.leads%rowtype;
  v_requested text:=lower(trim(coalesce(p_disposition,'')));
  v_disposition text;
  v_outcome text;
  v_contact text;
  v_distance double precision;
  v_dwell integer;
  v_is_typed boolean;
  v_latitude double precision;
  v_longitude double precision;
  v_accuracy double precision;
  v_captured_at timestamptz;
  v_gps_usable boolean:=false;
  v_gps_fresh boolean:=false;
  v_door_verified boolean:=false;
begin
  if v_uid is null then raise exception 'authentication_required' using errcode='42501'; end if;
  select id into v_profile_id from public.users where auth_user_id=v_uid and active is true limit 1;
  if v_profile_id is null then raise exception 'active_user_profile_required' using errcode='42501'; end if;
  select * into v_visit from public.door_visits where id=p_visit_id and rep_id=v_profile_id for update;
  if not found then raise exception 'owned_door_visit_not_found' using errcode='P0002'; end if;
  if v_visit.status='completed' then
    return jsonb_build_object(
      'ok',true,'duplicate',true,'visit_id',v_visit.id,'disposition',v_visit.disposition,
      'visit_outcome',v_visit.visit_outcome,'contact_status',v_visit.contact_status,
      'dwell_ms',coalesce(v_visit.dwell_seconds,0)*1000,'selection_source',v_visit.selection_source,
      'distance_meters',v_visit.disposition_distance_from_lead_meters,
      'door_location_verified',coalesce(v_visit.gps_verified_at_disposition,false),'door_location_coaching_only',true
    );
  end if;
  if v_visit.status<>'active' then raise exception 'door_visit_not_active' using errcode='22023'; end if;
  v_is_typed:=v_visit.selection_source='typed_address' and v_visit.lead_id is null;
  if v_visit.selection_source='typed_address' and (v_visit.lead_id is not null or length(trim(coalesce(v_visit.service_address,'')))<5) then raise exception 'invalid_typed_address_audit' using errcode='22023'; end if;
  v_dwell:=greatest(0,extract(epoch from(v_now-v_visit.arrived_at)))::integer;

  if v_requested='auto' then
    if v_dwell>=60 then v_disposition:='no_sale';v_outcome:='No Sale';v_contact:='Contacted';
    else v_disposition:='visit';v_outcome:='Visit';v_contact:='Not Contacted';end if;
  elsif v_requested in ('visit','not_contacted') then v_disposition:='visit';v_outcome:='Visit';v_contact:='Not Contacted';
  elsif v_requested='no_sale' then v_disposition:='no_sale';v_outcome:='No Sale';v_contact:='Contacted';
  elsif v_requested='set_appointment' then v_disposition:='set_appointment';v_outcome:='Set Appointment';v_contact:='Contacted';
  elsif v_requested='no_solicitation_requested' then v_disposition:='no_solicitation_requested';v_outcome:='No Solicitation Requested';v_contact:='Contacted';
  elsif v_requested='already_a_customer' then v_disposition:='already_a_customer';v_outcome:='Already a Customer';v_contact:='Contacted';
  elsif v_requested='sale' then v_disposition:='sale';v_outcome:='Sale';v_contact:='Contacted';
  else raise exception 'invalid_door_disposition' using errcode='22023'; end if;

  -- Sanitize optional GPS for the audit record. Missing/stale/inaccurate/far fixes never reject completion.
  if p_latitude between -90 and 90 and p_longitude between -180 and 180 then
    v_latitude:=p_latitude;v_longitude:=p_longitude;v_gps_usable:=true;
  end if;
  if p_accuracy_meters between 0 and 100000 then v_accuracy:=p_accuracy_meters; end if;
  if p_gps_captured_at between v_now-interval '24 hours' and v_now+interval '10 seconds' then v_captured_at:=p_gps_captured_at; end if;
  v_gps_fresh:=v_gps_usable and v_captured_at is not null and v_captured_at>=v_now-interval '2 minutes';
  if v_visit.lead_id is not null then select * into v_lead from public.leads where id=v_visit.lead_id for update; end if;
  if v_gps_usable and v_lead.latitude between -90 and 90 and v_lead.longitude between -180 and 180 then
    v_distance:=private.mccoy_distance_meters(v_latitude,v_longitude,v_lead.latitude,v_lead.longitude);
  end if;
  v_door_verified:=not v_is_typed and v_gps_fresh and coalesce(v_accuracy<=35,false) and coalesce(v_distance<=402.336,false)
    and lower(coalesce(v_lead.geocode_status,'')) in ('verified','exact','matched','google_mymaps','field_gps','rooftop','parcel','address','manual','field_verified','spotio_verified');

  update public.door_visits set
    status='completed',disposition_at=v_now,disposition_latitude=v_latitude,disposition_longitude=v_longitude,
    disposition_accuracy_meters=v_accuracy,disposition_distance_from_lead_meters=v_distance,
    gps_verified_at_disposition=v_door_verified,dwell_seconds=v_dwell,visit_outcome=v_outcome,contact_status=v_contact,
    disposition=v_disposition,auto_disposition=coalesce(p_automatic,false),auto_reason=left(trim(coalesce(p_auto_reason,'')),160),
    manual_override=not coalesce(p_automatic,false),provider_sale_id=coalesce(p_provider_sale_id,provider_sale_id),
    service_address=coalesce(nullif(trim(coalesce(p_service_address,'')),''),service_address),updated_at=v_now
  where id=v_visit.id returning * into v_visit;
  if v_visit.lead_id is not null then update public.leads set current_disposition=v_outcome,last_activity_at=v_now where id=v_visit.lead_id; end if;
  insert into public.test_events(
    session_id,event_type,lead_label,disposition,event_time,latitude,longitude,accuracy_meters,gps_fix_age_ms,
    dwell_ms,lead_latitude,lead_longitude,distance_to_lead_meters,payload
  ) values (
    v_visit.session_id,'disposition',v_visit.service_address,v_outcome,v_now,v_latitude,v_longitude,v_accuracy,
    case when v_captured_at is null then null else greatest(0,extract(epoch from(v_now-v_captured_at))*1000)::integer end,
    v_dwell*1000,v_lead.latitude,v_lead.longitude,v_distance,
    jsonb_build_object(
      'server_generated',true,'visit_id',v_visit.id,'visit_outcome',v_outcome,'contact_status',v_contact,
      'automatic',coalesce(p_automatic,false),'auto_reason',p_auto_reason,'provider_sale_id',p_provider_sale_id,
      'selection_source',v_visit.selection_source,'assigned_area_required',false,'lead_pool_membership_created',
      case when v_is_typed then false else null end,'door_location_authorization_required',false,
      'door_location_coaching_only',true,'door_location_verified',v_door_verified,'gps_fix_fresh',v_gps_fresh,
      'quarter_mile_coaching_threshold_meters',402.336,'lead_assignment_changed',false
    )
  );
  return jsonb_build_object(
    'ok',true,'visit_id',v_visit.id,'disposition',v_disposition,'visit_outcome',v_outcome,
    'contact_status',v_contact,'dwell_ms',v_dwell*1000,'distance_meters',v_distance,
    'selection_source',v_visit.selection_source,'service_address',v_visit.service_address,
    'door_location_verified',v_door_verified,'door_location_coaching_only',true
  );
end;
$$;

revoke all on function public.record_door_visit_completion(uuid,text,double precision,double precision,double precision,timestamptz,boolean,text,uuid,text) from public,anon;
grant execute on function public.record_door_visit_completion(uuid,text,double precision,double precision,double precision,timestamptz,boolean,text,uuid,text) to authenticated;

comment on function public.record_door_visit_start(uuid,uuid,text,double precision,double precision,double precision,timestamptz) is
  'Starts an owned-session visit to any real lead. Door GPS, accuracy, mapped-location status, and distance are optional coaching evidence and never authorization gates.';
comment on function public.record_ad_hoc_door_visit_start(uuid,text,double precision,double precision,double precision,timestamptz) is
  'Starts an authenticated, owned-session activity for a typed address. Location evidence is optional and coaching-only; no lead membership is created.';
comment on function public.record_door_visit_completion(uuid,text,double precision,double precision,double precision,timestamptz,boolean,text,uuid,text) is
  'Completes an owned active door visit. Door location verification is recorded for coaching and never blocks a valid disposition; completed-sale audit rules remain intact.';
comment on table public.door_visits is
  'Authoritative door-visit audit. Location accuracy, mapped-door proximity, and verification are coaching evidence only; authentication, owned sessions/visits, dispositions, and completed-sale linkage remain authoritative.';
