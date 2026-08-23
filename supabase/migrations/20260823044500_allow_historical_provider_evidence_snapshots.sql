drop index if exists public.provider_sales_rows_materialized_sale_unique;
create index if not exists provider_sales_rows_materialized_sale_idx
  on public.provider_sales_rows(materialized_sale_id)
  where materialized_sale_id is not null;
comment on index public.provider_sales_rows_materialized_sale_idx is
  'Allows multiple authoritative provider evidence snapshots to support one canonical McCoy sale.';
