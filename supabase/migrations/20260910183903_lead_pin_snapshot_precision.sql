-- Keep the exact-coordinate concurrency contract in move_lead_pin. With
-- extra_float_digits=0, ordinary table JSON rounds float8 to 15 digits and can
-- make a freshly loaded snapshot look stale. Construct JSONB at full precision
-- inside this function so later PostgREST/JavaScript serialization stays exact.
create or replace function public.get_lead_pin_snapshot(
  p_lead_id uuid,
  p_organization_id uuid
) returns jsonb
language sql
stable
security invoker
set search_path = pg_catalog, public
set extra_float_digits = 3
as $$
  select jsonb_build_object(
    'id', l.id,
    'latitude', l.latitude,
    'longitude', l.longitude,
    'pin_location_updated_at', l.pin_location_updated_at,
    'assigned_rep_id', l.assigned_rep_id,
    'assigned_manager_id', l.assigned_manager_id
  )
  from public.leads l
  where l.id = p_lead_id
    and l.organization_id = p_organization_id
    and l.deleted_at is null;
$$;

-- Only the authenticated, organization/assignment-scoped Edge handler calls
-- this RPC. It grants no direct client access and changes no mutation checks.
revoke all on function public.get_lead_pin_snapshot(uuid,uuid) from public, anon, authenticated;
grant execute on function public.get_lead_pin_snapshot(uuid,uuid) to service_role;
