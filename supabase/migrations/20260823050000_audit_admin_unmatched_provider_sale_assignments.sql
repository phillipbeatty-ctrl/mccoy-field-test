create table if not exists public.provider_seller_assignment_history (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  seller_identifier text not null,
  seller_name text,
  affected_row_count integer not null default 0,
  rep_user_id uuid not null references auth.users(id) on delete restrict,
  rep_email text not null,
  rep_name text not null,
  assigned_by_user_id uuid not null references auth.users(id) on delete restrict,
  assigned_by_email text not null,
  created_at timestamptz not null default now()
);
alter table public.provider_seller_assignment_history enable row level security;
revoke all on public.provider_seller_assignment_history from public,anon,authenticated;
create index if not exists provider_seller_assignment_history_seller_idx
  on public.provider_seller_assignment_history(provider,seller_identifier,created_at desc);
comment on table public.provider_seller_assignment_history is
  'Immutable audit log of Admin assignments from unmatched ISP seller identities to active McCoy users.';
