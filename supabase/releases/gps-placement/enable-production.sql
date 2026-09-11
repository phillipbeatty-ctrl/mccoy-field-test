begin;
do $$
declare v_org uuid;
begin
  select id into v_org from public.organizations
    where slug='mccoy-platform-llc' and active is true;
  if not found then raise exception 'active_mccoy_organization_required'; end if;
  insert into private.field_gps_rollout(organization_id,enabled,release_ref)
    values(v_org,true,'PR136:user-reported-testing-complete')
    on conflict(organization_id) do update
    set enabled=excluded.enabled,release_ref=excluded.release_ref,updated_at=clock_timestamp();
end;
$$;
commit;
