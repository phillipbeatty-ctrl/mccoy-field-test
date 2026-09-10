\set ON_ERROR_STOP on
-- Disposable PostgreSQL database only. CREATE TABLE intentionally fails if a
-- real leads table exists. The transaction removes every fixture at the end.
begin;
create table public.leads (
  id uuid primary key,
  organization_id uuid,
  latitude double precision,
  longitude double precision,
  pin_location_updated_at timestamptz,
  assigned_rep_id uuid,
  assigned_manager_id uuid,
  deleted_at timestamptz
);
create role anon;
create role authenticated;
create role service_role;
grant select on public.leads to service_role;
insert into public.leads (id,organization_id,latitude,longitude,pin_location_updated_at) values
  ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000010',12.345678901234568,-98.76543210987654,'2026-09-04T00:54:25.198452Z'),
  ('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000010',null,null,'2026-09-04T00:54:25.198453Z'),
  ('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000010',89.99999999999999,-179.99999999999997,'2026-09-04T00:54:25.198454Z');
insert into public.leads (id,organization_id,latitude,longitude,pin_location_updated_at,deleted_at) values
  ('00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000010',1,2,now(),now());

\ir ../supabase/migrations/20260910183903_lead_pin_snapshot_precision.sql

set local role service_role;
set local extra_float_digits=0;
do $test$
declare
  original public.leads%rowtype;
  snapshot jsonb;
  precision_setting text;
begin
  if has_function_privilege('anon','public.get_lead_pin_snapshot(uuid,uuid)','EXECUTE')
     or has_function_privilege('authenticated','public.get_lead_pin_snapshot(uuid,uuid)','EXECUTE')
  then raise exception 'Snapshot RPC was exposed to a client role'; end if;

  select * into strict original from public.leads where id='00000000-0000-4000-8000-000000000001';
  if original.latitude is not distinct from (to_jsonb(original.latitude)#>>'{}')::double precision
  then raise exception 'Fixture did not reproduce the old rounded JSON failure'; end if;

  foreach precision_setting in array array['0','3'] loop
    perform set_config('extra_float_digits',precision_setting,true);
    for original in select * from public.leads where deleted_at is null loop
      -- Serializing the RPC result again must not revert to the caller's lower
      -- float precision. JSONB's numeric payload must survive a JSON round-trip.
      snapshot := (public.get_lead_pin_snapshot(original.id,original.organization_id)::text)::jsonb;
      if snapshot is null
         or (snapshot->>'latitude')::double precision is distinct from original.latitude
         or (snapshot->>'longitude')::double precision is distinct from original.longitude
         or (snapshot->>'pin_location_updated_at')::timestamptz is distinct from original.pin_location_updated_at
      then raise exception 'Snapshot lost coordinate, null, or timestamp precision'; end if;
      if current_setting('extra_float_digits') <> precision_setting
      then raise exception 'Function precision setting leaked into its caller'; end if;
      if public.get_lead_pin_snapshot(original.id,'00000000-0000-4000-8000-000000000011') is not null
         or public.get_lead_pin_snapshot(original.id,null) is not null
      then raise exception 'Snapshot escaped its organization scope'; end if;
    end loop;
  end loop;
  if public.get_lead_pin_snapshot('00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000010') is not null
     or public.get_lead_pin_snapshot('00000000-0000-4000-8000-000000000099','00000000-0000-4000-8000-000000000010') is not null
  then raise exception 'Deleted or missing lead was returned'; end if;
end
$test$;
select 'MOVE_PIN_PRECISION_PASS: exact JSON coordinates, microseconds, nulls, scoped access, caller settings' as result;
rollback;
