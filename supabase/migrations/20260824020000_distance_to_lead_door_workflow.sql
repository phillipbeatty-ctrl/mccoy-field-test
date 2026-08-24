-- Extend McCoy's original door_visits ledger into the authoritative Distance
-- to Lead workflow. Non-sale outcomes require a fresh GPS fix within one
-- quarter mile. Completed sales remain valid at any distance and retain the
-- manually entered or provider-supplied address for Admin verification.

alter table public.door_visits
  alter column lead_id drop not null,
  add column if not exists service_address text,
  add column if not exists selection_source text,
  add column if not exists status text not null default 'active',
  add column if not exists visit_outcome text,
  add column if not exists contact_status text,
  add column if not exists auto_disposition boolean not null default false,
  add column if not exists auto_reason text,
  add column if not exists manual_override boolean not null default false,
  add column if not exists provider_sale_id uuid references public.sales_records(id) on delete set null,
  add column if not exists provider_capture_id uuid references public.provider_sale_captures(id) on delete set null,
  add column if not exists cancelled_reason text,
  add column if not exists updated_at timestamptz not null default clock_timestamp();

update public.door_visits
set
  status=case when disposition_at is null then 'active' else 'completed' end,
  selection_source=coalesce(selection_source,'manual_lead'),
  visit_outcome=coalesce(visit_outcome,disposition),
  contact_status=coalesce(contact_status,case when disposition is null then null when lower(disposition) in ('not home','not contacted','visit') then 'Not Contacted' else 'Contacted' end)
where selection_source is null or visit_outcome is null or contact_status is null;

alter table public.door_visits alter column selection_source set not null;

alter table public.door_visits
  drop constraint if exists door_visits_selection_source_check,
  add constraint door_visits_selection_source_check check (
    selection_source in ('automatic_nearest','manual_lead','restored_visit','sale_lead','manual_address','provider_address')
  ),
  drop constraint if exists door_visits_status_check,
  add constraint door_visits_status_check check (status in ('active','completed','cancelled')),
  drop constraint if exists door_visits_contact_status_check,
  add constraint door_visits_contact_status_check check (contact_status is null or contact_status in ('Not Contacted','Contacted')),
  drop constraint if exists door_visits_disposition_check,
  add constraint door_visits_disposition_check check (
    disposition is null or disposition in ('visit','no_sale','set_appointment','no_solicitation_requested','already_a_customer','sale')
  );

create index if not exists door_visits_rep_id_arrived_at_idx on public.door_visits(rep_id,arrived_at desc);
create index if not exists door_visits_lead_id_arrived_at_idx on public.door_visits(lead_id,arrived_at desc) where lead_id is not null;
create index if not exists door_visits_provider_capture_id_idx on public.door_visits(provider_capture_id) where provider_capture_id is not null;
create unique index if not exists door_visits_one_active_session_idx on public.door_visits(session_id) where status='active';
create unique index if not exists door_visits_provider_sale_id_key on public.door_visits(provider_sale_id) where provider_sale_id is not null;

alter table public.door_visits enable row level security;
drop policy if exists door_visits_insert_self on public.door_visits;
drop policy if exists door_visits_update_self on public.door_visits;
revoke all on public.door_visits from public,anon,authenticated;
grant select on public.door_visits to authenticated;
grant all on public.door_visits to service_role;

create or replace function private.mccoy_distance_meters(
  p_latitude_a double precision,
  p_longitude_a double precision,
  p_latitude_b double precision,
  p_longitude_b double precision
)
returns double precision
language sql
immutable
strict
set search_path=''
as $$
  select 6371000 * 2 * asin(sqrt(least(1::double precision,
    sin(radians(p_latitude_b-p_latitude_a)/2)^2
    + cos(radians(p_latitude_a))*cos(radians(p_latitude_b))*sin(radians(p_longitude_b-p_longitude_a)/2)^2
  )));
$$;

