-- Performance hardening for Admin sale review and Realtime Live Wins.
create index if not exists sale_review_disposition_history_changed_by_idx
  on public.sale_review_disposition_history(changed_by,created_at desc);
create index if not exists sales_records_admin_reviewed_by_idx
  on public.sales_records(admin_reviewed_by)
  where admin_reviewed_by is not null;

drop policy if exists "authorized users read sales feed" on public.sales_feed;
create policy "authorized users read sales feed"
on public.sales_feed for select to authenticated
using (
  exists (
    select 1 from public.app_user_access a
    where lower(a.email)=lower(coalesce(((select auth.jwt()))->>'email',''))
      and a.active=true
  )
);

