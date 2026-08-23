-- Extend Phillip Beatty's existing corporate provider control to DIRECTV and Vivint.
-- The provider-reconcile Edge Function still enforces active McCoy Admin access.
insert into public.provider_corporate_access (
  provider,
  mccoy_user_id,
  mccoy_email,
  active,
  assigned_by
)
values
  ('DIRECTV', 'f9053207-1af1-4ed1-be43-28f4bf5d7732'::uuid, 'phillip.beatty@gmail.com', true, 'system:phillip_corporate_provider_control'),
  ('Vivint', 'f9053207-1af1-4ed1-be43-28f4bf5d7732'::uuid, 'phillip.beatty@gmail.com', true, 'system:phillip_corporate_provider_control')
on conflict (provider, mccoy_user_id) do update
set mccoy_email = excluded.mccoy_email,
    active = true,
    assigned_at = now(),
    assigned_by = excluded.assigned_by;
