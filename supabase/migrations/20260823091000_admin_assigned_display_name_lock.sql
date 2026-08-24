-- Active McCoy display names are authoritative assignments made by Admin.
-- A user may suggest a name during signup, but after access is granted the
-- app_user_access row controls the name shown everywhere in the application.

create or replace function private.prevent_non_admin_access_name_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
begin
  if new.display_name is distinct from old.display_name
     and (select auth.uid()) is not null
     and not public.is_mccoy_admin() then
    raise exception 'display_name_assigned_by_admin' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function private.prevent_non_admin_access_name_change() from public, anon, authenticated;
drop trigger if exists app_user_access_lock_admin_assigned_name on public.app_user_access;
create trigger app_user_access_lock_admin_assigned_name
before update of display_name on public.app_user_access
for each row execute function private.prevent_non_admin_access_name_change();

create or replace function private.prevent_non_admin_profile_name_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
begin
  if (new.first_name is distinct from old.first_name or new.last_name is distinct from old.last_name)
     and (select auth.uid()) is not null
     and not public.is_mccoy_admin() then
    raise exception 'profile_name_assigned_by_admin' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function private.prevent_non_admin_profile_name_change() from public, anon, authenticated;
drop trigger if exists users_lock_admin_assigned_name on public.users;
create trigger users_lock_admin_assigned_name
before update of first_name, last_name on public.users
for each row execute function private.prevent_non_admin_profile_name_change();

-- Remove table-level write capability even though the current SELECT-only RLS
-- policies already reject direct DML. Admin changes continue through the
-- authenticated rep-onboarding Edge Function, which validates Admin and uses
-- service_role for the synchronized access/profile/auth-metadata update.
revoke insert, update, delete, truncate, references, trigger
on public.app_user_access from anon, authenticated;
revoke insert, update, delete, truncate, references, trigger
on public.users from anon, authenticated;

grant select on public.app_user_access to authenticated;
grant select on public.users to authenticated;

-- This propagation function accepts audit actor arguments, so it must never be
-- directly callable by a browser role. The Admin-validated Edge Function is
-- the only application entry point.
revoke all on function public.admin_rename_app_user(text, text, uuid, text, uuid)
from public, anon, authenticated;
grant execute on function public.admin_rename_app_user(text, text, uuid, text, uuid)
to service_role;

comment on function private.prevent_non_admin_access_name_change() is
  'Defense-in-depth: rejects authenticated non-Admin changes to the authoritative McCoy display name.';
comment on function private.prevent_non_admin_profile_name_change() is
  'Defense-in-depth: rejects authenticated non-Admin changes to synchronized first and last names.';
