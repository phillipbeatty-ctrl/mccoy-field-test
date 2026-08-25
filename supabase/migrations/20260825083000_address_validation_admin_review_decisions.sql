create or replace function public.apply_address_validation_admin_review_decision(
  p_actor_user_id uuid,
  p_lead_id uuid,
  p_decision text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
set statement_timeout to '10s'
as $function$
declare
  v_lead public.leads%rowtype;
  v_now timestamptz := clock_timestamp();
  v_operation_key text;
  v_audit_id bigint;
  v_previous_latitude double precision;
  v_previous_longitude double precision;
  v_candidate_latitude double precision;
  v_candidate_longitude double precision;
begin
  if current_user not in ('postgres','service_role','supabase_admin') then
    raise exception 'service_role_required' using errcode='42501';
  end if;
  if p_actor_user_id is null or p_lead_id is null then
    raise exception 'actor_and_lead_required' using errcode='22023';
  end if;
  if p_decision not in ('keep_original','apply_google_candidate') then
    raise exception 'invalid_admin_review_decision' using errcode='22023';
  end if;

  select * into v_lead
  from public.leads
  where id=p_lead_id and deleted_at is null
  for update;

  if not found then
    raise exception 'lead_not_found' using errcode='P0002';
  end if;
  if lower(coalesce(v_lead.geocode_status,'')) in ('manual','field_verified','spotio_verified','field_gps')
     or lower(coalesce(v_lead.geocode_verification_status,'')) in ('manual_door_verified','field_verified') then
    raise exception 'field_confirmed_pin_protected' using errcode='42501';
  end if;
  if coalesce(v_lead.geocode_verification_status,'') <> 'address_validation_admin_review' then
    raise exception 'lead_not_pending_address_validation_admin_review' using errcode='55000';
  end if;

  v_previous_latitude := v_lead.latitude;
  v_previous_longitude := v_lead.longitude;
  v_candidate_latitude := v_lead.geocode_candidate_latitude;
  v_candidate_longitude := v_lead.geocode_candidate_longitude;
  if p_decision='apply_google_candidate' and (
    v_candidate_latitude is null or v_candidate_longitude is null
    or v_candidate_latitude not between -90 and 90
    or v_candidate_longitude not between -180 and 180
  ) then
    raise exception 'valid_google_candidate_required' using errcode='22023';
  end if;

  v_operation_key := 'admin-review:' || p_lead_id::text || ':' || coalesce(v_lead.geocode_verified_at::text,'none');
  insert into public.lead_geocode_verifications (
    lead_id,actor_user_id,provider,decision,previous_status,previous_latitude,previous_longitude,
    candidate_latitude,candidate_longitude,comparison_distance_meters,precision,address_match,details,operation_key
  ) values (
    v_lead.id,p_actor_user_id,'google_maps_address_validation_admin_review',
    case when p_decision='apply_google_candidate' then 'admin_approved_google_candidate' else 'admin_kept_original_pin' end,
    v_lead.geocode_status,v_previous_latitude,v_previous_longitude,v_candidate_latitude,v_candidate_longitude,
    v_lead.geocode_comparison_distance_meters,v_lead.geocode_precision,
    coalesce((v_lead.geocode_verification_details->>'address_identity_match')::boolean,false),
    coalesce(v_lead.geocode_verification_details,'{}'::jsonb) || jsonb_build_object('admin_review_decision',p_decision,'reviewed_at',v_now),
    v_operation_key
  ) on conflict (operation_key) where operation_key is not null do nothing
  returning id into v_audit_id;

  if v_audit_id is null then
    return jsonb_build_object('ok',true,'idempotent',true,'lead_id',p_lead_id,'decision',p_decision);
  end if;

  if p_decision='apply_google_candidate' then
    update public.leads
    set latitude=v_candidate_latitude,
        longitude=v_candidate_longitude,
        geocode_status='google_address_validation',
        geocode_provider='google_maps_address_validation',
        geocode_verification_status='google_address_validation_admin_approved',
        geocode_verified_at=v_now,
        geocode_verification_details=coalesce(geocode_verification_details,'{}'::jsonb) || jsonb_build_object('admin_review_decision',p_decision,'admin_reviewed_at',v_now)
    where id=p_lead_id;
  else
    update public.leads
    set geocode_verification_status='address_validation_admin_kept_original',
        geocode_verified_at=v_now,
        geocode_verification_details=coalesce(geocode_verification_details,'{}'::jsonb) || jsonb_build_object('admin_review_decision',p_decision,'admin_reviewed_at',v_now)
    where id=p_lead_id;
  end if;

  return jsonb_build_object(
    'ok',true,
    'idempotent',false,
    'lead_id',p_lead_id,
    'decision',p_decision,
    'previous_latitude',v_previous_latitude,
    'previous_longitude',v_previous_longitude,
    'candidate_latitude',v_candidate_latitude,
    'candidate_longitude',v_candidate_longitude
  );
end;
$function$;

revoke all on function public.apply_address_validation_admin_review_decision(uuid,uuid,text)
  from public,anon,authenticated;
grant execute on function public.apply_address_validation_admin_review_decision(uuid,uuid,text)
  to service_role;

comment on function public.apply_address_validation_admin_review_decision(uuid,uuid,text) is
  'Service-role-only one-lead Admin decision for quarantined Google Address Validation candidates. Protects manual/field-confirmed pins and requires pending admin-review status.';
