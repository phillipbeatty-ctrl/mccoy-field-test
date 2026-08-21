create table if not exists public.provider_sale_captures (
  id uuid primary key default gen_random_uuid(),
  client_request_id uuid not null,
  rep_user_id uuid not null,
  rep_email text not null,
  rep_name text not null,
  provider text not null,
  sale_context text not null default 'field',
  session_id uuid,
  lead_label text,
  service_address text,
  seller_portal_label text,
  portal_opened boolean not null default false,
  portal_open_reason text,
  status text not null default 'dashboard_opened',
  return_count integer not null default 0,
  last_returned_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint provider_sale_captures_request_unique unique (rep_user_id, client_request_id),
  constraint provider_sale_captures_context_check check (sale_context in ('field', 'out_of_area_phone')),
  constraint provider_sale_captures_status_check check (status in ('dashboard_opened', 'details_required', 'recorded', 'cancelled')),
  constraint provider_sale_captures_return_count_check check (return_count >= 0)
);

create index if not exists provider_sale_captures_rep_status_created_idx
  on public.provider_sale_captures (rep_user_id, status, created_at desc);

create index if not exists provider_sale_captures_status_created_idx
  on public.provider_sale_captures (status, created_at desc);

alter table public.provider_sale_captures enable row level security;

drop policy if exists "reps and admins read provider sale captures" on public.provider_sale_captures;
create policy "reps and admins read provider sale captures"
  on public.provider_sale_captures
  for select
  to authenticated
  using (
    rep_user_id = (select auth.uid())
    or exists (
      select 1
      from public.app_user_access access
      where lower(access.email) = lower(coalesce((select auth.jwt()) ->> 'email', ''))
        and access.active = true
        and access.role = 'admin'
    )
  );

revoke all on table public.provider_sale_captures from anon;
revoke insert, update, delete, truncate, references, trigger on table public.provider_sale_captures from authenticated;
grant select on table public.provider_sale_captures to authenticated;

alter table public.sales_records
  add column if not exists provider_capture_id uuid;

create unique index if not exists sales_records_provider_capture_id_unique
  on public.sales_records (provider_capture_id)
  where provider_capture_id is not null;

alter table public.sales_records
  drop constraint if exists sales_records_provider_capture_id_fkey;

alter table public.sales_records
  add constraint sales_records_provider_capture_id_fkey
  foreign key (provider_capture_id)
  references public.provider_sale_captures(id)
  on delete set null;

comment on table public.provider_sale_captures is
  'Durable record that a rep opened or attempted to open an external provider dashboard while processing a McCoy sale. Captures do not count for ranking or pay until linked to an ISP-verified sales_records row.';

comment on column public.sales_records.provider_capture_id is
  'Links the completed McCoy sale to the provider-dashboard capture that initiated it.';
