create table if not exists public.sale_order_photos (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales_records(id) on delete cascade,
  organization_id uuid not null references public.organizations(id),
  uploaded_by uuid not null references auth.users(id),
  uploaded_by_email text not null,
  storage_path text not null unique,
  mime_type text not null,
  file_size_bytes bigint not null check (file_size_bytes > 0 and file_size_bytes <= 10485760),
  extraction_status text not null default 'uploaded' check (extraction_status in ('uploaded','processing','extracted','failed','user_confirmed')),
  extracted_fields jsonb not null default '{}'::jsonb,
  extraction_model text,
  extraction_error text,
  extracted_at timestamptz,
  user_confirmed_by uuid references auth.users(id),
  user_confirmed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists sale_order_photos_sale_idx on public.sale_order_photos(sale_id,created_at desc);
alter table public.sale_order_photos enable row level security;
revoke all on public.sale_order_photos from public,anon;
grant select on public.sale_order_photos to authenticated;
drop policy if exists sale_order_photos_select on public.sale_order_photos;
create policy sale_order_photos_select on public.sale_order_photos for select to authenticated using (
  organization_id=private.current_organization_id()
  and exists(
    select 1 from public.sales_records s
    where s.id=sale_id and s.organization_id=organization_id
      and (s.rep_user_id=auth.uid() or exists(select 1 from auth.users u join public.app_user_access a on lower(a.email)=lower(u.email) where u.id=auth.uid() and a.active=true and lower(a.role)='admin' and a.organization_id=organization_id))
  )
);
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('sale-order-photos','sale-order-photos',false,10485760,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
