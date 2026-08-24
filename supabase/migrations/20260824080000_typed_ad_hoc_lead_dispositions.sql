alter table public.door_visits
  drop constraint if exists door_visits_selection_source_check,
  add constraint door_visits_selection_source_check check (
    selection_source in ('automatic_nearest','manual_lead','restored_visit','sale_lead','manual_address','provider_address','typed_address')
  );

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

  v_address:=regexp_replace(trim(coalesce(p_service_address,'')),'[[:cntrl:]]+',' ','g');
  v_address:=regexp_replace(v_address,'[[:space:]]+',' ','g');
  if length(v_address)<5 or length(v_address)>240 then raise exception 'typed_address_required' using errcode='22023'; end if;
  if p_latitude is null or p_latitude not between -90 and 90 or p_longitude is null or p_longitude not between -180 and 180 then raise exception 'valid_current_location_required' using errcode='22023'; end if;
  if p_accuracy_meters is null or p_accuracy_meters<0 or p_accuracy_meters>150 then raise exception 'usable_location_accuracy_required' using errcode='22023'; end if;
  if p_gps_captured_at is null or p_gps_captured_at<clock_timestamp()-interval '2 minutes' or p_gps_captured_at>clock_timestamp()+interval '10 seconds' then raise exception 'fresh_current_location_required' using errcode='22023'; end if;

  select * into v_existing from public.door_visits where session_id=p_session_id and rep_id=v_profile.id and status='active' for update;
  if found then
    if v_existing.lead_id is null and v_existing.selection_source='typed_address' and lower(v_existing.service_address)=lower(v_address) then
      return jsonb_build_object('ok',true,'duplicate',true,'visit_id',v_existing.id,'started_at',v_existing.arrived_at,'distance_meters',null,'lead_id',null,'lead_label',v_existing.service_address,'selection_source','typed_address');
    end if;
    raise exception 'active_visit_must_be_completed_or_corrected' using errcode='23505';
  end if;

  insert into public.door_visits(
    session_id,rep_id,lead_id,service_address,selection_source,status,arrived_at,
    arrival_latitude,arrival_longitude,arrival_accuracy_meters,arrival_distance_from_lead_meters,gps_verified_at_arrival
  ) values (
    p_session_id,v_profile.id,null,v_address,'typed_address','active',clock_timestamp(),
    p_latitude,p_longitude,p_accuracy_meters,null,(p_accuracy_meters<=35)
  ) returning * into v_visit;

  insert into public.test_events(
    session_id,event_type,lead_label,event_time,latitude,longitude,accuracy_meters,gps_fix_age_ms,distance_to_lead_meters,payload
  ) values (
    p_session_id,'door_arrival',v_address,v_visit.arrived_at,p_latitude,p_longitude,p_accuracy_meters,
    greatest(0,extract(epoch from(v_visit.arrived_at-p_gps_captured_at))*1000)::integer,null,
    jsonb_build_object('server_generated',true,'visit_id',v_visit.id,'lead_id',null,'selection_source','typed_address',
      'assigned_area_required',false,'lead_pool_membership_created',false,'gps_audit_required',true)
  );
  return jsonb_build_object('ok',true,'visit_id',v_visit.id,'started_at',v_visit.arrived_at,'distance_meters',null,'lead_id',null,'lead_label',v_address,'selection_source','typed_address');
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
  v_uid uuid:=(select auth.uid());v_profile_id uuid;v_now timestamptz:=clock_timestamp();v_visit public.door_visits%rowtype;v_lead public.leads%rowtype;
  v_requested text:=lower(trim(coalesce(p_disposition,'')));v_disposition text;v_outcome text;v_contact text;v_distance double precision;v_dwell integer;v_is_typed boolean;
