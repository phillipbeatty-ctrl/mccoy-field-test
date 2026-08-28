-- Private, short-lived photo staging for the provider-dashboard sale lifecycle.
-- Production Sales Hub does not load this feature until the preview branch is merged.
create table if not exists public.provider_sale_capture_photos (
  id uuid primary key default gen_random_uuid(),
  provider_capture_id uuid not null references public.provider_sale_captures(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  uploaded_by uuid not null references auth.users(id) on delete cascade,
  uploaded_by_email text not null,
  original_file_name text,
  storage_path text not null unique,
  mime_type text not null check (mime_type in ('image/jpeg','image/png','image/webp')),
  file_size_bytes bigint not null check (file_size_bytes > 0 and file_size_bytes <= 10485760),
  status text not null default 'uploading' check (status in ('uploading','staged','attaching','attached','failed')),
  attached_sale_id uuid references public.sales_records(id) on delete set null,
  attached_sale_photo_id uuid references public.sale_order_photos(id) on delete set null,
  attachment_error text,
  expires_at timestamptz not null default (now() + interval '2 days'),
  attached_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists provider_sale_capture_photos_capture_status_idx
  on public.provider_sale_capture_photos(provider_capture_id,status,created_at);
create index if not exists provider_sale_capture_photos_expiry_idx
  on public.provider_sale_capture_photos(expires_at)
  where status in ('uploading','staged','failed');
create unique index if not exists provider_sale_capture_photos_attached_photo_unique
  on public.provider_sale_capture_photos(attached_sale_photo_id)
  where attached_sale_photo_id is not null;

alter table public.provider_sale_capture_photos enable row level security;
revoke all on table public.provider_sale_capture_photos from public, anon, authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values(
  'provider-sale-staged-photos',
  'provider-sale-staged-photos',
  false,
  10485760,
  array['image/jpeg','image/png','image/webp']
)
on conflict(id) do update set
  public=false,
  file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

comment on table public.provider_sale_capture_photos is
  'Short-lived private order photos staged against a signed-in user provider capture. On COMPLETE SALE they are moved into sale_order_photos; ABANDONED deletes them.';
