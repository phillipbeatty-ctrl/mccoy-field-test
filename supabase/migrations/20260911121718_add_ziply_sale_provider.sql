-- Add Ziply without changing any existing sale or granting new permissions.
-- Release this before the three sale Edge Functions and then the web UI.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

lock table public.sales_records in access exclusive mode;

do $migration$
declare
  current_definition text;
begin
  select pg_get_constraintdef(oid) into current_definition
  from pg_constraint
  where conrelid = 'public.sales_records'::regclass
    and conname = 'sales_records_isp_check';

  -- Stop if a concurrent release changed the existing provider contract.
  if current_definition is distinct from
    $expected$CHECK ((isp = ANY (ARRAY['Quantum'::text, 'Brightspeed'::text, 'AT&T'::text, 'T-Mobile / T-Fiber'::text, 'Kinetic'::text, 'Fidium'::text, 'Ascend Fiber'::text, 'Lightcurve'::text, 'Ripple Fiber'::text, 'Starlink'::text, 'DIRECTV'::text, 'Vivint'::text, 'Other'::text])))$expected$
  then
    raise exception 'sales_records_isp_check changed; review the current contract before adding Ziply';
  end if;
end;
$migration$;

alter table public.sales_records drop constraint sales_records_isp_check;
alter table public.sales_records add constraint sales_records_isp_check check (isp in (
  'Quantum', 'Brightspeed', 'AT&T', 'T-Mobile / T-Fiber', 'Kinetic', 'Fidium',
  'Ziply', 'Ascend Fiber', 'Lightcurve', 'Ripple Fiber', 'Starlink',
  'DIRECTV', 'Vivint', 'Other'
));

commit;
