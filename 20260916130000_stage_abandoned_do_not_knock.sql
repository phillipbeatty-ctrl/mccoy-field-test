-- Adds two new stage options, both red (#ef4444, matching the existing
-- Tailwind-palette convention used by every other stage color): "Abandoned/
-- Empty Lot" and "Do Not Knock". Neither existed before under any name.
--
-- The stage list turned out to be enforced independently in five places, not
-- just the two check constraints -- record_lead_pool_pin_disposition and
-- record_spotio_door_visit_completion each have their own hardcoded
-- CASE-based validation that rejects anything not explicitly listed,
-- entirely independent of the check constraints below. Updating only the
-- constraints would leave both of those functions actively raising
-- invalid_lead_stage the moment a rep actually tried to use either new
-- option, so all four are updated together here.

alter table public.leads drop constraint leads_stage_check;
alter table public.leads add constraint leads_stage_check
  check (stage = any (array['Prospecting','Hot Lead','Contacted','Follow Up','Migrator','Existing Customer','SMB','Sale Made','No Sale','Admin Hold','Abandoned/Empty Lot','Do Not Knock']));

alter table public.door_visits drop constraint door_visits_lead_stage_check;
alter table public.door_visits add constraint door_visits_lead_stage_check
  check (lead_stage is null or lead_stage = any (array['Prospecting','Hot Lead','Contacted','Follow Up','Migrator','Existing Customer','SMB','Sale Made','No Sale','Admin Hold','Abandoned/Empty Lot','Do Not Knock']));

