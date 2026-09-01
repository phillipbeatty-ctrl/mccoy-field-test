begin;

-- The restrictive RLS policies execute this boolean security-definer helper.
-- No table rows or secrets are exposed by granting this one boolean check.
grant usage on schema private to authenticated;
grant execute on function private.organization_access_allowed(uuid,text) to authenticated;

commit;
