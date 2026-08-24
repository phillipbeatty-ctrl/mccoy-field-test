alter table public.leads
  add column if not exists last_activity_type text,
  add column if not exists visit_result text,
  add column if not exists stage text not null default 'Prospecting',
  add column if not exists pin_color text not null default '#fbbf24',
  add column if not exists pin_color_source text not null default 'stage';

alter table public.door_visits
  add column if not exists activity_type text,
  add column if not exists visit_result text,
  add column if not exists lead_stage text,
  add column if not exists pin_color text,
  add column if not exists pin_color_source text;

update public.leads
set
  visit_result=case
    when lower(trim(current_disposition)) in ('not contacted','uncontacted','visit','no answer') then 'No Answer'
    when lower(trim(current_disposition))='contacted' then 'Contacted'
    when lower(trim(current_disposition)) in ('follow up','follow-up') then 'Follow-Up'
    else visit_result
  end,
  stage=case
    when lower(trim(current_disposition)) in ('hot lead','interested','set appointment','appointment set','appointment') then 'Hot Lead'
    when lower(trim(current_disposition))='contacted' then 'Contacted'
    when lower(trim(current_disposition)) in ('follow up','follow-up') then 'Follow Up'
    when lower(trim(current_disposition))='migrator' then 'Migrator'
    when lower(trim(current_disposition)) in ('existing customer','already a customer','customer') then 'Existing Customer'
    when lower(trim(current_disposition))='smb' then 'SMB'
    when lower(trim(current_disposition)) in ('sale made','sale','sold','signed','won') then 'Sale Made'
    when lower(trim(current_disposition)) in ('no sale','not interested','lost') then 'No Sale'
    when lower(trim(current_disposition)) in ('admin hold','no solicitation requested','do not knock','dnk') then 'Admin Hold'
    else 'Prospecting'
  end;

update public.leads
set pin_color=case stage
    when 'Prospecting' then '#fbbf24'
    when 'Hot Lead' then '#c4b5fd'
    when 'Contacted' then '#93c5fd'
    when 'Follow Up' then '#1d4ed8'
    when 'Migrator' then '#f97316'
    when 'Existing Customer' then '#ffffff'
    when 'SMB' then '#ec4899'
    when 'Sale Made' then '#22c55e'
    when 'No Sale' then '#9ca3af'
    when 'Admin Hold' then '#581c87'
    else '#fbbf24'
  end,
  pin_color_source='stage';

alter table public.leads
  add constraint leads_activity_type_check check(last_activity_type is null or last_activity_type in ('Visit','Call','Appointment','Text','Qualify','Investigate & Estimate','Make a Proposal','Get Feedback')),
  add constraint leads_visit_result_check check(visit_result is null or visit_result in ('No Answer','Contacted','Follow-Up')),
  add constraint leads_stage_check check(stage in ('Prospecting','Hot Lead','Contacted','Follow Up','Migrator','Existing Customer','SMB','Sale Made','No Sale','Admin Hold')),
  add constraint leads_pin_color_check check(pin_color~'^#[0-9A-Fa-f]{6}$'),
  add constraint leads_pin_color_source_check check(pin_color_source in ('stage','visit_result','legacy'));

alter table public.door_visits
  add constraint door_visits_activity_type_check check(activity_type is null or activity_type in ('Visit','Call','Appointment','Text','Qualify','Investigate & Estimate','Make a Proposal','Get Feedback')),
  add constraint door_visits_visit_result_check check(visit_result is null or visit_result in ('No Answer','Contacted','Follow-Up')),
  add constraint door_visits_lead_stage_check check(lead_stage is null or lead_stage in ('Prospecting','Hot Lead','Contacted','Follow Up','Migrator','Existing Customer','SMB','Sale Made','No Sale','Admin Hold')),
  add constraint door_visits_pin_color_check check(pin_color is null or pin_color~'^#[0-9A-Fa-f]{6}$'),
  add constraint door_visits_pin_color_source_check check(pin_color_source is null or pin_color_source in ('stage','visit_result'));

