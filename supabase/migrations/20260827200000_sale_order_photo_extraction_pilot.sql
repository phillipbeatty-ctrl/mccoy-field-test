-- Admin-only, organization-scoped pilot for measuring order screenshot extraction.
-- Pilot images are independent from production sales and expire automatically.

create table if not exists public.sale_order_photo_pilot_samples (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null check (char_length(trim(provider)) between 1 and 80),
  uploaded_by uuid not null references auth.users(id) on delete restrict,
  uploaded_by_email text not null,
  storage_path text not null unique,
  mime_type text not null check (mime_type in ('image/jpeg','image/png','image/webp')),
  file_size_bytes bigint not null check (file_size_bytes > 0 and file_size_bytes <= 10485760),
  redaction_confirmed boolean not null check (redaction_confirmed is true),
  redaction_attestation text not null,
  extraction_status text not null default 'uploaded'
    check (extraction_status in ('uploaded','processing','extracted','blocked_sensitive','failed','scored')),
  extracted_fields jsonb not null default '{}'::jsonb,
  extraction_model text,
  extraction_error text,
  extracted_at timestamptz,
  ground_truth jsonb not null default '{}'::jsonb,
  field_results jsonb not null default '{}'::jsonb,
  scored_by uuid references auth.users(id) on delete restrict,
  scored_by_email text,
  scored_at timestamptz,
  expires_at timestamptz not null default (now() + interval '45 days'),
  created_at timestamptz not null default now()
);

create index if not exists sale_order_photo_pilot_org_created_idx
  on public.sale_order_photo_pilot_samples(organization_id, created_at desc);
create index if not exists sale_order_photo_pilot_org_provider_idx
  on public.sale_order_photo_pilot_samples(organization_id, provider, created_at desc);
create index if not exists sale_order_photo_pilot_expiry_idx
  on public.sale_order_photo_pilot_samples(expires_at);

alter table public.sale_order_photo_pilot_samples enable row level security;
revoke all on public.sale_order_photo_pilot_samples from public, anon, authenticated;

comment on table public.sale_order_photo_pilot_samples is
  'Admin-only 30-50 screenshot pilot. Stores redaction attestations, suggestion-only extraction, independently entered ground truth, and server-computed field accuracy.';

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values(
  'sale-order-photo-pilot',
  'sale-order-photo-pilot',
  false,
  10485760,
  array['image/jpeg','image/png','image/webp']
)
on conflict(id) do update set
  public=false,
  file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;