create or replace function public.record_spotio_door_visit_completion(p_visit_id uuid, p_activity_type text, p_visit_result text, p_stage text, p_latitude double precision, p_longitude double precision, p_accuracy_meters double precision, p_gps_captured_at timestamp with time zone, p_automatic boolean DEFAULT false, p_auto_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'auth'
AS $function$
declare
  v_activity_key text:=regexp_replace(lower(trim(coalesce(p_activity_type,''))),'[^a-z0-9]+',' ','g');
  v_result_key text:=regexp_replace(lower(trim(coalesce(p_visit_result,''))),'[^a-z0-9]+',' ','g');
  v_stage_key text:=regexp_replace(lower(trim(coalesce(p_stage,''))),'[^a-z0-9]+',' ','g');
  v_activity text;v_result text;v_stage text;v_legacy text;v_contact text;v_color text;v_source text;v_effective text;
  v_base jsonb;v_visit public.door_visits%rowtype;v_existing_stage text;
begin
  v_activity:=case v_activity_key
    when 'visit' then 'Visit' when 'call' then 'Call' when 'appointment' then 'Appointment' when 'text' then 'Text'
    when 'qualify' then 'Qualify' when 'investigate estimate' then 'Investigate & Estimate'
    when 'make a proposal' then 'Make a Proposal' when 'get feedback' then 'Get Feedback' else null end;
  if v_activity is null then raise exception 'invalid_activity_type' using errcode='22023'; end if;

  v_result:=case v_result_key when 'no answer' then 'No Answer' when 'contacted' then 'Contacted' when 'follow up' then 'Follow-Up' else null end;
  if v_result is null then raise exception 'invalid_visit_result' using errcode='22023'; end if;

  v_stage:=case v_stage_key
    when '' then null when 'prospecting' then 'Prospecting' when 'hot lead' then 'Hot Lead' when 'contacted' then 'Contacted'
    when 'follow up' then 'Follow Up' when 'migrator' then 'Migrator' when 'existing customer' then 'Existing Customer'
    when 'smb' then 'SMB' when 'sale made' then 'Sale Made' when 'no sale' then 'No Sale' when 'admin hold' then 'Admin Hold'
    when 'abandoned empty lot' then 'Abandoned/Empty Lot' when 'do not knock' then 'Do Not Knock' else null end;
  if v_stage_key<>'' and v_stage is null then raise exception 'invalid_lead_stage' using errcode='22023'; end if;
  if v_stage='Sale Made' then raise exception 'sale_made_requires_completed_sale' using errcode='22023'; end if;

  v_legacy:=case v_result when 'No Answer' then 'visit' when 'Contacted' then 'no_sale' else 'set_appointment' end;
  v_contact:=case when v_result='No Answer' then 'Not Contacted' else 'Contacted' end;
  v_source:=case when v_stage is null then 'visit_result' else 'stage' end;
  v_effective:=coalesce(v_stage,v_result);
  v_color:=case
    when v_stage='Prospecting' then '#fbbf24' when v_stage='Hot Lead' then '#c4b5fd' when v_stage='Contacted' then '#93c5fd'
    when v_stage='Follow Up' then '#1d4ed8' when v_stage='Migrator' then '#f97316' when v_stage='Existing Customer' then '#ffffff'
    when v_stage='SMB' then '#ec4899' when v_stage='No Sale' then '#9ca3af' when v_stage='Admin Hold' then '#581c87'
    when v_stage='Abandoned/Empty Lot' then '#ef4444' when v_stage='Do Not Knock' then '#ef4444'
    when v_result='No Answer' then '#fbbf24' when v_result='Contacted' then '#9ca3af' else '#3b82f6' end;

  v_base:=public.record_door_visit_completion(p_visit_id,v_legacy,p_latitude,p_longitude,p_accuracy_meters,p_gps_captured_at,p_automatic,p_auto_reason,null,null);
  select * into v_visit from public.door_visits where id=p_visit_id for update;
  if coalesce((v_base->>'duplicate')::boolean,false) then
    return v_base||jsonb_build_object('activity_type',v_visit.activity_type,'visit_result',v_visit.visit_result,'stage',v_visit.lead_stage,
      'effective_disposition',coalesce(v_visit.lead_stage,v_visit.visit_result,v_visit.visit_outcome),'pin_color',v_visit.pin_color,'pin_color_source',v_visit.pin_color_source);
  end if;

  if v_visit.lead_id is not null then select stage into v_existing_stage from public.leads where id=v_visit.lead_id; end if;
  update public.door_visits set activity_type=v_activity,visit_result=v_result,lead_stage=coalesce(v_stage,v_existing_stage),
    visit_outcome=v_result,contact_status=v_contact,pin_color=v_color,pin_color_source=v_source,updated_at=clock_timestamp()
  where id=v_visit.id;
  if v_visit.lead_id is not null then
    update public.leads set last_activity_type=v_activity,visit_result=v_result,stage=coalesce(v_stage,stage),
      current_disposition=v_effective,pin_color=v_color,pin_color_source=v_source,last_activity_at=clock_timestamp()
    where id=v_visit.lead_id;
  end if;
  update public.test_events set disposition=v_effective,payload=coalesce(payload,'{}'::jsonb)||jsonb_build_object(
    'activity_type',v_activity,'visit_result',v_result,'stage',v_stage,'effective_disposition',v_effective,'pin_color',v_color,'pin_color_source',v_source)
  where session_id=v_visit.session_id and event_type='disposition' and payload->>'visit_id'=v_visit.id::text;
  return v_base||jsonb_build_object('activity_type',v_activity,'visit_result',v_result,'stage',v_stage,'effective_disposition',v_effective,
    'contact_status',v_contact,'pin_color',v_color,'pin_color_source',v_source);
end;
$function$;

create or replace function public.record_lead_pool_pin_disposition(p_session_id uuid, p_lead_id uuid, p_client_request_id uuid, p_activity_type text, p_visit_result text, p_stage text, p_occurred_at timestamp with time zone, p_dwell_seconds integer, p_latitude double precision, p_longitude double precision, p_accuracy_meters double precision, p_gps_captured_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'auth'
AS $function$
declare
  v_uid uuid:=(select auth.uid());
  v_email text:=lower(coalesce((select auth.jwt())->>'email',''));
  v_access public.app_user_access%rowtype;
  v_profile public.users%rowtype;
  v_session public.test_sessions%rowtype;
  v_lead public.leads%rowtype;
  v_existing public.door_visits%rowtype;
  v_visit public.door_visits%rowtype;
  v_now timestamptz:=clock_timestamp();
  v_occurred timestamptz;
  v_completed timestamptz;
  v_dwell integer;
  v_activity_key text:=regexp_replace(lower(trim(coalesce(p_activity_type,''))),'[^a-z0-9]+',' ','g');
  v_result_key text:=regexp_replace(lower(trim(coalesce(p_visit_result,''))),'[^a-z0-9]+',' ','g');
  v_stage_key text:=regexp_replace(lower(trim(coalesce(p_stage,''))),'[^a-z0-9]+',' ','g');
  v_activity text;
  v_result text;
  v_stage text;
  v_effective_stage text;
  v_effective text;
  v_legacy text;
  v_contact text;
  v_color text;
  v_color_source text;
  v_label text;
  v_latitude double precision;
  v_longitude double precision;
  v_accuracy double precision;
  v_captured_at timestamptz;
  v_distance double precision;
  v_gps_fresh boolean:=false;
  v_location_verified boolean:=false;
begin
  if v_uid is null or v_email='' then raise exception 'authentication_required' using errcode='42501'; end if;
  if p_client_request_id is null then raise exception 'client_request_id_required' using errcode='22023'; end if;

  select * into v_access
  from public.app_user_access
  where lower(email)=v_email and active is true;
  if not found then raise exception 'active_mccoy_account_required' using errcode='42501'; end if;
  if coalesce(v_access.role,'') not in ('admin','manager','trainer','rep','tester') then
    raise exception 'field_role_required' using errcode='42501';
  end if;

  select * into v_profile
  from public.users
  where auth_user_id=v_uid and active is true and organization_id=v_access.organization_id
  limit 1;
  if not found then raise exception 'active_user_profile_required' using errcode='42501'; end if;

  select * into v_session
  from public.test_sessions
  where id=p_session_id
    and tester_user_id=v_uid
    and organization_id=v_access.organization_id
    and ended_at is null
  for update;
  if not found then raise exception 'open_owned_field_session_required' using errcode='42501'; end if;
  if v_session.started_at<v_now-interval '16 hours' then raise exception 'field_session_expired' using errcode='22023'; end if;

  select * into v_existing
  from public.door_visits
  where rep_id=v_profile.id and client_request_id=p_client_request_id;
  if found then
    return jsonb_build_object(
      'ok',true,'duplicate',true,'visit_id',v_existing.id,'lead_id',v_existing.lead_id,
      'occurred_at',v_existing.occurred_at,'dwell_seconds',coalesce(v_existing.dwell_seconds,0),
      'activity_type',v_existing.activity_type,'visit_result',v_existing.visit_result,
      'stage',v_existing.lead_stage,'effective_disposition',coalesce(v_existing.lead_stage,v_existing.visit_result,v_existing.visit_outcome),
      'pin_color',v_existing.pin_color,'pin_color_source',v_existing.pin_color_source,
      'active_sales_hub_visit_preserved',true
    );
  end if;

  select * into v_lead
  from public.leads
  where id=p_lead_id
    and organization_id=v_access.organization_id
    and deleted_at is null
  for update;
  if not found then raise exception 'lead_not_available' using errcode='P0002'; end if;

  v_activity:=case v_activity_key
    when 'visit' then 'Visit'
    when 'call' then 'Call'
    when 'appointment' then 'Appointment'
    when 'text' then 'Text'
    when 'qualify' then 'Qualify'
    when 'investigate estimate' then 'Investigate & Estimate'
    when 'make a proposal' then 'Make a Proposal'
    when 'get feedback' then 'Get Feedback'
    else null end;
  if v_activity is null then raise exception 'invalid_activity_type' using errcode='22023'; end if;

  v_result:=case v_result_key
    when 'no answer' then 'No Answer'
    when 'contacted' then 'Contacted'
    when 'follow up' then 'Follow-Up'
    else null end;
  if v_result is null then raise exception 'invalid_visit_result' using errcode='22023'; end if;

  v_stage:=case v_stage_key
    when '' then null
    when 'prospecting' then 'Prospecting'
    when 'hot lead' then 'Hot Lead'
    when 'contacted' then 'Contacted'
    when 'follow up' then 'Follow Up'
    when 'migrator' then 'Migrator'
    when 'existing customer' then 'Existing Customer'
    when 'smb' then 'SMB'
    when 'sale made' then 'Sale Made'
    when 'no sale' then 'No Sale'
    when 'admin hold' then 'Admin Hold'
    when 'abandoned empty lot' then 'Abandoned/Empty Lot'
    when 'do not knock' then 'Do Not Knock'
    else null end;
  if v_stage_key<>'' and v_stage is null then raise exception 'invalid_lead_stage' using errcode='22023'; end if;
  if v_stage='Sale Made' then raise exception 'sale_made_requires_completed_sale' using errcode='22023'; end if;

  v_occurred:=coalesce(p_occurred_at,v_now);
  if v_occurred<v_session.started_at or v_occurred>v_now+interval '30 seconds' then
    raise exception 'occurred_at_outside_open_session' using errcode='22023';
  end if;
  v_dwell:=greatest(0,least(coalesce(p_dwell_seconds,0),28800));
  if v_activity<>'Visit' then v_dwell:=0; end if;
  v_dwell:=least(v_dwell,greatest(0,extract(epoch from(v_now-v_occurred))::integer));
  v_completed:=v_occurred+make_interval(secs=>v_dwell);

  if p_latitude between -90 and 90 and p_longitude between -180 and 180 then
    v_latitude:=p_latitude;v_longitude:=p_longitude;
  end if;
  if p_accuracy_meters between 0 and 100000 then v_accuracy:=p_accuracy_meters; end if;
  if p_gps_captured_at between v_now-interval '24 hours' and v_now+interval '10 seconds' then v_captured_at:=p_gps_captured_at; end if;
  v_gps_fresh:=v_latitude is not null and v_longitude is not null and v_captured_at is not null and v_captured_at>=v_now-interval '2 minutes';
  if v_latitude is not null and v_longitude is not null and v_lead.latitude between -90 and 90 and v_lead.longitude between -180 and 180 then
    v_distance:=private.mccoy_distance_meters(v_latitude,v_longitude,v_lead.latitude,v_lead.longitude);
  end if;
  v_location_verified:=v_gps_fresh and coalesce(v_accuracy<=35,false) and coalesce(v_distance<=402.336,false);

  v_effective_stage:=coalesce(v_stage,v_lead.stage,'Prospecting');
  v_effective:=coalesce(v_stage,v_result);
  v_legacy:=case v_result when 'No Answer' then 'visit' when 'Contacted' then 'no_sale' else 'set_appointment' end;
  v_contact:=case when v_result='No Answer' then 'Not Contacted' else 'Contacted' end;
  v_color_source:=case when v_stage is null then 'visit_result' else 'stage' end;
  v_color:=case
    when v_stage='Prospecting' then '#fbbf24'
    when v_stage='Hot Lead' then '#c4b5fd'
    when v_stage='Contacted' then '#93c5fd'
    when v_stage='Follow Up' then '#1d4ed8'
    when v_stage='Migrator' then '#f97316'
    when v_stage='Existing Customer' then '#ffffff'
    when v_stage='SMB' then '#ec4899'
    when v_stage='No Sale' then '#9ca3af'
    when v_stage='Admin Hold' then '#581c87'
    when v_stage='Abandoned/Empty Lot' then '#ef4444'
    when v_stage='Do Not Knock' then '#ef4444'
    when v_result='No Answer' then '#fbbf24'
    when v_result='Contacted' then '#9ca3af'
    else '#3b82f6' end;
  v_label:=concat_ws(', ',nullif(concat_ws(' ',v_lead.address1,v_lead.address2),''),nullif(v_lead.city,''),nullif(concat_ws(' ',v_lead.state,v_lead.zip),''));

  insert into public.door_visits(
    organization_id,lead_id,rep_id,session_id,occurred_at,arrived_at,disposition_at,
    selection_source,status,service_address,disposition,dwell_seconds,visit_outcome,contact_status,
    activity_type,visit_result,lead_stage,pin_color,pin_color_source,
    arrival_latitude,arrival_longitude,arrival_accuracy_meters,arrival_distance_from_lead_meters,
    disposition_latitude,disposition_longitude,disposition_accuracy_meters,disposition_distance_from_lead_meters,
    gps_verified_at_arrival,gps_verified_at_disposition,manual_override,client_request_id,notes
  ) values (
    v_access.organization_id,v_lead.id,v_profile.id,v_session.id,v_occurred,v_occurred,v_completed,
    'lead_pool_map','completed',v_label,v_legacy,v_dwell,v_result,v_contact,
    v_activity,v_result,v_effective_stage,v_color,v_color_source,
    v_latitude,v_longitude,v_accuracy,v_distance,
    v_latitude,v_longitude,v_accuracy,v_distance,
    v_location_verified,v_location_verified,true,p_client_request_id,'Lead Pool independent map activity'
  )
  on conflict(rep_id,client_request_id) where client_request_id is not null do nothing
  returning * into v_visit;

  if not found then
    select * into v_existing from public.door_visits where rep_id=v_profile.id and client_request_id=p_client_request_id;
    return jsonb_build_object(
      'ok',true,'duplicate',true,'visit_id',v_existing.id,'lead_id',v_existing.lead_id,
      'occurred_at',v_existing.occurred_at,'dwell_seconds',coalesce(v_existing.dwell_seconds,0),
      'activity_type',v_existing.activity_type,'visit_result',v_existing.visit_result,
      'stage',v_existing.lead_stage,'effective_disposition',coalesce(v_existing.lead_stage,v_existing.visit_result,v_existing.visit_outcome),
      'pin_color',v_existing.pin_color,'pin_color_source',v_existing.pin_color_source,
      'active_sales_hub_visit_preserved',true
    );
  end if;

  update public.leads
  set last_activity_type=v_activity,
      visit_result=v_result,
      stage=coalesce(v_stage,stage),
      current_disposition=v_effective,
      pin_color=v_color,
      pin_color_source=v_color_source,
      last_activity_at=v_completed,
      attempt_count=coalesce(attempt_count,0)+1
  where id=v_lead.id;

  insert into public.test_events(
    organization_id,session_id,event_type,lead_label,disposition,event_time,
    latitude,longitude,accuracy_meters,gps_fix_age_ms,dwell_ms,
    lead_latitude,lead_longitude,distance_to_lead_meters,is_gps_verified,payload
  ) values (
    v_access.organization_id,v_session.id,'lead_pool_disposition',v_label,v_effective,v_occurred,
    v_latitude,v_longitude,v_accuracy,
    case when v_captured_at is null then null else greatest(0,extract(epoch from(v_occurred-v_captured_at))*1000)::integer end,
    v_dwell*1000,v_lead.latitude,v_lead.longitude,v_distance,v_location_verified,
    jsonb_build_object(
      'server_generated',true,'visit_id',v_visit.id,'lead_id',v_lead.id,
      'client_request_id',p_client_request_id,'selection_source','lead_pool_map',
      'activity_type',v_activity,'visit_result',v_result,'stage',v_stage,
      'effective_disposition',v_effective,'pin_color',v_color,'pin_color_source',v_color_source,
      'occurred_at',v_occurred,'dwell_seconds',v_dwell,
      'distance_authorization_required',false,'door_location_coaching_only',true,
      'active_sales_hub_visit_preserved',true,'lead_assignment_changed',false,
      'assigned_rep_id',v_lead.assigned_rep_id,'assigned_manager_id',v_lead.assigned_manager_id
    )
  );

  return jsonb_build_object(
    'ok',true,'duplicate',false,'visit_id',v_visit.id,'lead_id',v_lead.id,
    'occurred_at',v_occurred,'completed_at',v_completed,'dwell_seconds',v_dwell,
    'activity_type',v_activity,'visit_result',v_result,'stage',v_stage,
    'effective_disposition',v_effective,'pin_color',v_color,'pin_color_source',v_color_source,
    'distance_meters',v_distance,'door_location_verified',v_location_verified,
    'active_sales_hub_visit_preserved',true,
    'lead',jsonb_build_object(
      'id',v_lead.id,'current_disposition',v_effective,'last_activity_type',v_activity,
      'visit_result',v_result,'stage',coalesce(v_stage,v_lead.stage),'pin_color',v_color,
      'pin_color_source',v_color_source,'last_activity_at',v_completed,
      'assigned_rep_id',v_lead.assigned_rep_id,'assigned_manager_id',v_lead.assigned_manager_id,
      'assigned_admin_email',v_lead.assigned_admin_email
    )
  );
end;
$function$;

create or replace function private.mccoy_spotio_stage_state_v1(p_value text)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
declare
  v text := lower(regexp_replace(btrim(coalesce(p_value,'')), '[^a-zA-Z0-9]+', ' ', 'g'));
begin
  v := btrim(regexp_replace(v, '[[:space:]]+', ' ', 'g'));
  return case v
    when 'prospecting keep knocking' then jsonb_build_object('stage','Prospecting','disposition','uncontacted','pin_color','#fbbf24')
    when 'prospecting' then jsonb_build_object('stage','Prospecting','disposition','uncontacted','pin_color','#fbbf24')
    when 'hot lead' then jsonb_build_object('stage','Hot Lead','disposition','Hot Lead','pin_color','#c4b5fd')
    when 'contacted' then jsonb_build_object('stage','Contacted','disposition','Contacted','pin_color','#93c5fd')
    when 'follow up' then jsonb_build_object('stage','Follow Up','disposition','Follow Up','pin_color','#1d4ed8')
    when 'migrator' then jsonb_build_object('stage','Migrator','disposition','Migrator','pin_color','#f97316')
    when 'existing customer' then jsonb_build_object('stage','Existing Customer','disposition','Existing Customer','pin_color','#ffffff')
    when 'smb' then jsonb_build_object('stage','SMB','disposition','SMB','pin_color','#ec4899')
    when 'sale made' then jsonb_build_object('stage','Sale Made','disposition','Sale Made','pin_color','#22c55e')
    when 'no sale made' then jsonb_build_object('stage','No Sale','disposition','No Sale','pin_color','#9ca3af')
    when 'no sale' then jsonb_build_object('stage','No Sale','disposition','No Sale','pin_color','#9ca3af')
    when 'admin hold' then jsonb_build_object('stage','Admin Hold','disposition','Admin Hold','pin_color','#581c87')
    when 'abandoned empty lot' then jsonb_build_object('stage','Abandoned/Empty Lot','disposition','Abandoned/Empty Lot','pin_color','#ef4444')
    when 'abandoned' then jsonb_build_object('stage','Abandoned/Empty Lot','disposition','Abandoned/Empty Lot','pin_color','#ef4444')
    when 'empty lot' then jsonb_build_object('stage','Abandoned/Empty Lot','disposition','Abandoned/Empty Lot','pin_color','#ef4444')
    when 'vacant lot' then jsonb_build_object('stage','Abandoned/Empty Lot','disposition','Abandoned/Empty Lot','pin_color','#ef4444')
    when 'do not knock' then jsonb_build_object('stage','Do Not Knock','disposition','Do Not Knock','pin_color','#ef4444')
    when 'dnk' then jsonb_build_object('stage','Do Not Knock','disposition','Do Not Knock','pin_color','#ef4444')
    else '{}'::jsonb
  end;
end;
$function$;
