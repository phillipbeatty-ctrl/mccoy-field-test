begin;

-- These SECURITY DEFINER helpers are implementation details for the protected
-- app_user_access trigger and service-role repair RPC. They must not inherit
-- PostgreSQL's default PUBLIC EXECUTE grant.
revoke all on function private.sync_app_access_identity(uuid,uuid,text,text,boolean,text,text)
  from public, anon, authenticated, service_role;
revoke all on function private.sync_app_user_access_identity_trigger()
  from public, anon, authenticated, service_role;

commit;
