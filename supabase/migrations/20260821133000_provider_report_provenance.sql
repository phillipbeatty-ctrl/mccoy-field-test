alter table public.provider_sales_imports
  add column if not exists source_scope text not null default 'dealer_account',
  add column if not exists source_rep_user_id uuid references auth.users(id) on delete set null,
  add column if not exists source_rep_email text,
  add column if not exists report_period_start date,
  add column if not exists report_period_end date,
  add column if not exists file_sha256 text,
  add column if not exists cross_reference_summary jsonb not null default '{}'::jsonb,
  add column if not exists last_cross_referenced_at timestamptz;

alter table public.provider_sales_imports
  drop constraint if exists provider_sales_imports_source_scope_check,
  add constraint provider_sales_imports_source_scope_check
    check (source_scope in ('rep_account', 'dealer_account')),
  drop constraint if exists provider_sales_imports_source_rep_check,
  add constraint provider_sales_imports_source_rep_check
    check (
      (source_scope = 'dealer_account' and source_rep_user_id is null)
      or
      (source_scope = 'rep_account' and source_rep_user_id is not null)
    ),
  drop constraint if exists provider_sales_imports_period_check,
  add constraint provider_sales_imports_period_check
    check (
      report_period_start is null
      or report_period_end is null
      or report_period_start <= report_period_end
    );

create unique index if not exists provider_sales_imports_file_dedupe_idx
  on public.provider_sales_imports (
    coalesce(source_provider, 'Mixed / Auto-detect'),
    source_scope,
    coalesce(source_rep_user_id, '00000000-0000-0000-0000-000000000000'::uuid),
    file_sha256
  )
  where file_sha256 is not null;

create index if not exists provider_sales_imports_scope_created_idx
  on public.provider_sales_imports (source_scope, created_at desc);

create index if not exists provider_sales_imports_rep_created_idx
  on public.provider_sales_imports (source_rep_user_id, created_at desc)
  where source_rep_user_id is not null;

alter table public.provider_sales_rows
  add column if not exists evidence_scope text not null default 'dealer_account',
  add column if not exists source_rep_user_id uuid references auth.users(id) on delete set null,
  add column if not exists source_rep_email text,
  add column if not exists row_fingerprint text,
  add column if not exists cross_reference_status text not null default 'authoritative',
  add column if not exists cross_referenced_row_id uuid references public.provider_sales_rows(id) on delete set null,
  add column if not exists cross_referenced_at timestamptz;

alter table public.provider_sales_rows
  drop constraint if exists provider_sales_rows_evidence_scope_check,
  add constraint provider_sales_rows_evidence_scope_check
    check (evidence_scope in ('rep_account', 'dealer_account')),
  drop constraint if exists provider_sales_rows_source_rep_check,
  add constraint provider_sales_rows_source_rep_check
    check (
      (evidence_scope = 'dealer_account' and source_rep_user_id is null)
      or
      (evidence_scope = 'rep_account' and source_rep_user_id is not null)
    ),
  drop constraint if exists provider_sales_rows_cross_reference_status_check,
  add constraint provider_sales_rows_cross_reference_status_check
    check (cross_reference_status in (
      'authoritative',
      'pending_dealer',
      'matched_dealer',
      'missing_from_dealer',
      'conflict',
      'period_unknown'
    ));

create unique index if not exists provider_sales_rows_import_fingerprint_idx
  on public.provider_sales_rows (import_id, row_fingerprint)
  where row_fingerprint is not null;

create index if not exists provider_sales_rows_provider_scope_order_idx
  on public.provider_sales_rows (provider, evidence_scope, order_number)
  where order_number is not null;

create index if not exists provider_sales_rows_provider_scope_account_idx
  on public.provider_sales_rows (provider, evidence_scope, account_number)
  where account_number is not null;

create index if not exists provider_sales_rows_rep_cross_reference_idx
  on public.provider_sales_rows (source_rep_user_id, cross_reference_status, created_at desc)
  where evidence_scope = 'rep_account';

alter table public.provider_sales_imports enable row level security;
alter table public.provider_sales_rows enable row level security;

revoke all on table public.provider_sales_imports from anon, authenticated;
revoke all on table public.provider_sales_rows from anon, authenticated;

comment on column public.provider_sales_imports.source_scope is
  'Origin of the evidence. Rep-account reports are preliminary; dealer-account reports are authoritative.';

comment on column public.provider_sales_rows.cross_reference_status is
  'Dealer cross-reference result for rep-account evidence. This field never grants compensation eligibility by itself.';
