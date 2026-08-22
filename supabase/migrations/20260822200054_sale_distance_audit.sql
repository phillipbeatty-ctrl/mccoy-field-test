alter table public.sales_records
  add column if not exists distance_lead_id uuid references public.leads(id) on delete set null,
  add column if not exists rep_distance_from_customer_meters double precision,
  add column if not exists rep_location_accuracy_meters double precision,
  add column if not exists distance_recorded_at timestamptz,
  add column if not exists distance_measurement_status text not null default 'not_recorded';

alter table public.sales_records
  drop constraint if exists sales_records_rep_distance_nonnegative,
  add constraint sales_records_rep_distance_nonnegative
    check (rep_distance_from_customer_meters is null or rep_distance_from_customer_meters >= 0),
  drop constraint if exists sales_records_rep_location_accuracy_nonnegative,
  add constraint sales_records_rep_location_accuracy_nonnegative
    check (rep_location_accuracy_meters is null or rep_location_accuracy_meters >= 0),
  drop constraint if exists sales_records_distance_measurement_status_check,
  add constraint sales_records_distance_measurement_status_check
    check (distance_measurement_status in ('not_recorded','recorded','rep_location_unavailable','customer_map_location_unavailable'));

comment on column public.sales_records.rep_distance_from_customer_meters is
  'Approximate straight-line map distance from the rep location available to McCoy when the sale was saved to the selected customer address coordinates. Informational only.';

comment on column public.sales_records.distance_measurement_status is
  'Indicates whether an informational map distance could be recorded. This value does not approve, reject, rank, or calculate pay for a sale.';
