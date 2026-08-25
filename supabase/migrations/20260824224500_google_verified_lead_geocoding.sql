-- Use Google as a second-source verifier for Lead Pool pin placement.
-- Approximate centroid pins are quarantined; no existing manual/imported pin is
-- silently replaced unless Google returns an exact, matching ROOFTOP result.

alter table public.leads
  add column if not exists geocode_provider text,
  add column if not exists geocode_precision text,
  add column if not exists geocode_formatted_address text,
  add column if not exists geocode_place_id text,
  add column if not exists geocode_verified_at timestamptz,
  add column if not exists geocode_verification_status text,
  add column if not exists geocode_comparison_distance_meters double precision,
  add column if not exists geocode_candidate_latitude double precision,
  add column if not exists geocode_candidate_longitude double precision,
  add column if not exists geocode_verification_details jsonb not null default '{}'::jsonb,
  add column if not exists geocode_verification_claimed_at timestamptz,
  add column if not exists geocode_verification_claimed_by uuid;

create table if not exists public.lead_geocode_verifications (
  id bigint generated always as identity primary key,
  lead_id uuid not null references public.leads(id) on delete cascade,
  actor_user_id uuid,
  provider text not null,
  decision text not null,
  previous_status text,
  previous_latitude double precision,
  previous_longitude double precision,
  candidate_latitude double precision,
  candidate_longitude double precision,
  comparison_distance_meters double precision,
  precision text,
  address_match boolean,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp()
);

alter table public.lead_geocode_verifications enable row level security;
revoke all on public.lead_geocode_verifications from public, anon, authenticated;
grant select, insert on public.lead_geocode_verifications to service_role;
grant usage, select on sequence public.lead_geocode_verifications_id_seq to service_role;

create index if not exists lead_geocode_verifications_lead_created_idx
  on public.lead_geocode_verifications (lead_id, created_at desc);

create index if not exists leads_google_verification_queue_idx
  on public.leads (geocode_verification_status, geocode_verification_claimed_at, id)
  where deleted_at is null;

update public.leads
set geocode_provider=case
      when lower(coalesce(geocode_status,''))='google_mymaps' then 'google_mymaps'
      when lower(coalesce(geocode_status,'')) in ('manual','field_verified','spotio_verified','field_gps') then 'manual_or_field'
      when lower(coalesce(geocode_status,'')) in ('matched','approx_city','approx_zip','approx_street','unmatched') then 'census'
      else coalesce(geocode_provider,'legacy')
    end,
    geocode_verification_status=case
      when lower(coalesce(geocode_status,''))='google_rooftop' then 'google_rooftop_applied'
      when lower(coalesce(geocode_status,'')) in ('manual','field_verified','spotio_verified','rooftop','parcel') then 'trusted_pending_google_comparison'
      else 'pending_google'
    end
where geocode_provider is null or geocode_verification_status is null;

insert into public.lead_geocode_verifications (
  lead_id, provider, decision, previous_status, previous_latitude, previous_longitude, details
)
select id, 'legacy_centroid', 'quarantined_approximate_pin', geocode_status, latitude, longitude,
  jsonb_build_object('reason','ZIP/city/street centroid is not a property-level coordinate')
from public.leads
where deleted_at is null
  and lower(coalesce(geocode_status,'')) in ('approx_city','approx_zip','approx_street')
  and latitude is not null and longitude is not null
  and not exists (
    select 1 from public.lead_geocode_verifications audit
    where audit.lead_id=leads.id and audit.decision='quarantined_approximate_pin'
  );

update public.leads
set latitude=null,
    longitude=null,
    geocode_verification_status='pending_google',
    geocode_verification_details=coalesce(geocode_verification_details,'{}'::jsonb)
      || jsonb_build_object('quarantined_reason','approximate centroid is not safe for Lead Pool placement')
where deleted_at is null
  and lower(coalesce(geocode_status,'')) in ('approx_city','approx_zip','approx_street');

create or replace function public.claim_leads_for_google_verification(
  p_batch_ids uuid[], p_limit integer, p_actor_user_id uuid
)
returns setof public.leads
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $function$
begin
  if current_user not in ('postgres','service_role','supabase_admin') then
    raise exception 'service_role_required' using errcode='42501';
  end if;
  return query
  with candidates as (
    select l.id
    from public.leads l
    where l.deleted_at is null
      and (
        (coalesce(cardinality(p_batch_ids),0)>0 and l.import_batch_id=any(p_batch_ids))
        or upper(coalesce(l.source_system,''))='FIELD_ENTRY'
      )
      and (
        l.geocode_verification_status is null
        or l.geocode_verification_status in (
          'pending_google','trusted_pending_google_comparison','google_api_error','google_in_progress'
        )
      )
      and (
        l.geocode_verification_status<>'google_in_progress'
        or l.geocode_verification_claimed_at<clock_timestamp()-interval '15 minutes'
      )
    order by
      case lower(coalesce(l.geocode_status,''))
        when 'approx_city' then 0 when 'approx_zip' then 0 when 'approx_street' then 0
        when 'unmatched' then 1 when 'pending_google' then 1 when 'matched' then 2
        when 'google_mymaps' then 3 else 4 end,
      l.id
    for update skip locked
    limit least(greatest(coalesce(p_limit,25),1),25)
  )
  update public.leads l
  set geocode_verification_status='google_in_progress',
      geocode_verification_claimed_at=clock_timestamp(),
      geocode_verification_claimed_by=p_actor_user_id
  from candidates c
  where l.id=c.id
  returning l.*;
end;
$function$;

revoke all on function public.claim_leads_for_google_verification(uuid[],integer,uuid) from public,anon,authenticated;
grant execute on function public.claim_leads_for_google_verification(uuid[],integer,uuid) to service_role;

