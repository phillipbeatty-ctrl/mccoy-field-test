-- Fixes a real, reproducible bug: completing ANY disposition on a
-- typed/ad-hoc address door visit fails with 'invalid_typed_address_audit'
-- after KNOCK DOOR has run, even though nothing is actually corrupted.
--
-- Root cause, traced precisely: record_ad_hoc_door_visit_start always
-- creates a visit with lead_id null and selection_source='typed_address'.
-- field_gps_placement (the KNOCK DOOR handler, p_action='knock_door')
-- correctly resolves that typed address to a real lead -- either matching
-- an existing one or creating a new one -- and updates door_visits.lead_id
-- to point at it. That leaves the visit in a state
-- (selection_source='typed_address' AND lead_id IS NOT NULL) that this
-- audit check, in record_door_visit_completion, incorrectly treated as
-- invalid/corrupted data. It isn't corrupted -- it's the correct, successful
-- result of the GPS-placement feature, which was built later and without
-- cross-checking against this older check. This happens for every
-- typed-address knock, regardless of which disposition is being saved;
-- reps most often notice it on "No Answer" simply because that's the most
-- common real-world outcome, and the pin appears stuck showing its default
-- "Prospecting" label because completion keeps failing.
--
-- An earlier version of this fix tried to mark placed visits with a new
-- selection_source value ('typed_address_placed') instead. That was reverted
-- before ever reaching real usage: it violated door_visits' own
-- selection_source check constraint (a fixed enumerated list that does not
-- include that value), and would have broken every typed-address KNOCK DOOR
-- call in production the moment it ran, and at least three other places in
-- the schema do exhaustive selection_source IN (...) matching that a new
-- enum value would also have needed to be threaded through correctly.
-- Caught in testing before deployment, not after.
--
-- The actual fix, both safer and simpler: leave selection_source and
-- field_gps_placement completely untouched, and instead correct the
-- overly-broad audit check itself. The check bundled two different
-- concerns together -- "does this visit suspiciously also have a lead_id"
-- (which is actually the normal, correct GPS-placement outcome, not
-- corruption) and "is the stored address suspiciously short" (which remains
-- a legitimate, independent thing to catch). This removes only the former.
--
-- Verified directly against the two real visits already stuck on this bug
-- in production (one from today): both now evaluate as valid under the new
-- check, no data correction needed. Also verified a genuinely short address
-- ("123") still correctly trips the check, so that protection is intact.

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
  if v_visit.selection_source='typed_address' and length(trim(coalesce(v_visit.service_address,'')))<5 then raise exception 'invalid_typed_address_audit' using errcode='22023'; end if;
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