revoke all on function private.mccoy_distance_meters(double precision,double precision,double precision,double precision) from public,anon,authenticated;

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
  if v_access.role='admin' then null;
  elsif v_access.role in ('manager','trainer') then
    if v_lead.assigned_manager_id is distinct from v_profile.id
       or lower(coalesce(v_lead.assigned_admin_email,''))<>lower(coalesce(v_access.assigned_manager_email,'')) then
      raise exception 'lead_outside_assigned_pool' using errcode='42501';
    end if;
  elsif v_access.role in ('rep','tester') then
    if v_lead.assigned_rep_id is distinct from v_profile.id then raise exception 'lead_not_assigned_to_rep' using errcode='42501'; end if;
  else
    raise exception 'field_role_required' using errcode='42501';
  end if;

  v_distance:=private.mccoy_distance_meters(p_latitude,p_longitude,v_lead.latitude,v_lead.longitude);
  if v_distance>402.336 then raise exception 'outside_quarter_mile_sale_only' using errcode='22023'; end if;
  v_label:=concat_ws(', ',nullif(concat_ws(' ',v_lead.address1,v_lead.address2),''),nullif(v_lead.city,''),nullif(concat_ws(' ',v_lead.state,v_lead.zip),''));

  select * into v_existing from public.door_visits where session_id=p_session_id and status='active' for update;
  if found then
    if v_existing.lead_id=p_lead_id then
      return jsonb_build_object('ok',true,'duplicate',true,'visit_id',v_existing.id,'started_at',v_existing.arrived_at,'distance_meters',v_existing.arrival_distance_from_lead_meters,'lead_id',v_existing.lead_id,'lead_label',v_existing.service_address);
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
    jsonb_build_object('server_generated',true,'visit_id',v_visit.id,'lead_id',p_lead_id,'selection_source',v_source,'quarter_mile_limit_meters',402.336)
  );
  return jsonb_build_object('ok',true,'visit_id',v_visit.id,'started_at',v_visit.arrived_at,'distance_meters',v_distance,'lead_id',p_lead_id,'lead_label',v_label);
end;
$$;

revoke all on function public.record_door_visit_start(uuid,uuid,text,double precision,double precision,double precision,timestamptz) from public,anon;
grant execute on function public.record_door_visit_start(uuid,uuid,text,double precision,double precision,double precision,timestamptz) to authenticated;

create or replace function public.cancel_door_visit(p_visit_id uuid,p_reason text)
returns jsonb
language plpgsql
volatile
security definer
set search_path=pg_catalog,public,private,auth
as $$
declare
  v_uid uuid:=(select auth.uid());v_profile_id uuid;v_visit public.door_visits%rowtype;
  v_reason text:=left(trim(coalesce(p_reason,'')),160);v_now timestamptz:=clock_timestamp();v_dwell integer;
begin
  if v_uid is null then raise exception 'authentication_required' using errcode='42501'; end if;
  select id into v_profile_id from public.users where auth_user_id=v_uid and active is true limit 1;
  if v_profile_id is null then raise exception 'active_user_profile_required' using errcode='42501'; end if;
  if v_reason='' then raise exception 'correction_reason_required' using errcode='22023'; end if;
  select * into v_visit from public.door_visits where id=p_visit_id and rep_id=v_profile_id for update;
  if not found then raise exception 'owned_door_visit_not_found' using errcode='P0002'; end if;
  if v_visit.status='cancelled' then return jsonb_build_object('ok',true,'duplicate',true,'visit_id',v_visit.id); end if;
  if v_visit.status<>'active' then raise exception 'completed_visit_cannot_be_cancelled' using errcode='22023'; end if;
  v_dwell:=greatest(0,extract(epoch from(v_now-v_visit.arrived_at)))::integer;
  update public.door_visits set status='cancelled',disposition_at=v_now,dwell_seconds=v_dwell,cancelled_reason=v_reason,updated_at=v_now where id=v_visit.id;
  insert into public.test_events(session_id,event_type,lead_label,event_time,dwell_ms,payload)
  values(v_visit.session_id,'door_visit_corrected',v_visit.service_address,v_now,v_dwell*1000,jsonb_build_object('server_generated',true,'visit_id',v_visit.id,'reason',v_reason));
  return jsonb_build_object('ok',true,'visit_id',v_visit.id);
end;
$$;

