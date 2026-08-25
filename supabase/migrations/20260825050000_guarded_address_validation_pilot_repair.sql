-- Apply only strict Address Validation ACCEPT results from the confirmed
-- 100-lead pilot. Google calls happen before this short transaction. Every
-- applied, reviewed, protected, or stale decision receives an immutable audit.

alter table public.lead_geocode_verifications
  add column if not exists operation_key text;

create unique index if not exists lead_geocode_verifications_operation_key_idx
  on public.lead_geocode_verifications (operation_key)
  where operation_key is not null;

create or replace function public.apply_address_validation_pilot_repair(
  p_actor_user_id uuid,
  p_snapshot_token text,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
set statement_timeout to '15s'
as $function$
declare
  v_item jsonb;
  v_lead public.leads%rowtype;
  v_lead_id uuid;
  v_decision text;
  v_reason text;
  v_operation_key text;
  v_audit_id bigint;
  v_distance double precision;
  v_candidate_latitude double precision;
  v_candidate_longitude double precision;
  v_expected_latitude double precision;
  v_expected_longitude double precision;
  v_expected_verified_at timestamptz;
  v_apply boolean;
  v_applied integer := 0;
  v_review integer := 0;
  v_protected integer := 0;
  v_stale integer := 0;
  v_idempotent integer := 0;
  v_now timestamptz := clock_timestamp();
begin
  if current_user not in ('postgres','service_role','supabase_admin') then
    raise exception 'service_role_required' using errcode='42501';
  end if;
  if p_actor_user_id is null then
    raise exception 'actor_user_id_required' using errcode='22023';
  end if;
  if p_snapshot_token !~ '^[a-f0-9]{64}$' then
    raise exception 'valid_snapshot_token_required' using errcode='22023';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) <> 100 then
    raise exception 'repair_requires_exactly_100_rows' using errcode='22023';
  end if;

  for v_item in select value from jsonb_array_elements(p_rows)
  loop
    begin
      v_lead_id := nullif(v_item->>'lead_id','')::uuid;
      v_candidate_latitude := nullif(v_item->>'google_latitude','')::double precision;
      v_candidate_longitude := nullif(v_item->>'google_longitude','')::double precision;
      v_distance := nullif(v_item->>'old_to_google_meters','')::double precision;
      v_expected_latitude := nullif(v_item->>'old_latitude','')::double precision;
      v_expected_longitude := nullif(v_item->>'old_longitude','')::double precision;
      v_expected_verified_at := nullif(v_item->>'expected_geocode_verified_at','')::timestamptz;
    exception when others then
      raise exception 'invalid_repair_row' using errcode='22023';
    end;

    select * into v_lead
    from public.leads
    where id=v_lead_id and deleted_at is null
    for update;

    v_decision := coalesce(v_item->>'repair_decision','admin_review_quality');
    v_reason := coalesce(v_item->>'repair_reason','strict_repair_rule_not_met');
    if not found then
      v_decision := 'stale_or_missing_lead';
      v_reason := 'lead_missing_or_archived_before_repair';
      v_stale := v_stale + 1;
      continue;
    end if;

    if lower(coalesce(v_lead.geocode_status,'')) in ('manual','field_verified','spotio_verified','field_gps')
       or lower(coalesce(v_lead.geocode_verification_status,'')) in ('manual_door_verified','field_verified') then
      v_decision := 'protected_field_confirmed';
      v_reason := 'manual_or_field_verified_coordinate_is_never_overwritten';
      v_protected := v_protected + 1;
    elsif coalesce(v_lead.address1,'') <> coalesce(v_item->>'expected_address1','')
       or coalesce(v_lead.address2,'') <> coalesce(v_item->>'expected_address2','')
       or coalesce(v_lead.city,'') <> coalesce(v_item->>'expected_city','')
       or coalesce(v_lead.state,'') <> coalesce(v_item->>'expected_state','')
       or coalesce(v_lead.zip,'') <> coalesce(v_item->>'expected_zip','')
       or v_lead.latitude is distinct from v_expected_latitude
       or v_lead.longitude is distinct from v_expected_longitude
       or coalesce(v_lead.geocode_status,'') <> coalesce(v_item->>'expected_geocode_status','')
       or coalesce(v_lead.geocode_verification_status,'') <> coalesce(v_item->>'expected_geocode_verification_status','')
       or v_lead.geocode_verified_at is distinct from v_expected_verified_at then
      v_decision := 'stale_pilot_row';
      v_reason := 'lead_changed_after_pilot_snapshot';
      v_stale := v_stale + 1;
    end if;

    v_apply := coalesce(v_decision='apply_google_address_validation'
      and coalesce((v_item->>'automatic_repair_eligible')::boolean,false)
      and v_item->>'api_status'='validated'
      and v_item->>'possible_next_action'='ACCEPT'
      and coalesce((v_item->>'address_complete')::boolean,false)
      and upper(coalesce(v_item->>'validation_granularity','')) in ('PREMISE','SUB_PREMISE')
      and upper(coalesce(v_item->>'geocode_granularity','')) in ('PREMISE','SUB_PREMISE')
      and upper(coalesce(v_item->>'usps_dpv_confirmation',''))='Y'
      and coalesce((v_item->>'address_identity_match')::boolean,false)
      and not coalesce((v_item->>'has_unconfirmed_components')::boolean,false)
      and not coalesce((v_item->>'has_inferred_components')::boolean,false)
      and not coalesce((v_item->>'has_replaced_components')::boolean,false)
      and not coalesce((v_item->>'has_spell_corrected_components')::boolean,false)
      and coalesce((v_item->>'unresolved_token_count')::integer,0)=0
      and jsonb_typeof(v_item->'missing_component_types')='array'
      and jsonb_array_length(v_item->'missing_component_types')=0
      and nullif(v_item->>'place_id','') is not null
      and v_candidate_latitude between -90 and 90
      and v_candidate_longitude between -180 and 180
      and v_distance between 0 and 100
      and v_item->>'field_confirmed_latitude' is null
      and v_item->>'field_confirmed_longitude' is null,false);

    if v_decision not in ('protected_field_confirmed','stale_pilot_row') and v_distance > 100 then
      v_decision := 'admin_review_large_movement';
      v_reason := 'google_location_is_more_than_100_meters_from_old_pin';
      v_apply := false;
    elsif v_decision='apply_google_address_validation' and not v_apply then
      v_decision := 'admin_review_quality';
      v_reason := 'database_strict_accept_rule_rejected_application';
    elsif v_decision not in (
      'apply_google_address_validation','admin_review_large_movement','admin_review_quality',
      'admin_review_address_identity','admin_review_missing_location','protected_field_confirmed',
      'stale_pilot_row'
    ) then
      v_decision := 'admin_review_quality';
      v_reason := 'unknown_repair_decision_rejected';
      v_apply := false;
    end if;

    v_operation_key := p_snapshot_token || ':' || v_lead.id::text;
    v_audit_id := null;
    insert into public.lead_geocode_verifications (
      lead_id,actor_user_id,provider,decision,previous_status,previous_latitude,previous_longitude,
      candidate_latitude,candidate_longitude,comparison_distance_meters,precision,address_match,details,operation_key
    ) values (
      v_lead.id,p_actor_user_id,'google_maps_address_validation',v_decision,v_lead.geocode_status,
      v_lead.latitude,v_lead.longitude,v_candidate_latitude,v_candidate_longitude,v_distance,
      v_item->>'geocode_granularity',coalesce((v_item->>'address_identity_match')::boolean,false),
      v_item || jsonb_build_object('repair_reason',v_reason,'pilot_snapshot_token',p_snapshot_token),v_operation_key
    )
    on conflict (operation_key) where operation_key is not null do nothing
    returning id into v_audit_id;

    if v_audit_id is null then
      v_idempotent := v_idempotent + 1;
      continue;
    end if;

    if v_apply then
      update public.leads
      set latitude=v_candidate_latitude,
          longitude=v_candidate_longitude,
          geocode_status='google_address_validation',
          geocode_provider='google_maps_address_validation',
          geocode_precision=v_item->>'geocode_granularity',
          geocode_formatted_address=v_item->>'standardized_address',
          geocode_place_id=v_item->>'place_id',
          geocode_verified_at=v_now,
          geocode_verification_status='google_address_validation_applied',
          geocode_comparison_distance_meters=v_distance,
          geocode_candidate_latitude=v_candidate_latitude,
          geocode_candidate_longitude=v_candidate_longitude,
          geocode_verification_details=v_item || jsonb_build_object('repair_reason',v_reason,'pilot_snapshot_token',p_snapshot_token),
          geocode_attempted_at=v_now,
          geocode_verification_claimed_at=null,
          geocode_verification_claimed_by=null
      where id=v_lead.id;
      v_applied := v_applied + 1;
    elsif v_decision not in ('protected_field_confirmed','stale_pilot_row') then
      update public.leads
      set geocode_provider='google_maps_address_validation',
          geocode_precision=v_item->>'geocode_granularity',
          geocode_formatted_address=v_item->>'standardized_address',
          geocode_place_id=v_item->>'place_id',
          geocode_verified_at=v_now,
          geocode_verification_status='address_validation_admin_review',
          geocode_comparison_distance_meters=v_distance,
          geocode_candidate_latitude=v_candidate_latitude,
          geocode_candidate_longitude=v_candidate_longitude,
          geocode_verification_details=v_item || jsonb_build_object('repair_reason',v_reason,'pilot_snapshot_token',p_snapshot_token),
          geocode_attempted_at=v_now,
          geocode_verification_claimed_at=null,
          geocode_verification_claimed_by=null
      where id=v_lead.id;
      v_review := v_review + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'processed',jsonb_array_length(p_rows),
    'applied',v_applied,
    'admin_review',v_review,
    'protected',v_protected,
    'stale',v_stale,
    'idempotent',v_idempotent,
    'snapshot_token',p_snapshot_token
  );
end;
$function$;

revoke all on function public.apply_address_validation_pilot_repair(uuid,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.apply_address_validation_pilot_repair(uuid,text,jsonb)
  to service_role;

comment on function public.apply_address_validation_pilot_repair(uuid,text,jsonb) is
  'Service-role-only atomic repair for one confirmed 100-lead Address Validation pilot. Applies strict <=100m ACCEPT results and preserves all other pins for Admin review.';
