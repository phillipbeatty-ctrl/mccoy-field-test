alter table public.leads
  add column if not exists pin_location_updated_at timestamptz not null default clock_timestamp();

create table if not exists private.lead_pin_move_audit (
  id uuid primary key default gen_random_uuid(),
  client_request_id uuid not null unique,
  lead_id uuid not null references public.leads(id),
  organization_id uuid,
  actor_user_id uuid not null,
  actor_email text not null,
  actor_role text not null,
  authorization_basis text,
  decision text not null check (decision in ('accepted','review_required','rejected')),
  reason text,
  old_latitude double precision,
  old_longitude double precision,
  proposed_latitude double precision not null,
  proposed_longitude double precision not null,
  saved_latitude double precision,
  saved_longitude double precision,
  actor_latitude double precision,
  actor_longitude double precision,
  actor_accuracy_meters double precision,
  gps_captured_at timestamptz,
  moved_distance_meters double precision,
  actor_distance_meters double precision,
  assignment_snapshot jsonb not null default '{}'::jsonb,
  client_context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp()
);

create index if not exists lead_pin_move_audit_lead_created_idx
  on private.lead_pin_move_audit (lead_id, created_at desc);

revoke all on private.lead_pin_move_audit from public, anon, authenticated;
grant usage on schema private to service_role;
grant select, insert on private.lead_pin_move_audit to service_role;