create or replace function public.record_spotio_door_visit_completion(
  p_visit_id uuid,
  p_activity_type text,
  p_visit_result text,
  p_stage text,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_meters double precision,
  p_gps_captured_at timestamptz,
  p_automatic boolean default false,
  p_auto_reason text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path=pg_catalog,public,private,auth
as $$
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
    when 'smb' then 'SMB' when 'sale made' then 'Sale Made' when 'no sale' then 'No Sale' when 'admin hold' then 'Admin Hold' else null end;
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
$$;

revoke all on function public.record_spotio_door_visit_completion(uuid,text,text,text,double precision,double precision,double precision,timestamptz,boolean,text) from public,anon;
grant execute on function public.record_spotio_door_visit_completion(uuid,text,text,text,double precision,double precision,double precision,timestamptz,boolean,text) to authenticated;

create or replace function public.sync_completed_sale_to_door_workflow()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare v_visit public.door_visits%rowtype;v_profile_id uuid;v_now timestamptz:=coalesce(new.created_at,clock_timestamp());v_source text;
begin
  if new.rep_reported_outcome is distinct from 'completed' or new.session_id is null then return new; end if;
  select id into v_profile_id from public.users where auth_user_id=new.rep_user_id limit 1;
  if v_profile_id is null then return new; end if;
  select * into v_visit from public.door_visits
  where session_id=new.session_id and rep_id=v_profile_id and status='active'
  order by (lead_id is not distinct from new.distance_lead_id) desc,arrived_at desc limit 1 for update;
  if found then
    update public.door_visits set status='completed',disposition_at=v_now,dwell_seconds=greatest(0,extract(epoch from(v_now-arrived_at)))::integer,
      visit_outcome='Sale',contact_status='Contacted',disposition='sale',activity_type='Visit',visit_result='Contacted',lead_stage='Sale Made',
      pin_color='#22c55e',pin_color_source='stage',provider_sale_id=new.id,provider_capture_id=new.provider_capture_id,
      service_address=new.service_address,auto_disposition=true,auto_reason='completed_sale_recorded',updated_at=clock_timestamp()
    where id=v_visit.id returning * into v_visit;
    if v_visit.lead_id is not null then update public.leads set current_disposition='Sale Made',last_activity_type='Visit',visit_result='Contacted',stage='Sale Made',pin_color='#22c55e',pin_color_source='stage',last_activity_at=v_now where id=v_visit.lead_id; end if;
  else
    v_source:=case when new.provider_capture_id is not null then 'provider_address' when new.distance_lead_id is not null then 'sale_lead' else 'manual_address' end;
    insert into public.door_visits(lead_id,rep_id,session_id,arrived_at,disposition_at,disposition,service_address,selection_source,status,
      arrival_distance_from_lead_meters,dwell_seconds,visit_outcome,contact_status,activity_type,visit_result,lead_stage,pin_color,pin_color_source,
      auto_disposition,auto_reason,provider_sale_id,provider_capture_id)
    values(new.distance_lead_id,v_profile_id,new.session_id,v_now,v_now,'sale',new.service_address,v_source,'completed',
      new.rep_distance_from_customer_meters,0,'Sale','Contacted','Visit','Contacted','Sale Made','#22c55e','stage',true,'completed_sale_recorded',new.id,new.provider_capture_id)
    returning * into v_visit;
    if new.distance_lead_id is not null then update public.leads set current_disposition='Sale Made',last_activity_type='Visit',visit_result='Contacted',stage='Sale Made',pin_color='#22c55e',pin_color_source='stage',last_activity_at=v_now where id=new.distance_lead_id; end if;
  end if;
  insert into public.test_events(session_id,event_type,lead_label,disposition,event_time,dwell_ms,distance_to_lead_meters,payload)
  values(new.session_id,'disposition',new.service_address,'Sale Made',v_now,coalesce(v_visit.dwell_seconds,0)*1000,new.rep_distance_from_customer_meters,
    jsonb_build_object('server_generated',true,'visit_id',v_visit.id,'visit_outcome','Sale','activity_type','Visit','visit_result','Contacted','stage','Sale Made','effective_disposition','Sale Made','pin_color','#22c55e','pin_color_source','stage','contact_status','Contacted','automatic',true,'auto_reason','completed_sale_recorded','provider_sale_id',new.id));
  return new;
exception when unique_violation then return new;
end;
$$;

revoke all on function public.sync_completed_sale_to_door_workflow() from public,anon,authenticated;

comment on function public.record_spotio_door_visit_completion(uuid,text,text,text,double precision,double precision,double precision,timestamptz,boolean,text) is
  'Atomically completes an owned door visit with SPOTIO-style Activity Type, Visit Result, optional Stage, GPS audit, and deterministic pin color. Sale Made is only set by the completed-sale workflow.';
