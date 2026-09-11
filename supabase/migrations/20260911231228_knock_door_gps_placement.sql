begin;

-- GPS writes now require an active manual KNOCK DOOR visit. ADD ADDRESS
-- resolves/creates identity only; the original audit and migration stay intact.
create or replace function public.field_gps_placement(
  p_actor_auth_id uuid,p_actor_email text,p_action text,p_input jsonb default '{}'::jsonb
) returns jsonb language plpgsql security invoker
set search_path=pg_catalog,public,private set extra_float_digits=3 as $$
declare
  v_access public.app_user_access%rowtype;
  v_actor public.users%rowtype;
  v_lead public.leads%rowtype;
  v_visit public.door_visits%rowtype;
  v_session_id uuid;
  v_service_key text;
  v_previous private.field_gps_requests%rowtype;
  v_pilot private.field_gps_pilot%rowtype;
  v_notice text;
  v_consent boolean;
  v_request uuid;
  v_lat double precision; v_lng double precision; v_accuracy double precision;
  v_captured timestamptz; v_now timestamptz;
  v_address jsonb; v_street text; v_unit text; v_city text; v_state text; v_zip text; v_key text;
  v_ids uuid[]:='{}'; v_exact uuid[]:='{}'; v_created uuid; v_selected uuid; v_manager uuid;
  v_result jsonb; v_count integer:=0; v_contact jsonb; v_before jsonb;