revoke all on function public.cancel_door_visit(uuid,text) from public,anon;
grant execute on function public.cancel_door_visit(uuid,text) to authenticated;

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
  v_requested text:=lower(trim(coalesce(p_disposition,'')));v_disposition text;v_outcome text;v_contact text;v_distance double precision;v_dwell integer;
begin
  if v_uid is null then raise exception 'authentication_required' using errcode='42501'; end if;
  select id into v_profile_id from public.users where auth_user_id=v_uid and active is true limit 1;
  if v_profile_id is null then raise exception 'active_user_profile_required' using errcode='42501'; end if;
  select * into v_visit from public.door_visits where id=p_visit_id and rep_id=v_profile_id for update;
  if not found then raise exception 'owned_door_visit_not_found' using errcode='P0002'; end if;
  if v_visit.status='completed' then return jsonb_build_object('ok',true,'duplicate',true,'visit_id',v_visit.id,'disposition',v_visit.disposition,'visit_outcome',v_visit.visit_outcome,'contact_status',v_visit.contact_status,'dwell_ms',coalesce(v_visit.dwell_seconds,0)*1000); end if;
  if v_visit.status<>'active' then raise exception 'door_visit_not_active' using errcode='22023'; end if;
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
    select * into v_lead from public.leads where id=v_visit.lead_id for update;
    if not found or v_lead.latitude is null or v_lead.longitude is null then raise exception 'verified_lead_location_required' using errcode='22023'; end if;
    v_distance:=private.mccoy_distance_meters(p_latitude,p_longitude,v_lead.latitude,v_lead.longitude);
    if v_distance>402.336 then raise exception 'outside_quarter_mile_sale_only' using errcode='22023'; end if;
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
  where id=v_visit.id;
  if v_visit.lead_id is not null then update public.leads set current_disposition=v_outcome,last_activity_at=v_now where id=v_visit.lead_id; end if;
  insert into public.test_events(session_id,event_type,lead_label,disposition,event_time,latitude,longitude,accuracy_meters,gps_fix_age_ms,dwell_ms,lead_latitude,lead_longitude,distance_to_lead_meters,payload)
  values(v_visit.session_id,'disposition',v_visit.service_address,v_outcome,v_now,p_latitude,p_longitude,p_accuracy_meters,
    case when p_gps_captured_at is null then null else greatest(0,extract(epoch from(v_now-p_gps_captured_at))*1000)::integer end,
    v_dwell*1000,v_lead.latitude,v_lead.longitude,v_distance,
    jsonb_build_object('server_generated',true,'visit_id',v_visit.id,'visit_outcome',v_outcome,'contact_status',v_contact,'automatic',coalesce(p_automatic,false),'auto_reason',p_auto_reason,'provider_sale_id',p_provider_sale_id));
  return jsonb_build_object('ok',true,'visit_id',v_visit.id,'disposition',v_disposition,'visit_outcome',v_outcome,'contact_status',v_contact,'dwell_ms',v_dwell*1000,'distance_meters',v_distance);
end;
$$;

revoke all on function public.record_door_visit_completion(uuid,text,double precision,double precision,double precision,timestamptz,boolean,text,uuid,text) from public,anon;
grant execute on function public.record_door_visit_completion(uuid,text,double precision,double precision,double precision,timestamptz,boolean,text,uuid,text) to authenticated;