create or replace function public.apply_google_geocode_decision(
  p_lead_id uuid,
  p_actor_user_id uuid,
  p_provider text,
  p_precision text,
  p_formatted_address text,
  p_place_id text,
  p_decision text,
  p_comparison_distance_meters double precision,
  p_details jsonb,
  p_candidate_latitude double precision,
  p_candidate_longitude double precision,
  p_apply_coordinates boolean,
  p_clear_coordinates boolean,
  p_address_update jsonb default '{}'::jsonb
)
returns public.leads
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $function$
declare
  v_lead public.leads%rowtype;
  v_now timestamptz:=clock_timestamp();
  v_address_changed boolean:=coalesce(p_address_update,'{}'::jsonb)<>'{}'::jsonb;
begin
  if current_user not in ('postgres','service_role','supabase_admin') then
    raise exception 'service_role_required' using errcode='42501';
  end if;
  select * into v_lead from public.leads where id=p_lead_id and deleted_at is null for update;
  if not found then raise exception 'lead_not_found' using errcode='P0002'; end if;
  if v_lead.geocode_verification_status<>'google_in_progress'
     or v_lead.geocode_verification_claimed_by is distinct from p_actor_user_id then
    raise exception 'google_verification_claim_required' using errcode='40001';
  end if;
  if p_apply_coordinates and (
    p_decision<>'google_rooftop_applied' or upper(coalesce(p_precision,''))<>'ROOFTOP'
    or p_candidate_latitude not between -90 and 90 or p_candidate_longitude not between -180 and 180
    or coalesce((p_details->>'address_match')::boolean,false) is not true
  ) then
    raise exception 'unsafe_google_coordinate_application' using errcode='22023';
  end if;

  insert into public.lead_geocode_verifications (
    lead_id,actor_user_id,provider,decision,previous_status,previous_latitude,previous_longitude,
    candidate_latitude,candidate_longitude,comparison_distance_meters,precision,address_match,details
  ) values (
    v_lead.id,p_actor_user_id,p_provider,p_decision,v_lead.geocode_status,v_lead.latitude,v_lead.longitude,
    p_candidate_latitude,p_candidate_longitude,p_comparison_distance_meters,p_precision,
    coalesce((p_details->>'address_match')::boolean,false),coalesce(p_details,'{}'::jsonb)
  );

  update public.leads
  set address1=case when v_address_changed then trim(coalesce(p_address_update->>'address1','')) else address1 end,
      address2=case when v_address_changed then nullif(trim(coalesce(p_address_update->>'address2','')),'') else address2 end,
      city=case when v_address_changed then trim(coalesce(p_address_update->>'city','')) else city end,
      state=case when v_address_changed then upper(trim(coalesce(p_address_update->>'state',''))) else state end,
      zip=case when v_address_changed then trim(coalesce(p_address_update->>'zip','')) else zip end,
      latitude=case when p_apply_coordinates then p_candidate_latitude when p_clear_coordinates or (v_address_changed and not p_apply_coordinates) then null else latitude end,
      longitude=case when p_apply_coordinates then p_candidate_longitude when p_clear_coordinates or (v_address_changed and not p_apply_coordinates) then null else longitude end,
      geocode_status=case when p_apply_coordinates then 'google_rooftop' when p_clear_coordinates or (v_address_changed and not p_apply_coordinates) then p_decision else geocode_status end,
      geocode_provider=p_provider,
      geocode_precision=p_precision,
      geocode_formatted_address=p_formatted_address,
      geocode_place_id=p_place_id,
      geocode_verified_at=v_now,
      geocode_verification_status=p_decision,
      geocode_comparison_distance_meters=p_comparison_distance_meters,
      geocode_candidate_latitude=p_candidate_latitude,
      geocode_candidate_longitude=p_candidate_longitude,
      geocode_verification_details=coalesce(p_details,'{}'::jsonb),
      geocode_attempted_at=v_now,
      geocode_verification_claimed_at=null,
      geocode_verification_claimed_by=null
  where id=v_lead.id
  returning * into v_lead;
  return v_lead;
end;
$function$;

revoke all on function public.apply_google_geocode_decision(uuid,uuid,text,text,text,text,text,double precision,jsonb,double precision,double precision,boolean,boolean,jsonb) from public,anon,authenticated;
grant execute on function public.apply_google_geocode_decision(uuid,uuid,text,text,text,text,text,double precision,jsonb,double precision,double precision,boolean,boolean,jsonb) to service_role;

-- Door verification means a deliberately placed door coordinate, not merely a
-- geocoder's address point. This remains coaching-only and never gates work.
do $migration$
declare
  v_oid oid;
  v_definition text;
  v_repaired text;
  v_old text := '''verified'',''exact'',''matched'',''google_mymaps'',''field_gps'',''rooftop'',''parcel'',''address'',''manual'',''field_verified'',''spotio_verified''';
  v_new text := '''manual'',''field_verified''';
begin
  for v_oid in
    select p.oid
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('record_door_visit_start','record_door_visit_completion')
  loop
    v_definition:=pg_get_functiondef(v_oid);
    v_repaired:=replace(v_definition,v_old,v_new);
    if v_repaired=v_definition then
      raise exception 'door_verification_status_guard_not_found_for_%',v_oid::regprocedure;
    end if;
    execute v_repaired;
  end loop;
end;
$migration$;

comment on table public.lead_geocode_verifications is
  'Server-only audit of Google Maps geocoding comparisons and pin-placement decisions.';
comment on column public.leads.geocode_verification_status is
  'Decision state for Google second-source pin verification; distinct from door-location coaching.';