begin
  select * into v_access from public.app_user_access
    where lower(email)=lower(p_actor_email) and active is true for share;
  if not found or v_access.role not in ('admin','manager','trainer','rep','tester') then
    raise exception 'active_field_role_required' using errcode='42501';
  end if;
  select * into v_actor from public.users where auth_user_id=p_actor_auth_id
    and organization_id=v_access.organization_id and active is true
    and lower(email)=lower(p_actor_email) for share;
  if not found then raise exception 'active_user_profile_required' using errcode='42501'; end if;
  select value into v_notice from public.app_config where key='privacy_notice_version';
  v_consent:=v_notice is not null and exists(select 1 from public.privacy_acceptances
    where user_id=p_actor_auth_id and notice_version=v_notice
      and precise_location_consent is true and work_activity_analytics_consent is true);
  select * into v_pilot from private.field_gps_pilot
    where organization_id=v_access.organization_id and user_id=v_actor.id for share;
  if p_action='status' then
    return jsonb_build_object('ok',true,'enabled',coalesce(v_pilot.enabled_until>clock_timestamp(),false),
      'can_manage',v_access.role='admin','consented',v_consent,'enabled_until',v_pilot.enabled_until);
  end if;
  if p_action='set_pilot' then
    -- Initial pilot: an Admin can opt in their own account, never enroll others
    -- by changing a browser field. Additional field testers require operator enrollment.
    if v_access.role<>'admin' then raise exception 'admin_required' using errcode='42501'; end if;
    if jsonb_typeof(p_input->'enabled') is distinct from 'boolean' then raise exception 'enabled_required' using errcode='22023'; end if;
    if (p_input->>'enabled')::boolean then
      if not v_consent then raise exception 'current_location_consent_required' using errcode='42501'; end if;
      insert into private.field_gps_pilot(organization_id,user_id,enabled_until,enabled_by)
      values(v_access.organization_id,v_actor.id,clock_timestamp()+interval '7 days',v_actor.id)
      on conflict(organization_id,user_id) do update set enabled_until=excluded.enabled_until,enabled_by=excluded.enabled_by,updated_at=clock_timestamp();
    else
      delete from private.field_gps_pilot where organization_id=v_access.organization_id and user_id=v_actor.id;
    end if;
    return jsonb_build_object('ok',true,'enabled',(p_input->>'enabled')::boolean,'can_manage',true,'consented',v_consent);
  end if;
  if p_action not in ('add_address','knock_door') then raise exception 'unsupported_action' using errcode='22023'; end if;
  if coalesce(v_pilot.enabled_until>clock_timestamp(),false) is not true then raise exception 'gps_pilot_not_enabled' using errcode='42501'; end if;
  if p_action='knock_door' and not v_consent then raise exception 'current_location_consent_required' using errcode='42501'; end if;
  v_request:=(p_input->>'request_id')::uuid;
  if v_request is null then raise exception 'request_id_required' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_access.organization_id::text||':'||v_actor.id::text||':'||v_request::text,0));
  select * into v_previous from private.field_gps_requests where organization_id=v_access.organization_id and actor_user_id=v_actor.id and request_id=v_request;
  if found then
    if v_previous.action<>p_action or v_previous.input<>p_input then raise exception 'request_payload_changed' using errcode='22023'; end if;
    return v_previous.result||jsonb_build_object('replayed',true);
  end if;
  v_address:=p_input->'address';
  if p_action='knock_door' then
    -- Lock the owned open session before its visit. The browser cannot move a
    -- different address by supplying a lead ID or another user's visit receipt.
    select session_id into v_session_id from public.door_visits
      where id=(p_input->>'visit_id')::uuid and organization_id=v_access.organization_id and rep_id=v_actor.id;
    perform 1 from public.test_sessions where id=v_session_id and tester_user_id=p_actor_auth_id
      and ended_at is null and started_at>=clock_timestamp()-interval '16 hours' for share;
    if not found then raise exception 'active_manual_knock_required' using errcode='42501'; end if;
    select * into v_visit from public.door_visits where id=(p_input->>'visit_id')::uuid
      and organization_id=v_access.organization_id and rep_id=v_actor.id and session_id=v_session_id
      and status='active' and selection_source in ('manual_lead','typed_address') for update;
    if not found then raise exception 'active_manual_knock_required' using errcode='42501'; end if;
    if v_visit.lead_id is not null then
      select * into v_lead from public.leads where id=v_visit.lead_id and organization_id=v_access.organization_id
        and deleted_at is null and upper(coalesce(source_system,'')) not like '%DEMO%';
      if not found then raise exception 'lead_not_available' using errcode='P0002'; end if;
      v_address:=jsonb_build_object('address1',v_lead.address1,'address2',v_lead.address2,'city',v_lead.city,'state',v_lead.state,'zip',v_lead.zip);
    else
      -- This is a conservative equality check against the saved typed address,
      -- not a fuzzy matcher. Preserve fractions, ranges, ZIP and unit tokens.
      v_service_key:=trim(regexp_replace(lower(regexp_replace(trim(v_visit.service_address),',\s*(USA|US|United States( of America)?)$','','i')),'[^a-z0-9/#-]+',' ','g'));
      if v_service_key is distinct from trim(regexp_replace(lower(concat_ws(' ',v_address->>'address1',nullif(v_address->>'address2',''),v_address->>'city',v_address->>'state',v_address->>'zip')),'[^a-z0-9/#-]+',' ','g')) then
        raise exception 'knock_address_changed' using errcode='22023';
      end if;
    end if;
  if jsonb_typeof(p_input->'gps'->'latitude') is distinct from 'number'
    or jsonb_typeof(p_input->'gps'->'longitude') is distinct from 'number'
    or jsonb_typeof(p_input->'gps'->'accuracy_meters') is distinct from 'number' then
    raise exception 'valid_gps_required' using errcode='22023';
  end if;
  v_lat:=(p_input->'gps'->>'latitude')::double precision;
  v_lng:=(p_input->'gps'->>'longitude')::double precision;
  v_accuracy:=(p_input->'gps'->>'accuracy_meters')::double precision;
  v_captured:=(p_input->'gps'->>'captured_at')::timestamptz;
  if (v_lat between -90 and 90 and v_lng between -180 and 180 and v_accuracy between 0 and 100000) is not true then
    raise exception 'valid_gps_required' using errcode='22023';
  end if;
  end if;

    v_street:=trim(coalesce(v_address->>'address1','')); v_unit:=trim(coalesce(v_address->>'address2',''));
    if private.field_gps_inline_unit(v_street) is not null then
      if v_unit<>'' and private.field_gps_unit_key(v_unit)<>private.field_gps_inline_unit(v_street) then
        raise exception 'complete_valid_address_required' using errcode='22023';
      end if;
      v_unit:=coalesce(nullif(v_unit,''),private.field_gps_inline_unit(v_street));v_street:=private.field_gps_base_street(v_street);
    end if;
    v_city:=trim(coalesce(v_address->>'city','')); v_state:=upper(trim(coalesce(v_address->>'state',''))); v_zip:=trim(coalesce(v_address->>'zip',''));
    if length(v_street) not between 1 and 180 or length(v_unit)>80 or length(v_city) not between 1 and 100
      or v_state!~'^[A-Z]{2}$' or v_zip!~'^\d{5}(-\d{4})?$' then
      raise exception 'complete_valid_address_required' using errcode='22023';
    end if;
    v_key:=private.field_gps_address_key(v_street,v_city,v_state,v_zip);
    perform pg_advisory_xact_lock(hashtextextended(v_access.organization_id::text||':'||v_key,1));
    -- Stable lock order prevents two GPS operations from creating duplicates or
    -- moving only half of an existing group. Never choose by last_activity_at.
    for v_lead in select * from public.leads where organization_id=v_access.organization_id and deleted_at is null
      and upper(coalesce(source_system,'')) not like '%DEMO%'
      and private.field_gps_address_key(address1,city,state,zip)=v_key order by id for update loop
      if not (v_access.role='admin' or (v_access.role in ('manager','trainer') and coalesce(v_lead.assigned_manager_id=v_actor.id,false))
        or (v_access.role='rep' and coalesce(v_lead.assigned_rep_id=v_actor.id,false))) then
        raise exception 'address_group_not_authorized' using errcode='42501';
      end if;
      v_ids:=array_append(v_ids,v_lead.id);
      if private.field_gps_unit_key(coalesce(nullif(trim(v_lead.address2),''),private.field_gps_inline_unit(v_lead.address1)))=private.field_gps_unit_key(v_unit) then v_exact:=array_append(v_exact,v_lead.id); end if;
      if p_action='knock_door' and v_lead.pin_location_updated_at>v_captured then raise exception 'stale_location' using errcode='40001'; end if;
    end loop;
    if v_visit.lead_id is not null and not (v_visit.lead_id=any(v_ids)) then
      raise exception 'stale_location' using errcode='40001';
    end if;
    -- A specified new unit gets its own row; entering a building with existing
    -- units does not fabricate a unitless customer or pick a random apartment.
    if cardinality(v_ids)=0 or (v_unit<>'' and cardinality(v_exact)=0) then
      if v_access.role in ('rep','tester') and nullif(trim(v_access.assigned_manager_email),'') is not null then
        select id into v_manager from public.users where organization_id=v_access.organization_id
          and lower(email)=lower(v_access.assigned_manager_email) and active is true;
      end if;
      v_contact:=coalesce(p_input->'contact','{}'::jsonb);
      if length(coalesce(v_contact->>'customer_name',''))>160 or length(coalesce(v_contact->>'phone',''))>40 or length(coalesce(v_contact->>'notes',''))>5000 then
        raise exception 'contact_too_long' using errcode='22023';
      end if;
      insert into public.leads(organization_id,source_system,source_id,address1,address2,city,state,zip,
        customer_name,phone,notes,current_disposition,stage,pin_color,pin_color_source,
        assigned_rep_id,assigned_manager_id,assigned_admin_email,created_by_user_id,created_by_email,
        contact_updated_at,contact_updated_by,contact_updated_by_email,source_payload,source_first_seen_at,source_last_seen_at)
      values(v_access.organization_id,'FIELD_ENTRY','FIELD_ENTRY:'||v_access.organization_id::text||':'||v_request::text,
        v_street,nullif(v_unit,''),v_city,v_state,v_zip,nullif(v_contact->>'customer_name',''),nullif(v_contact->>'phone',''),coalesce(v_contact->>'notes',''),
        'uncontacted','Prospecting','#fbbf24','stage',
        case when v_access.role in ('rep','tester') then v_actor.id end,
        case when v_access.role in ('manager','trainer') then v_actor.id else v_manager end,
        case when v_access.role='admin' then lower(p_actor_email) else nullif(lower(trim(v_access.assigned_admin_email)),'') end,
        p_actor_auth_id,lower(p_actor_email),clock_timestamp(),p_actor_auth_id,lower(p_actor_email),
        jsonb_build_object('source','field_gps_pilot','requested_address',v_address),clock_timestamp(),clock_timestamp()) returning id into v_created;
      v_ids:=array_append(v_ids,v_created);v_exact:=array[v_created];
    elsif coalesce(p_input->'contact','{}'::jsonb)<>'{}'::jsonb then
      -- Existing customers are edited through the selected-door contact editor;
      -- never copy one customer's information across stacked records.
      raise exception 'use_selected_door_contact_editor' using errcode='22023';
    end if;
    if cardinality(v_exact)=1 then v_selected:=v_exact[1]; end if;
    if v_visit.lead_id=any(v_ids) then v_selected:=v_visit.lead_id; end if;
  if p_action='add_address' then
    v_result:=jsonb_build_object('ok',true,'created',v_created is not null,'moved_count',0,'lead_ids',to_jsonb(v_ids),
      'lead',case when v_selected is null then null else jsonb_build_object('id',v_selected) end,
      'requires_door_selection',v_selected is null,'source','address_only');
    insert into private.field_gps_requests(organization_id,actor_user_id,request_id,action,input,result)
      values(v_access.organization_id,v_actor.id,v_request,p_action,p_input,v_result);
    return v_result;
  end if;
  -- Check after waiting for locks as well: time spent queued cannot make an old
  -- browser reading appear fresh. Poor *accuracy* is allowed; invalid/stale fixes are not.
  v_now:=clock_timestamp();
  if (v_captured between v_now-interval '30 seconds' and v_now+interval '5 seconds') is not true then
    raise exception 'fresh_gps_required' using errcode='22023';
  end if;
  insert into private.field_gps_requests(organization_id,actor_user_id,request_id,action,input,result)
    values(v_access.organization_id,v_actor.id,v_request,p_action,p_input,'{}');
  for v_lead in select * from public.leads where id=any(v_ids) order by id loop
    v_before:=jsonb_build_object('latitude',v_lead.latitude,'longitude',v_lead.longitude,'pin_location_updated_at',v_lead.pin_location_updated_at,
      'geocode_status',v_lead.geocode_status,'geocode_provider',v_lead.geocode_provider,'geocode_precision',v_lead.geocode_precision,
      'geocode_verification_status',v_lead.geocode_verification_status,'geocode_verified_at',v_lead.geocode_verified_at,
      'geocode_verification_details',v_lead.geocode_verification_details);
    update public.leads set latitude=v_lat,longitude=v_lng,pin_location_updated_at=v_now,
      geocode_status='field_reported',geocode_provider='device_gps',geocode_precision='reported_door',geocode_verified_at=null,
      geocode_verification_status=case when v_accuracy>35 then 'gps_reported_door_low_accuracy' else 'gps_reported_door' end,
      geocode_verification_details=coalesce(geocode_verification_details,'{}')||jsonb_build_object('field_gps',jsonb_build_object(
        'source','user_reported_door','accuracy_meters',v_accuracy,'captured_at',v_captured,'request_id',v_request,
        'actor_user_id',v_actor.id,'address_distance_checked',false,'independently_verified',false))
      where id=v_lead.id;
    insert into private.field_gps_locations(lead_id,accuracy_meters,captured_at,pin_version) values(v_lead.id,v_accuracy,v_captured,v_now)
      on conflict(lead_id) do update set accuracy_meters=excluded.accuracy_meters,captured_at=excluded.captured_at,pin_version=excluded.pin_version;
    insert into private.field_gps_audit(organization_id,actor_user_id,actor_auth_user_id,request_id,lead_id,action,previous_pin,
      latitude,longitude,accuracy_meters,captured_at,applied_at,visit_id)
      values(v_access.organization_id,v_actor.id,p_actor_auth_id,v_request,v_lead.id,
        case when v_lead.id=v_created then 'create' else 'place_group' end,
        v_before,v_lat,v_lng,v_accuracy,v_captured,v_now,v_visit.id);
    v_count:=v_count+1;
  end loop;
  if v_visit.lead_id is null and v_selected is not null then
    update public.door_visits set lead_id=v_selected,updated_at=clock_timestamp() where id=v_visit.id;
    update public.leads set attempt_count=attempt_count+1,last_activity_at=v_visit.arrived_at where id=v_selected;
  end if;
  v_result:=jsonb_build_object('ok',true,'created',v_created is not null,'moved_count',v_count,'lead_ids',to_jsonb(v_ids),
    'lead',case when v_selected is null then null else jsonb_build_object('id',v_selected) end,
    'requires_door_selection',v_selected is null,'accuracy_meters',v_accuracy,'low_accuracy',v_accuracy>35,
    'latitude',v_lat,'longitude',v_lng,'pin_version',v_now,'source','user_reported_door','visit_id',v_visit.id);
  update private.field_gps_requests set result=v_result where organization_id=v_access.organization_id and actor_user_id=v_actor.id and request_id=v_request;
  return v_result;
end;
$$;
revoke all on function public.field_gps_placement(uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.field_gps_placement(uuid,text,text,jsonb) to service_role;
comment on function public.field_gps_placement(uuid,text,text,jsonb) is 'Account-scoped GPS doorway pilot. Authenticated Edge identity only; ADD ADDRESS never moves coordinates; KNOCK DOOR places an authorized address group using an owned active manual visit. No automatic nearest-lead selection.';
commit;
