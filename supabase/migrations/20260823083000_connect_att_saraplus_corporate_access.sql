-- Give Phillip Beatty's existing corporate provider control authority to import
-- AT&T Sara Plus reports. DIRECTV remains a separate provider/account context.
-- The provider-reconcile Edge Function still requires the caller to be an active
-- McCoy Admin and checks this provider-specific authorization row.
insert into public.provider_corporate_access (
  provider,
  mccoy_user_id,
  mccoy_email,
  active,
  assigned_by
)
values (
  'AT&T',
  'f9053207-1af1-4ed1-be43-28f4bf5d7732'::uuid,
  'phillip.beatty@gmail.com',
  true,
  'system:phillip_corporate_provider_control'
)
on conflict (provider, mccoy_user_id) do update
set mccoy_email = excluded.mccoy_email,
    active = true,
    assigned_at = now(),
    assigned_by = excluded.assigned_by;