begin
  if v_uid is null then raise exception 'authentication_required' using errcode='42501'; end if;
  select id into v_profile_id from public.users where auth_user_id=v_uid and active is true limit 1;
  if v_profile_id is null then raise exception 'active_user_profile_required' using errcode='42501'; end if;
  select * into v_visit from public.door_visits where id=p_visit_id and rep_id=v_profile_id for update;
  if not found then raise exception 'owned_door_visit_not_found' using errcode='P0002'; end if;
  if v_visit.status='completed' then return jsonb_build_object('ok',true,'duplicate',true,'visit_id',v_visit.id,'disposition',v_visit.disposition,'visit_outcome',v_visit.visit_outcome,'contact_status',v_visit.contact_status,'dwell_ms',coalesce(v_visit.dwell_seconds,0)*1000,'selection_source',v_visit.selection_source); end if;
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

  if v_disposition<>'sale' then
    if p_latitude is null or p_latitude not between -90 and 90 or p_longitude is null or p_longitude not between -180 and 180 then raise exception 'valid_current_location_required' using errcode='22023'; end if;
    if p_accuracy_meters is null or p_accuracy_meters<0 or p_accuracy_meters>150 then raise exception 'usable_location_accuracy_required' using errcode='22023'; end if;
    if p_gps_captured_at is null or p_gps_captured_at<v_now-interval '2 minutes' or p_gps_captured_at>v_now+interval '10 seconds' then raise exception 'fresh_current_location_required' using errcode='22023'; end if;
    if not v_is_typed then
      select * into v_lead from public.leads where id=v_visit.lead_id for update;
      if not found or v_lead.latitude is null or v_lead.longitude is null then raise exception 'verified_lead_location_required' using errcode='22023'; end if;
      v_distance:=private.mccoy_distance_meters(p_latitude,p_longitude,v_lead.latitude,v_lead.longitude);
      if v_distance>402.336 then raise exception 'outside_quarter_mile_sale_only' using errcode='22023'; end if;
    end if;
  else
    if v_visit.lead_id is not null then select * into v_lead from public.leads where id=v_visit.lead_id for update; end if;
    if p_latitude between -90 and 90 and p_longitude between -180 and 180 and v_lead.latitude is not null and v_lead.longitude is not null then v_distance:=private.mccoy_distance_meters(p_latitude,p_longitude,v_lead.latitude,v_lead.longitude); end if;
  end if;

  update public.door_visits set
    status='completed',disposition_at=v_now,disposition_latitude=p_latitude,disposition_longitude=p_longitude,
    disposition_accuracy_meters=case when p_accuracy_meters>=0 then p_accuracy_meters else null end,
    disposition_distance_from_lead_meters=v_distance,gps_verified_at_disposition=case when p_accuracy_meters is null then null else p_accuracy_meters<=35 end,
    dwell_seconds=v_dwell,visit_outcome=v_outcome,contact_status=v_contact,disposition=v_disposition,
    auto_disposition=coalesce(p_automatic,false),auto_reason=left(trim(coalesce(p_auto_reason,'')),160),manual_override=not coalesce(p_automatic,false),
    provider_sale_id=coalesce(p_provider_sale_id,provider_sale_id),service_address=coalesce(nullif(trim(coalesce(p_service_address,'')),''),service_address),updated_at=v_now
  where id=v_visit.id returning * into v_visit;
  if v_visit.lead_id is not null then update public.leads set current_disposition=v_outcome,last_activity_at=v_now where id=v_visit.lead_id; end if;
  insert into public.test_events(session_id,event_type,lead_label,disposition,event_time,latitude,longitude,accuracy_meters,gps_fix_age_ms,dwell_ms,lead_latitude,lead_longitude,distance_to_lead_meters,payload)
  values(v_visit.session_id,'disposition',v_visit.service_address,v_outcome,v_now,p_latitude,p_longitude,p_accuracy_meters,
    case when p_gps_captured_at is null then null else greatest(0,extract(epoch from(v_now-p_gps_captured_at))*1000)::integer end,
    v_dwell*1000,v_lead.latitude,v_lead.longitude,v_distance,
    jsonb_build_object('server_generated',true,'visit_id',v_visit.id,'visit_outcome',v_outcome,'contact_status',v_contact,'automatic',coalesce(p_automatic,false),
      'auto_reason',p_auto_reason,'provider_sale_id',p_provider_sale_id,'selection_source',v_visit.selection_source,
      'assigned_area_required',case when v_is_typed then false else true end,'lead_pool_membership_created',case when v_is_typed then false else null end));
  return jsonb_build_object('ok',true,'visit_id',v_visit.id,'disposition',v_disposition,'visit_outcome',v_outcome,'contact_status',v_contact,
    'dwell_ms',v_dwell*1000,'distance_meters',v_distance,'selection_source',v_visit.selection_source,'service_address',v_visit.service_address);
end;
$$;

revoke all on function public.record_door_visit_completion(uuid,text,double precision,double precision,double precision,timestamptz,boolean,text,uuid,text) from public,anon;
grant execute on function public.record_door_visit_completion(uuid,text,double precision,double precision,double precision,timestamptz,boolean,text,uuid,text) to authenticated;

comment on function public.record_ad_hoc_door_visit_start(uuid,text,double precision,double precision,double precision,timestamptz) is
  'Starts an authenticated, owned-session activity for a typed address without creating or attaching an assigned lead. Assigned-area and lead-distance checks do not apply; fresh usable GPS remains mandatory for audit.';
comment on function public.record_door_visit_completion(uuid,text,double precision,double precision,double precision,timestamptz,boolean,text,uuid,text) is
  'Completes an owned active door visit. Assigned leads require fresh GPS within 402.336 meters; typed-address activities require fresh GPS but may be completed inside or outside assigned areas; completed sales remain allowed at any distance.';
