-- Guarded lead removal for every active McCoy field role.
-- Leads are archived instead of physically deleted so visit, disposition,
-- assignment, location, and sale audit records remain intact.

create or replace function private.mccoy_normalized_lead_address(
  p_address1 text,
  p_address2 text,
  p_city text,
  p_state text,
  p_zip text
)
returns text
language plpgsql
immutable
set search_path=pg_catalog
as $$
declare
  v_street text:=lower(trim(regexp_replace(coalesce(p_address1,''),'[^a-zA-Z0-9]+',' ','g')));
  v_unit text:=lower(trim(regexp_replace(coalesce(p_address2,''),'[^a-zA-Z0-9]+',' ','g')));
  v_city text:=lower(trim(regexp_replace(coalesce(p_city,''),'[^a-zA-Z0-9]+',' ','g')));
  v_state text:=upper(trim(regexp_replace(coalesce(p_state,''),'[^a-zA-Z0-9]+','','g')));
  v_zip text:=left(regexp_replace(coalesce(p_zip,''),'[^0-9]','','g'),5);
  v_tail text;
begin
  -- Field entry sometimes receives a complete address in address1 while the
  -- city/state/ZIP fields are also populated. Remove only a matching suffix.
  foreach v_tail in array array[
    trim(concat_ws(' ',nullif(v_city,''),nullif(lower(v_state),''),nullif(v_zip,''))),
    trim(concat_ws(' ',nullif(v_city,''),nullif(lower(v_state),'')))
  ] loop
    if v_tail<>'' and v_street like '% '||v_tail and length(v_street)>length(v_tail) then
      v_street:=trim(left(v_street,length(v_street)-length(v_tail)));
      exit;
    end if;
  end loop;

  -- Normalize common postal suffix variants without collapsing unit numbers.
  v_street:=regexp_replace(v_street,'\m(street)\M','st','g');
  v_street:=regexp_replace(v_street,'\m(avenue)\M','ave','g');
  v_street:=regexp_replace(v_street,'\m(road)\M','rd','g');
  v_street:=regexp_replace(v_street,'\m(boulevard)\M','blvd','g');
  v_street:=regexp_replace(v_street,'\m(circle)\M','cir','g');
  v_street:=regexp_replace(v_street,'\m(court)\M','ct','g');
  v_street:=regexp_replace(v_street,'\m(drive)\M','dr','g');
  v_street:=regexp_replace(v_street,'\m(lane)\M','ln','g');
  v_street:=regexp_replace(v_street,'\m(highway)\M','hwy','g');
  v_street:=regexp_replace(v_street,'\m(place)\M','pl','g');
  v_street:=regexp_replace(v_street,'\m(parkway)\M','pkwy','g');
  v_street:=regexp_replace(v_street,'\m(terrace)\M','ter','g');
  v_street:=regexp_replace(v_street,'\m(trail)\M','trl','g');
  v_unit:=regexp_replace(v_unit,'\m(apartment|apt|unit|suite|ste)\M','unit','g');

  return concat_ws('|',v_street,v_unit,v_city,v_state,v_zip);
end;
$$;

alter table public.leads
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by_user_id uuid,
  add column if not exists deleted_by_email text,
  add column if not exists deleted_by_role text,
  add column if not exists deletion_reason text,
  add column if not exists duplicate_of_lead_id uuid references public.leads(id) on delete set null;

alter table public.leads
  drop column if exists normalized_address_key;

alter table public.leads
  add column normalized_address_key text generated always as (
    private.mccoy_normalized_lead_address(address1,address2,city,state,zip)
  ) stored;

alter table public.leads
  drop constraint if exists leads_deletion_reason_check;
alter table public.leads
  add constraint leads_deletion_reason_check
  check (deletion_reason is null or deletion_reason in ('manual','duplicate'));

create index if not exists leads_active_normalized_address_idx
  on public.leads(normalized_address_key,id)
  where deleted_at is null;
create index if not exists leads_deleted_at_idx
  on public.leads(deleted_at)
  where deleted_at is not null;
create index if not exists leads_duplicate_of_idx
  on public.leads(duplicate_of_lead_id)
  where duplicate_of_lead_id is not null;

