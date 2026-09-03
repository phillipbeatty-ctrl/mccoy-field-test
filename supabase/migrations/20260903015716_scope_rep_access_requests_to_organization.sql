begin;

alter table public.rep_access_requests
  add column if not exists organization_id uuid;

update public.rep_access_requests request
set organization_id=coalesce(
  (
    select access.organization_id
    from public.app_user_access access
    where lower(access.email)=lower(request.email)
    order by access.created_at asc
    limit 1
  ),
  private.mccoy_organization_id()
)
where request.organization_id is null;

alter table public.rep_access_requests
  alter column organization_id set default private.mccoy_organization_id(),
  alter column organization_id set not null;

do $$
begin
  if not exists(
    select 1
    from pg_constraint
    where conrelid='public.rep_access_requests'::regclass
      and conname='rep_access_requests_organization_id_fkey'
  ) then
    alter table public.rep_access_requests
      add constraint rep_access_requests_organization_id_fkey
      foreign key(organization_id)
      references public.organizations(id)
      on delete cascade;
  end if;
end
$$;

create index if not exists rep_access_requests_org_status_created_idx
  on public.rep_access_requests(organization_id,status,created_at desc);

commit;
