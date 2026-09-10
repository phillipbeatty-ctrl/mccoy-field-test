-- Exercises the existing RPC as service_role, then deliberately aborts.
-- The PASS exception rolls back both pin updates and audit rows.
DO $verify$
DECLARE
  actor record;
  original public.leads%rowtype;
  moved jsonb;
  stale jsonb;
  snapshot jsonb;
  rounded jsonb;
  request_id uuid := gen_random_uuid();
  proposed_lat double precision;
BEGIN
  EXECUTE 'SET LOCAL ROLE service_role';
  PERFORM set_config('lock_timeout','2s',true);
  PERFORM set_config('statement_timeout','10s',true);
  PERFORM set_config('extra_float_digits','0',true);
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
      AND (latitude IS DISTINCT FROM (to_jsonb(latitude)#>>'{}')::double precision
        OR longitude IS DISTINCT FROM (to_jsonb(longitude)#>>'{}')::double precision)
    ORDER BY id LIMIT 1 FOR UPDATE;
  IF original.id IS NULL THEN RAISE EXCEPTION 'MOVE_PIN_ROLLBACK_FAIL: no bounded pin fixture'; END IF;
  proposed_lat := original.latitude + 0.00001;
  -- Reproduce the old table-read transport before testing the repaired RPC.
  rounded := jsonb_build_object('latitude',original.latitude,'longitude',original.longitude);
  stale := public.move_lead_pin(
    original.id,actor.id,actor.email,original.pin_location_updated_at,
    (rounded->>'latitude')::double precision,(rounded->>'longitude')::double precision,
    proposed_lat,original.longitude,NULL,NULL,NULL,NULL,gen_random_uuid()
  );
  IF stale->>'error' IS DISTINCT FROM 'stale_lead'
  THEN RAISE EXCEPTION 'MOVE_PIN_ROLLBACK_FAIL: fixture did not reproduce rounded-coordinate rejection'; END IF;
  snapshot := (public.get_lead_pin_snapshot(original.id,actor.organization_id)::text)::jsonb;
  IF (snapshot->>'latitude')::double precision IS DISTINCT FROM original.latitude
     OR (snapshot->>'longitude')::double precision IS DISTINCT FROM original.longitude
     OR (snapshot->>'pin_location_updated_at')::timestamptz IS DISTINCT FROM original.pin_location_updated_at
  THEN RAISE EXCEPTION 'MOVE_PIN_ROLLBACK_FAIL: snapshot lost precision'; END IF;
  moved := public.move_lead_pin(
    original.id,actor.id,actor.email,(snapshot->>'pin_location_updated_at')::timestamptz,
    (snapshot->>'latitude')::double precision,(snapshot->>'longitude')::double precision,proposed_lat,original.longitude,
    NULL,NULL,NULL,NULL,request_id,
    '{"platform":"transaction_rollback_test","app_version":"pr127"}'::jsonb
  );
  IF moved->>'ok' IS DISTINCT FROM 'true'
     OR moved#>>'{lead,latitude}' IS NULL
     OR abs((moved#>>'{lead,latitude}')::double precision-proposed_lat)>1e-10
     OR NOT EXISTS (SELECT 1 FROM private.lead_pin_move_audit WHERE client_request_id=request_id AND abs(saved_latitude-proposed_lat)<1e-10)
  THEN RAISE EXCEPTION 'MOVE_PIN_ROLLBACK_FAIL: %',moved->>'error'; END IF;
  stale := public.move_lead_pin(
    original.id,actor.id,actor.email,(snapshot->>'pin_location_updated_at')::timestamptz,
    (snapshot->>'latitude')::double precision,(snapshot->>'longitude')::double precision,proposed_lat,original.longitude,
    NULL,NULL,NULL,NULL,gen_random_uuid(),
    '{"platform":"transaction_rollback_test","app_version":"pr127"}'::jsonb
  );
  IF stale->>'error' IS DISTINCT FROM 'stale_lead'
  THEN RAISE EXCEPTION 'MOVE_PIN_ROLLBACK_FAIL: concurrent update was not rejected'; END IF;
  -- A genuinely changed pin can be refreshed and explicitly confirmed again.
  snapshot := (public.get_lead_pin_snapshot(original.id,actor.organization_id)::text)::jsonb;
  moved := public.move_lead_pin(
    original.id,actor.id,actor.email,(snapshot->>'pin_location_updated_at')::timestamptz,
    (snapshot->>'latitude')::double precision,(snapshot->>'longitude')::double precision,
    original.latitude,original.longitude,NULL,NULL,NULL,NULL,gen_random_uuid()
  );
  IF moved->>'ok' IS DISTINCT FROM 'true'
  THEN RAISE EXCEPTION 'MOVE_PIN_ROLLBACK_FAIL: refreshed explicit retry failed'; END IF;
  RAISE EXCEPTION 'MOVE_PIN_ROLLBACK_PASS: rounded_reproduced=true, precise_save=true, audit=true, stale_rejected=true, refreshed_retry=true. All test changes rolled back.';
END
$verify$;