create or replace function public.resume_door_workflow()
returns jsonb
language plpgsql
stable
security definer
set search_path=pg_catalog,public,auth
as $$
declare v_uid uuid:=(select auth.uid());v_profile_id uuid;v_session public.test_sessions%rowtype;v_visit public.door_visits%rowtype;v_lead public.leads%rowtype;
begin
  if v_uid is null then raise exception 'authentication_required' using errcode='42501'; end if;
  select id into v_profile_id from public.users where auth_user_id=v_uid and active is true limit 1;
  if v_profile_id is null then raise exception 'active_user_profile_required' using errcode='42501'; end if;
  select * into v_session from public.test_sessions where tester_user_id=v_uid and ended_at is null and started_at>clock_timestamp()-interval '16 hours' order by started_at desc limit 1;
  if not found then return jsonb_build_object('ok',true,'session',null,'visit',null); end if;
  select * into v_visit from public.door_visits where session_id=v_session.id and rep_id=v_profile_id and status='active' order by arrived_at desc limit 1;
  if v_visit.lead_id is not null then select * into v_lead from public.leads where id=v_visit.lead_id; end if;
  return jsonb_build_object('ok',true,'session',jsonb_build_object('id',v_session.id,'started_at',v_session.started_at),
    'visit',case when v_visit.id is null then null else jsonb_build_object(
      'id',v_visit.id,'started_at',v_visit.arrived_at,'lead_id',v_visit.lead_id,'lead_label',v_visit.service_address,
      'selection_source',v_visit.selection_source,'arrival_latitude',v_visit.arrival_latitude,'arrival_longitude',v_visit.arrival_longitude,
      'arrival_accuracy_meters',v_visit.arrival_accuracy_meters,'arrival_distance_meters',v_visit.arrival_distance_from_lead_meters,
      'address1',v_lead.address1,'address2',v_lead.address2,'city',v_lead.city,'state',v_lead.state,'zip',v_lead.zip,
      'lead_latitude',v_lead.latitude,'lead_longitude',v_lead.longitude,'geocode_status',v_lead.geocode_status
    ) end);
end;
$$;

revoke all on function public.resume_door_workflow() from public,anon;
grant execute on function public.resume_door_workflow() to authenticated;

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
      visit_outcome='Sale',contact_status='Contacted',disposition='sale',provider_sale_id=new.id,provider_capture_id=new.provider_capture_id,
      service_address=new.service_address,auto_disposition=true,auto_reason='completed_sale_recorded',updated_at=clock_timestamp()
    where id=v_visit.id returning * into v_visit;
    if v_visit.lead_id is not null then update public.leads set current_disposition='Sale',last_activity_at=v_now where id=v_visit.lead_id; end if;
  else
    v_source:=case when new.provider_capture_id is not null then 'provider_address' when new.distance_lead_id is not null then 'sale_lead' else 'manual_address' end;
    insert into public.door_visits(lead_id,rep_id,session_id,arrived_at,disposition_at,disposition,service_address,selection_source,status,
      arrival_distance_from_lead_meters,dwell_seconds,visit_outcome,contact_status,auto_disposition,auto_reason,provider_sale_id,provider_capture_id)
    values(new.distance_lead_id,v_profile_id,new.session_id,v_now,v_now,'sale',new.service_address,v_source,'completed',
      new.rep_distance_from_customer_meters,0,'Sale','Contacted',true,'completed_sale_recorded',new.id,new.provider_capture_id)
    returning * into v_visit;
    if new.distance_lead_id is not null then update public.leads set current_disposition='Sale',last_activity_at=v_now where id=new.distance_lead_id; end if;
  end if;
  insert into public.test_events(session_id,event_type,lead_label,disposition,event_time,dwell_ms,distance_to_lead_meters,payload)
  values(new.session_id,'disposition',new.service_address,'Sale',v_now,coalesce(v_visit.dwell_seconds,0)*1000,new.rep_distance_from_customer_meters,
    jsonb_build_object('server_generated',true,'visit_id',v_visit.id,'visit_outcome','Sale','contact_status','Contacted','automatic',true,'auto_reason','completed_sale_recorded','provider_sale_id',new.id));
  return new;
exception when unique_violation then return new;
end;
$$;

drop trigger if exists sales_records_sync_completed_door_workflow on public.sales_records;
create trigger sales_records_sync_completed_door_workflow
after insert on public.sales_records
for each row execute function public.sync_completed_sale_to_door_workflow();

revoke all on function public.sync_completed_sale_to_door_workflow() from public,anon,authenticated;

comment on table public.door_visits is 'Authoritative door visit audit: nearest/manual selection, quarter-mile enforcement, dwell-derived contact status, disposition, and completed-sale linkage.';
comment on function public.record_door_visit_completion(uuid,text,double precision,double precision,double precision,timestamptz,boolean,text,uuid,text) is 'Completes an owned active door visit. Non-sale actions require a fresh location within 402.336 meters; sale is always allowed and the service address remains auditable.';
