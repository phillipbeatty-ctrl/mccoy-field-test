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
