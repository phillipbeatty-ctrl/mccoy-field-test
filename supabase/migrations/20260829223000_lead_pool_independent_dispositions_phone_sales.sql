-- Independent Lead Pool dispositions, explicit sale-to-visit linking, and phone-sale lead matching.
-- Lead Pool map activity may be recorded while a separate Sales Hub door visit remains active.

alter table public.door_visits
  add column if not exists occurred_at timestamptz,
  add column if not exists client_request_id uuid;

update public.door_visits
set occurred_at=coalesce(disposition_at,arrived_at,created_at,clock_timestamp())
where occurred_at is null;

alter table public.door_visits
  alter column occurred_at set default clock_timestamp(),
  alter column occurred_at set not null;

create unique index if not exists door_visits_rep_client_request_unique
  on public.door_visits(rep_id,client_request_id)
  where client_request_id is not null;

create index if not exists door_visits_session_occurred_at_idx
  on public.door_visits(session_id,occurred_at desc);

alter table public.provider_sale_captures
  add column if not exists lead_id uuid references public.leads(id) on delete set null,
  add column if not exists source_door_visit_id uuid references public.door_visits(id) on delete set null;

alter table public.sales_records
  add column if not exists source_door_visit_id uuid references public.door_visits(id) on delete set null;

create index if not exists provider_sale_captures_lead_idx
  on public.provider_sale_captures(organization_id,lead_id)
  where lead_id is not null;
create index if not exists provider_sale_captures_source_visit_idx
  on public.provider_sale_captures(organization_id,source_door_visit_id)
  where source_door_visit_id is not null;
create index if not exists sales_records_source_visit_idx
  on public.sales_records(organization_id,source_door_visit_id)
  where source_door_visit_id is not null;

alter table public.door_visits
  drop constraint if exists door_visits_selection_source_check;
alter table public.door_visits
  add constraint door_visits_selection_source_check check(
    selection_source in (
      'automatic_nearest','manual_lead','restored_visit','sale_lead','manual_address',
      'provider_address','typed_address','lead_pool_map'
    )
  );

-- Extend tenant-reference enforcement to the explicit lead and door-visit links.
drop trigger if exists tenant_guard_provider_sale_captures on public.provider_sale_captures;
create trigger tenant_guard_provider_sale_captures
before insert or update of organization_id,lead_id,source_door_visit_id,session_id
on public.provider_sale_captures
for each row execute function private.enforce_same_organization_references(
  'lead_id','leads','source_door_visit_id','door_visits','session_id','test_sessions'
);

drop trigger if exists tenant_guard_sales_records on public.sales_records;
create trigger tenant_guard_sales_records
before insert or update of organization_id,distance_lead_id,provider_capture_id,session_id,source_door_visit_id
on public.sales_records
for each row execute function private.enforce_same_organization_references(
  'distance_lead_id','leads','provider_capture_id','provider_sale_captures',
  'session_id','test_sessions','source_door_visit_id','door_visits'
);

-- Exact full-address matching used only when a phone-sale address resolves to one live lead.
create or replace function public.match_lead_by_service_address(
  p_organization_id uuid,
  p_service_address text
)
returns uuid
language sql
stable
security definer
set search_path=pg_catalog,public
as $$
  select l.id
  from public.leads l
  where l.organization_id=p_organization_id
    and l.deleted_at is null
    and upper(coalesce(l.source_system,'')) not like '%DEMO%'
    and regexp_replace(
      lower(concat_ws(' ',l.address1,l.address2,l.city,l.state,l.zip)),
      '[^a-z0-9]+','','g'
    )=regexp_replace(lower(coalesce(p_service_address,'')),'[^a-z0-9]+','','g')
    and length(regexp_replace(lower(coalesce(p_service_address,'')),'[^a-z0-9]+','','g'))>=5
  order by coalesce(l.last_activity_at,l.created_at) desc,l.id
  limit 1;
$$;

revoke all on function public.match_lead_by_service_address(uuid,text) from public,anon,authenticated;
grant execute on function public.match_lead_by_service_address(uuid,text) to service_role;

