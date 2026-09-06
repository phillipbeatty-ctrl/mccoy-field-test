-- Exercises the existing RPC as service_role, then deliberately aborts.
-- The PASS exception rolls back both pin updates and audit rows.
DO $verify$
DECLARE
  actor record;
  original public.leads%rowtype;
  moved jsonb;
  stale jsonb;
  request_id uuid := gen_random_uuid();
  proposed_lat double precision;
BEGIN
  EXECUTE 'SET LOCAL ROLE service_role';
  PERFORM set_config('lock_timeout','2s',true);
  PERFORM set_config('statement_timeout','10s',true);
  SELECT u.id,u.email,u.organization_id INTO actor
    FROM public.users u JOIN public.app_user_access a
      ON lower(a.email)=lower(u.email) AND a.organization_id=u.organization_id
    WHERE a.active AND u.active AND lower(a.role)='admin'
      AND EXISTS (SELECT 1 FROM public.leads l WHERE l.organization_id=u.organization_id AND l.deleted_at IS NULL AND l.latitude IS NOT NULL AND l.longitude IS NOT NULL)
    ORDER BY u.id LIMIT 1;
  IF actor.id IS NULL THEN RAISE EXCEPTION 'MOVE_PIN_ROLLBACK_FAIL: no active Admin fixture'; END IF;
  SELECT * INTO original FROM public.leads
    WHERE organization_id=actor.organization_id AND deleted_at IS NULL
      AND latitude BETWEEN -89 AND 89 AND longitude BETWEEN -179 AND 179
    ORDER BY id LIMIT 1 FOR UPDATE;
  IF original.id IS NULL THEN RAISE EXCEPTION 'MOVE_PIN_ROLLBACK_FAIL: no bounded pin fixture'; END IF;
  proposed_lat := original.latitude + 0.00001;
  moved := public.move_lead_pin(
    original.id,actor.id,actor.email,original.pin_location_updated_at,
    original.latitude,original.longitude,proposed_lat,original.longitude,
    NULL,NULL,NULL,NULL,request_id,
    '{"platform":"transaction_rollback_test","app_version":"pr127"}'::jsonb
  );
  IF moved->>'ok' IS DISTINCT FROM 'true'
     OR moved#>>'{lead,latitude}' IS NULL
     OR abs((moved#>>'{lead,latitude}')::double precision-proposed_lat)>1e-10
     OR NOT EXISTS (SELECT 1 FROM private.lead_pin_move_audit WHERE client_request_id=request_id AND abs(saved_latitude-proposed_lat)<1e-10)
  THEN RAISE EXCEPTION 'MOVE_PIN_ROLLBACK_FAIL: %',moved->>'error'; END IF;
  stale := public.move_lead_pin(
    original.id,actor.id,actor.email,original.pin_location_updated_at,
    original.latitude,original.longitude,proposed_lat,original.longitude,
    NULL,NULL,NULL,NULL,gen_random_uuid(),
    '{"platform":"transaction_rollback_test","app_version":"pr127"}'::jsonb
  );
  IF stale->>'error' IS DISTINCT FROM 'stale_lead'
  THEN RAISE EXCEPTION 'MOVE_PIN_ROLLBACK_FAIL: concurrent update was not rejected'; END IF;
  RAISE EXCEPTION 'MOVE_PIN_ROLLBACK_PASS: save=true, audit=true, stale_rejected=true, decision=%. All test changes rolled back.',moved->>'decision';
END
$verify$;
