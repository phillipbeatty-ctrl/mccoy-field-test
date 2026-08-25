-- Address Validation was removed after production review showed the candidates were not reliable.
-- Keep historical audit rows, but remove all mutation entry points.
drop function if exists public.apply_address_validation_pilot_repair(uuid,text,jsonb);
drop function if exists public.apply_address_validation_admin_review_decision(uuid,uuid,text);