create or replace function public.record_lead_pool_pin_disposition(
  p_session_id uuid,
  p_lead_id uuid,
  p_client_request_id uuid,
  p_activity_type text,
  p_visit_result text,
  p_stage text,
  p_occurred_at timestamptz,
  p_dwell_seconds integer,
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
$$;

revoke all on function public.record_lead_pool_pin_disposition(
  uuid,uuid,uuid,text,text,text,timestamptz,integer,double precision,double precision,double precision,timestamptz
) from public,anon;
grant execute on function public.record_lead_pool_pin_disposition(
  uuid,uuid,uuid,text,text,text,timestamptz,integer,double precision,double precision,double precision,timestamptz
) to authenticated;

comment on function public.record_lead_pool_pin_disposition(
  uuid,uuid,uuid,text,text,text,timestamptz,integer,double precision,double precision,double precision,timestamptz
) is 'Records an idempotent completed Lead Pool map activity without creating, replacing, or completing the Sales Hub active door visit.';

-- A completed sale may close only the exact door visit explicitly linked to its provider capture.
-- Unlinked and phone sales create their own completed sale activity and preserve any unrelated active visit.
create or replace function public.sync_completed_sale_to_door_workflow()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  v_visit public.door_visits%rowtype;
  v_profile_id uuid;
  v_now timestamptz:=coalesce(new.created_at,clock_timestamp());
  v_source text;
  v_linked boolean:=false;
  v_sale_lead_id uuid:=new.distance_lead_id;
begin
  if new.rep_reported_outcome is distinct from 'completed' or new.session_id is null then return new; end if;

  select id into v_profile_id
  from public.users
  where auth_user_id=new.rep_user_id and organization_id=new.organization_id
  limit 1;
  if v_profile_id is null then return new; end if;

  if new.source_door_visit_id is not null then
    select * into v_visit
    from public.door_visits
    where id=new.source_door_visit_id
      and session_id=new.session_id
      and rep_id=v_profile_id
      and organization_id=new.organization_id
      and status='active'
    for update;

    if found then
      v_linked:=true;
      v_sale_lead_id:=coalesce(new.distance_lead_id,v_visit.lead_id);
      update public.door_visits
      set status='completed',occurred_at=coalesce(occurred_at,arrived_at,v_now),disposition_at=v_now,
          dwell_seconds=greatest(0,extract(epoch from(v_now-arrived_at)))::integer,
          visit_outcome='Sale',contact_status='Contacted',disposition='sale',
          activity_type='Visit',visit_result='Contacted',lead_stage='Sale Made',
          pin_color='#22c55e',pin_color_source='stage',provider_sale_id=new.id,
          provider_capture_id=new.provider_capture_id,service_address=new.service_address,
          auto_disposition=true,auto_reason='completed_sale_recorded_explicit_visit_link',updated_at=clock_timestamp()
      where id=v_visit.id
      returning * into v_visit;
    end if;
  end if;

  if not v_linked then
    v_source:=case when v_sale_lead_id is not null then 'sale_lead' else 'provider_address' end;
    insert into public.door_visits(
      organization_id,lead_id,rep_id,session_id,occurred_at,arrived_at,disposition_at,
      disposition,service_address,selection_source,status,arrival_distance_from_lead_meters,
      disposition_distance_from_lead_meters,dwell_seconds,visit_outcome,contact_status,
      activity_type,visit_result,lead_stage,pin_color,pin_color_source,
      auto_disposition,auto_reason,provider_sale_id,provider_capture_id,client_request_id,manual_override
    ) values (
      new.organization_id,v_sale_lead_id,v_profile_id,new.session_id,v_now,v_now,v_now,
      'sale',new.service_address,v_source,'completed',new.rep_distance_from_customer_meters,
      new.rep_distance_from_customer_meters,0,'Sale','Contacted',
      'Visit','Contacted','Sale Made','#22c55e','stage',
      true,'completed_sale_recorded_unlinked_visit_preserved',new.id,new.provider_capture_id,new.provider_capture_id,true
    )
    on conflict(rep_id,client_request_id) where client_request_id is not null do update
      set provider_sale_id=excluded.provider_sale_id,updated_at=clock_timestamp()
    returning * into v_visit;
  end if;

  if v_sale_lead_id is not null then
    update public.leads
    set current_disposition='Sale Made',last_activity_type='Visit',visit_result='Contacted',
        stage='Sale Made',pin_color='#22c55e',pin_color_source='stage',last_activity_at=v_now
    where id=v_sale_lead_id and organization_id=new.organization_id and deleted_at is null;
  end if;

  insert into public.test_events(
    organization_id,session_id,event_type,lead_label,disposition,event_time,dwell_ms,
    distance_to_lead_meters,payload
  ) values (
    new.organization_id,new.session_id,'disposition',new.service_address,'Sale Made',v_now,
    coalesce(v_visit.dwell_seconds,0)*1000,new.rep_distance_from_customer_meters,
    jsonb_build_object(
      'server_generated',true,'visit_id',v_visit.id,'visit_outcome','Sale',
      'activity_type','Visit','visit_result','Contacted','stage','Sale Made',
      'effective_disposition','Sale Made','pin_color','#22c55e','pin_color_source','stage',
      'contact_status','Contacted','automatic',true,'provider_sale_id',new.id,
      'source_door_visit_id',new.source_door_visit_id,'explicit_visit_link_applied',v_linked,
      'unrelated_active_visit_preserved',not v_linked
    )
  );
  return new;
exception when unique_violation then return new;
end;
$$;

revoke all on function public.sync_completed_sale_to_door_workflow() from public,anon,authenticated;

comment on function public.sync_completed_sale_to_door_workflow() is
  'Completes only an explicitly linked active door visit. Phone and unlinked sales create a separate completed activity and preserve unrelated active visits.';