create table if not exists public.lead_removal_audit (
  id bigint generated always as identity primary key,
  lead_id uuid not null,
  canonical_lead_id uuid,
  removed_at timestamptz not null default clock_timestamp(),
  removed_by_user_id uuid,
  removed_by_email text not null,
  removed_by_role text not null,
  reason text not null check (reason in ('manual','duplicate')),
  normalized_address_key text not null,
  lead_snapshot jsonb not null,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists lead_removal_audit_lead_time_idx
  on public.lead_removal_audit(lead_id,removed_at desc);
create index if not exists lead_removal_audit_actor_time_idx
  on public.lead_removal_audit(removed_by_email,removed_at desc);
create index if not exists lead_removal_audit_address_time_idx
  on public.lead_removal_audit(normalized_address_key,removed_at desc);

alter table public.lead_removal_audit enable row level security;
revoke all on table public.lead_removal_audit from public,anon,authenticated;
revoke all on sequence public.lead_removal_audit_id_seq from public,anon,authenticated;
grant select,insert on table public.lead_removal_audit to service_role;
grant usage,select on sequence public.lead_removal_audit_id_seq to service_role;

create or replace function public.lead_duplicate_status()
returns jsonb
language sql
stable
security invoker
set search_path=pg_catalog,public
as $$
with scored as (
  select l.*,
    exists(select 1 from public.door_visits v where v.lead_id=l.id and v.status='active') as has_active_visit
  from public.leads l
  where l.deleted_at is null
    and upper(coalesce(l.source_system,'')) not like '%DEMO%'
    and split_part(l.normalized_address_key,'|',1)<>''
    and split_part(l.normalized_address_key,'|',3)<>''
    and split_part(l.normalized_address_key,'|',4)<>''
), ranked as (
  select s.*,
    count(*) over(partition by s.normalized_address_key) as copies,
    row_number() over(
      partition by s.normalized_address_key
      order by s.has_active_visit desc,
        coalesce(s.attempt_count,0) desc,
        s.last_activity_at desc nulls last,
        (s.assigned_rep_id is not null) desc,
        (s.assigned_manager_id is not null) desc,
        s.created_at asc,
        s.id asc
    ) as duplicate_rank
  from scored s
), duplicate_rows as (
  select * from ranked where copies>1
), sample_groups as (
  select normalized_address_key,
    min(concat_ws(', ',nullif(concat_ws(' ',address1,address2),''),nullif(city,''),nullif(concat_ws(' ',state,zip),''))) as address,
    max(copies)::integer as copies,
    count(*) filter(where duplicate_rank>1 and not has_active_visit)::integer as removable,
    count(*) filter(where duplicate_rank>1 and has_active_visit)::integer as blocked
  from duplicate_rows
  group by normalized_address_key
  order by max(copies) desc,address
  limit 25
)
select jsonb_build_object(
  'ok',true,
  'duplicate_address_groups',coalesce((select count(distinct normalized_address_key) from duplicate_rows),0),
  'extra_leads',coalesce((select count(*) from duplicate_rows where duplicate_rank>1),0),
  'removable_extra_leads',coalesce((select count(*) from duplicate_rows where duplicate_rank>1 and not has_active_visit),0),
  'blocked_by_active_visits',coalesce((select count(*) from duplicate_rows where duplicate_rank>1 and has_active_visit),0),
  'snapshot_token',coalesce((select md5(string_agg(id::text||':'||normalized_address_key,',' order by normalized_address_key,id)) from duplicate_rows),'none'),
  'samples',coalesce((select jsonb_agg(jsonb_build_object('address',address,'copies',copies,'removable',removable,'blocked',blocked) order by copies desc,address) from sample_groups),'[]'::jsonb),
  'verification_rule','same normalized street, unit, city, state, and ZIP; unit values remain distinct'
);
$$;

revoke all on function public.lead_duplicate_status() from public,anon,authenticated;
grant execute on function public.lead_duplicate_status() to service_role;

create or replace function public.archive_lead(
  p_lead_id uuid,
  p_actor_user_id uuid,
  p_actor_email text,
  p_actor_role text,
  p_reason text default 'manual'
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path=pg_catalog,public
as $$
declare
  v_lead public.leads%rowtype;
  v_now timestamptz:=clock_timestamp();
begin
  if p_reason not in ('manual','duplicate') then return jsonb_build_object('ok',false,'error','invalid_removal_reason'); end if;
  select * into v_lead from public.leads where id=p_lead_id and deleted_at is null for update;
  if not found then return jsonb_build_object('ok',false,'error','lead_not_found_or_already_removed'); end if;
  if exists(select 1 from public.door_visits where lead_id=p_lead_id and status='active') then
    return jsonb_build_object('ok',false,'error','active_visit_exists');
  end if;

  update public.leads set
    deleted_at=v_now,
    deleted_by_user_id=p_actor_user_id,
    deleted_by_email=lower(trim(p_actor_email)),
    deleted_by_role=lower(trim(p_actor_role)),
    deletion_reason=p_reason,
    duplicate_of_lead_id=null
  where id=p_lead_id;

  insert into public.lead_removal_audit(
    lead_id,canonical_lead_id,removed_at,removed_by_user_id,removed_by_email,removed_by_role,
    reason,normalized_address_key,lead_snapshot,metadata
  ) values (
    v_lead.id,null,v_now,p_actor_user_id,lower(trim(p_actor_email)),lower(trim(p_actor_role)),
    p_reason,v_lead.normalized_address_key,to_jsonb(v_lead),jsonb_build_object('soft_delete',true,'all_user_control',true)
  );

  return jsonb_build_object('ok',true,'lead_id',v_lead.id,'removed_at',v_now,'soft_delete',true);
end;
$$;

revoke all on function public.archive_lead(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.archive_lead(uuid,uuid,text,text,text) to service_role;

create or replace function public.archive_verified_lead_duplicates(
  p_actor_user_id uuid,
  p_actor_email text,
  p_actor_role text,
  p_snapshot_token text,
  p_expected_extra_leads integer
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path=pg_catalog,public
as $$
declare
  v_before jsonb;
  v_after jsonb;
  v_removed integer:=0;
begin
  v_before:=public.lead_duplicate_status();
  if coalesce(p_snapshot_token,'')<>coalesce(v_before->>'snapshot_token','')
     or coalesce(p_expected_extra_leads,-1)<>coalesce((v_before->>'extra_leads')::integer,-1) then
    return jsonb_build_object('ok',false,'error','duplicate_set_changed','status',v_before);
  end if;

  with scored as (
    select l.*,
      exists(select 1 from public.door_visits v where v.lead_id=l.id and v.status='active') as has_active_visit
    from public.leads l
    where l.deleted_at is null
      and upper(coalesce(l.source_system,'')) not like '%DEMO%'
      and split_part(l.normalized_address_key,'|',1)<>''
      and split_part(l.normalized_address_key,'|',3)<>''
      and split_part(l.normalized_address_key,'|',4)<>''
  ), ranked as (
    select s.*,
      count(*) over(partition by s.normalized_address_key) as copies,
      first_value(s.id) over(
        partition by s.normalized_address_key
        order by s.has_active_visit desc,coalesce(s.attempt_count,0) desc,s.last_activity_at desc nulls last,
          (s.assigned_rep_id is not null) desc,(s.assigned_manager_id is not null) desc,s.created_at asc,s.id asc
      ) as canonical_lead_id,
      row_number() over(
        partition by s.normalized_address_key
        order by s.has_active_visit desc,coalesce(s.attempt_count,0) desc,s.last_activity_at desc nulls last,
          (s.assigned_rep_id is not null) desc,(s.assigned_manager_id is not null) desc,s.created_at asc,s.id asc
      ) as duplicate_rank
    from scored s
  ), candidates as (
    select id,canonical_lead_id,normalized_address_key,to_jsonb(ranked)-'copies'-'canonical_lead_id'-'duplicate_rank'-'has_active_visit' as lead_snapshot
    from ranked
    where copies>1 and duplicate_rank>1 and not has_active_visit
  ), updated as (
    update public.leads l set
      deleted_at=clock_timestamp(),
      deleted_by_user_id=p_actor_user_id,
      deleted_by_email=lower(trim(p_actor_email)),
      deleted_by_role=lower(trim(p_actor_role)),
      deletion_reason='duplicate',
      duplicate_of_lead_id=c.canonical_lead_id
    from candidates c
    where l.id=c.id and l.deleted_at is null
    returning l.id,l.deleted_at,c.canonical_lead_id,c.normalized_address_key,c.lead_snapshot
  ), audited as (
    insert into public.lead_removal_audit(
      lead_id,canonical_lead_id,removed_at,removed_by_user_id,removed_by_email,removed_by_role,
      reason,normalized_address_key,lead_snapshot,metadata
    )
    select id,canonical_lead_id,deleted_at,p_actor_user_id,lower(trim(p_actor_email)),lower(trim(p_actor_role)),
      'duplicate',normalized_address_key,lead_snapshot,
      jsonb_build_object('soft_delete',true,'verified_duplicate',true,'all_user_control',true)
    from updated
    returning id
  )
  select count(*)::integer into v_removed from audited;

  v_after:=public.lead_duplicate_status();
  return jsonb_build_object(
    'ok',true,'removed',v_removed,'soft_delete',true,
    'remaining_duplicate_address_groups',v_after->'duplicate_address_groups',
    'remaining_extra_leads',v_after->'extra_leads',
    'blocked_by_active_visits',v_after->'blocked_by_active_visits'
  );
end;
$$;

revoke all on function public.archive_verified_lead_duplicates(uuid,text,text,text,integer) from public,anon,authenticated;
grant execute on function public.archive_verified_lead_duplicates(uuid,text,text,text,integer) to service_role;

-- A stale client must not be able to start work on an archived pin.
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

  select * into v_lead from public.leads where id=p_lead_id and deleted_at is null for update;
  if not found then raise exception 'lead_not_found_or_removed' using errcode='P0002'; end if;

  if p_latitude between -90 and 90 and p_longitude between -180 and 180 then v_latitude:=p_latitude;v_longitude:=p_longitude;v_gps_usable:=true; end if;
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
      return jsonb_build_object('ok',true,'duplicate',true,'visit_id',v_existing.id,'started_at',v_existing.arrived_at,
        'distance_meters',v_existing.arrival_distance_from_lead_meters,'lead_id',v_existing.lead_id,
        'lead_label',v_existing.service_address,'disposition_scope','all_leads',
        'door_location_verified',coalesce(v_existing.gps_verified_at_arrival,false),'door_location_coaching_only',true);
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

  update public.leads set attempt_count=attempt_count+1,last_activity_at=v_visit.arrived_at where id=p_lead_id and deleted_at is null;
  insert into public.test_events(
    session_id,event_type,lead_label,event_time,latitude,longitude,accuracy_meters,
    gps_fix_age_ms,lead_latitude,lead_longitude,distance_to_lead_meters,payload
  ) values (
    p_session_id,'door_arrival',v_label,v_visit.arrived_at,v_latitude,v_longitude,v_accuracy,
    case when v_captured_at is null then null else greatest(0,extract(epoch from(v_visit.arrived_at-v_captured_at))*1000)::integer end,
    v_lead.latitude,v_lead.longitude,v_distance,
    jsonb_build_object('server_generated',true,'visit_id',v_visit.id,'lead_id',p_lead_id,'selection_source',v_source,
      'door_location_authorization_required',false,'door_location_coaching_only',true,
      'door_location_verified',v_door_verified,'gps_fix_fresh',v_gps_fresh,
      'quarter_mile_coaching_threshold_meters',402.336,'disposition_scope','all_leads','lead_assignment_changed',false)
  );
  return jsonb_build_object('ok',true,'visit_id',v_visit.id,'started_at',v_visit.arrived_at,'distance_meters',v_distance,
    'lead_id',p_lead_id,'lead_label',v_label,'disposition_scope','all_leads',
    'door_location_verified',v_door_verified,'door_location_coaching_only',true);
end;
$$;

revoke all on function public.record_door_visit_start(uuid,uuid,text,double precision,double precision,double precision,timestamptz) from public,anon;
grant execute on function public.record_door_visit_start(uuid,uuid,text,double precision,double precision,double precision,timestamptz) to authenticated;

comment on table public.lead_removal_audit is
  'Private immutable audit of reversible lead-list removals, including actor, reason, canonical duplicate, and original lead snapshot.';
comment on function public.lead_duplicate_status() is
  'Service-only exact normalized-address duplicate verification; unit values remain distinct and active visits are reported as blocked.';
comment on function public.archive_lead(uuid,uuid,text,text,text) is
  'Service-only atomic soft delete used after an active McCoy field user confirms removal of one lead.';
comment on function public.archive_verified_lead_duplicates(uuid,text,text,text,integer) is
  'Service-only confirmed duplicate cleanup. Preserves the strongest canonical lead, blocks active visits, archives extras, and writes an audit row for every removal.';