create or replace function public.move_lead_pin(
  p_lead_id uuid,
  p_actor_user_id uuid,
  p_actor_email text,
  p_expected_updated_at timestamptz,
  p_original_latitude double precision,
  p_original_longitude double precision,
  p_proposed_latitude double precision,
  p_proposed_longitude double precision,
  p_actor_latitude double precision,
  p_actor_longitude double precision,
  p_actor_accuracy_meters double precision,
  p_gps_captured_at timestamptz,
  p_client_request_id uuid,
  p_client_context jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, private
as $$
declare
  v_access public.app_user_access%rowtype;
  v_lead public.leads%rowtype;
  v_role text;
  v_basis text;
  v_authorized boolean := false;
  v_gps_required boolean := true;
  v_decision text := 'accepted';
  v_reason text := 'field_confirmed';
  v_moved double precision;
  v_actor_distance double precision;
  v_assignment jsonb;
  v_existing jsonb;
  v_saved public.leads%rowtype;
begin
  if p_client_request_id is null then
    return jsonb_build_object('ok',false,'error','client_request_id_required');
  end if;

  select jsonb_build_object(
    'ok', decision <> 'rejected',
    'decision', decision,
    'reason', reason,
    'audit_id', id,
    'duplicate', true,
    'lead', jsonb_build_object('id',lead_id,'latitude',saved_latitude,'longitude',saved_longitude)
  ) into v_existing
  from private.lead_pin_move_audit
  where client_request_id = p_client_request_id;
  if v_existing is not null then return v_existing; end if;

  if p_proposed_latitude is null or p_proposed_longitude is null
     or p_proposed_latitude not between -90 and 90
     or p_proposed_longitude not between -180 and 180 then
    return jsonb_build_object('ok',false,'error','invalid_coordinates');
  end if;

  select * into v_access
  from public.app_user_access
  where lower(email) = lower(trim(p_actor_email)) and active = true;
  if not found then return jsonb_build_object('ok',false,'error','inactive_account'); end if;

  select * into v_lead from public.leads where id = p_lead_id for update;
  if not found or v_lead.deleted_at is not null then
    return jsonb_build_object('ok',false,'error','lead_not_found');
  end if;

  v_role := lower(coalesce(v_access.role,''));
  v_assignment := jsonb_build_object(
    'assigned_rep_id',v_lead.assigned_rep_id,
    'assigned_manager_id',v_lead.assigned_manager_id,
    'assigned_admin_email',v_lead.assigned_admin_email,
    'actor_team',v_access.team_name
  );

  if v_role = 'admin' then
    v_authorized := true; v_basis := 'admin'; v_gps_required := false;
  elsif v_role in ('manager','trainer') and v_lead.assigned_manager_id = p_actor_user_id then
    v_authorized := true; v_basis := v_role || '_controlled';
  elsif v_role = 'rep' and v_lead.assigned_rep_id = p_actor_user_id then
    v_authorized := true; v_basis := 'rep_assigned';
  end if;
  if v_lead.organization_id is distinct from v_access.organization_id then
    v_authorized := false; v_basis := null;
  end if;

  if not v_authorized then
    insert into private.lead_pin_move_audit(
      client_request_id,lead_id,organization_id,actor_user_id,actor_email,actor_role,
      decision,reason,old_latitude,old_longitude,proposed_latitude,proposed_longitude,
      actor_latitude,actor_longitude,actor_accuracy_meters,gps_captured_at,assignment_snapshot,client_context
    ) values (
      p_client_request_id,p_lead_id,v_access.organization_id,p_actor_user_id,lower(p_actor_email),v_role,
      'rejected','unauthorized_lead',v_lead.latitude,v_lead.longitude,p_proposed_latitude,p_proposed_longitude,
      p_actor_latitude,p_actor_longitude,p_actor_accuracy_meters,p_gps_captured_at,v_assignment,coalesce(p_client_context,'{}'::jsonb)
    );
    return jsonb_build_object('ok',false,'error','unauthorized_lead');
  end if;

  if p_expected_updated_at is null or v_lead.pin_location_updated_at is distinct from p_expected_updated_at
     or v_lead.latitude is distinct from p_original_latitude
     or v_lead.longitude is distinct from p_original_longitude then
    insert into private.lead_pin_move_audit(
      client_request_id,lead_id,organization_id,actor_user_id,actor_email,actor_role,authorization_basis,
      decision,reason,old_latitude,old_longitude,proposed_latitude,proposed_longitude,
      actor_latitude,actor_longitude,actor_accuracy_meters,gps_captured_at,assignment_snapshot,client_context
    ) values (
      p_client_request_id,p_lead_id,v_access.organization_id,p_actor_user_id,lower(p_actor_email),v_role,v_basis,
      'rejected','stale_lead',v_lead.latitude,v_lead.longitude,p_proposed_latitude,p_proposed_longitude,
      p_actor_latitude,p_actor_longitude,p_actor_accuracy_meters,p_gps_captured_at,v_assignment,coalesce(p_client_context,'{}'::jsonb)
    );
    return jsonb_build_object('ok',false,'error','stale_lead');
  end if;

  if v_gps_required and (
    p_actor_latitude is null or p_actor_longitude is null or p_actor_accuracy_meters is null
    or p_gps_captured_at is null or p_gps_captured_at < clock_timestamp() - interval '30 seconds'
    or p_gps_captured_at > clock_timestamp() + interval '5 seconds'
  ) then
    return jsonb_build_object('ok',false,'error','fresh_gps_required');
  end if;

  if (p_actor_latitude is not null and p_actor_latitude not between -90 and 90)
     or (p_actor_longitude is not null and p_actor_longitude not between -180 and 180) then
    return jsonb_build_object('ok',false,'error','invalid_actor_coordinates');
  end if;
  if p_actor_accuracy_meters is not null and (p_actor_accuracy_meters < 0 or p_actor_accuracy_meters > 100000) then
    return jsonb_build_object('ok',false,'error','invalid_gps_accuracy');
  end if;

  if v_lead.latitude is not null and v_lead.longitude is not null then
    v_moved := private.mccoy_distance_meters(v_lead.latitude,v_lead.longitude,p_proposed_latitude,p_proposed_longitude);
  end if;
  if p_actor_latitude is not null and p_actor_longitude is not null then
    v_actor_distance := private.mccoy_distance_meters(p_actor_latitude,p_actor_longitude,p_proposed_latitude,p_proposed_longitude);
  end if;

  if v_role = 'admin' and p_gps_captured_at is null then
    v_decision := 'review_required'; v_reason := 'admin_remote_correction';
  elsif coalesce(p_actor_accuracy_meters,1e9) > 35 or coalesce(v_actor_distance,1e9) > 75 then
    v_decision := 'review_required'; v_reason := 'gps_distance_or_accuracy_review';
  end if;

  update public.leads set
    latitude = p_proposed_latitude,
    longitude = p_proposed_longitude,
    geocode_status = case when v_decision='accepted' then 'field_verified' else 'manual_review' end,
    geocode_provider = 'manual_move_pin',
    geocode_precision = 'door_manual',
    geocode_verification_status = case when v_decision='accepted' then 'manual_door_verified' else 'manual_review_required' end,
    geocode_verified_at = case when v_decision='accepted' then clock_timestamp() else null end,
    geocode_attempted_at = clock_timestamp(),
    geocode_verification_details = jsonb_build_object(
      'reason',v_reason,'audit_request_id',p_client_request_id,
      'moved_distance_meters',v_moved,'actor_distance_meters',v_actor_distance,
      'actor_accuracy_meters',p_actor_accuracy_meters
    ),
    pin_location_updated_at = clock_timestamp()
  where id = p_lead_id
  returning * into v_saved;

  insert into private.lead_pin_move_audit(
    client_request_id,lead_id,organization_id,actor_user_id,actor_email,actor_role,authorization_basis,
    decision,reason,old_latitude,old_longitude,proposed_latitude,proposed_longitude,saved_latitude,saved_longitude,
    actor_latitude,actor_longitude,actor_accuracy_meters,gps_captured_at,moved_distance_meters,actor_distance_meters,
    assignment_snapshot,client_context
  ) values (
    p_client_request_id,p_lead_id,v_access.organization_id,p_actor_user_id,lower(p_actor_email),v_role,v_basis,
    v_decision,v_reason,v_lead.latitude,v_lead.longitude,p_proposed_latitude,p_proposed_longitude,v_saved.latitude,v_saved.longitude,
    p_actor_latitude,p_actor_longitude,p_actor_accuracy_meters,p_gps_captured_at,v_moved,v_actor_distance,
    v_assignment,coalesce(p_client_context,'{}'::jsonb)
  );

  return jsonb_build_object(
    'ok',true,'decision',v_decision,'reason',v_reason,
    'moved_distance_meters',v_moved,'actor_distance_meters',v_actor_distance,
    'lead',jsonb_build_object(
      'id',v_saved.id,'latitude',v_saved.latitude,'longitude',v_saved.longitude,
      'updated_at',v_saved.pin_location_updated_at,'geocode_status',v_saved.geocode_status,
      'geocode_provider',v_saved.geocode_provider,'geocode_precision',v_saved.geocode_precision,
      'geocode_verification_status',v_saved.geocode_verification_status
    )
  );
end;
$$;

revoke all on function public.move_lead_pin(uuid,uuid,text,timestamptz,double precision,double precision,double precision,double precision,double precision,double precision,double precision,timestamptz,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.move_lead_pin(uuid,uuid,text,timestamptz,double precision,double precision,double precision,double precision,double precision,double precision,double precision,timestamptz,uuid,jsonb) to service_role;
