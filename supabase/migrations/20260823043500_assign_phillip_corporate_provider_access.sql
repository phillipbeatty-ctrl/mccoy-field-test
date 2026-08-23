-- Corporate ISP authority belongs to Phillip Beatty's McCoy Admin identity.
-- Provider aliases (including ASAP "James Beatty") do not confer an app role.
create table if not exists public.provider_corporate_access (
  provider text not null,
  mccoy_user_id uuid not null references auth.users(id) on delete restrict,
  mccoy_email text not null,
  active boolean not null default true,
  assigned_at timestamptz not null default now(),
  assigned_by text,
  primary key (provider, mccoy_user_id)
);

alter table public.provider_corporate_access enable row level security;
revoke all on public.provider_corporate_access from public, anon, authenticated;

insert into public.provider_corporate_access(
  provider,mccoy_user_id,mccoy_email,active,assigned_by
)
select p.provider,u.id,lower(u.email),true,'system:phillip_corporate_provider_control'
from auth.users u
cross join (values ('Quantum'),('Brightspeed')) as p(provider)
join public.app_user_access a on lower(a.email)=lower(u.email)
where lower(u.email)='phillip.beatty@gmail.com'
  and lower(a.display_name)='phillip beatty'
  and a.role='admin'
  and a.active=true
on conflict (provider,mccoy_user_id) do update
set mccoy_email=excluded.mccoy_email,active=true,assigned_by=excluded.assigned_by;

-- Preserve the known ASAP identity mapping explicitly. This maps provider
-- evidence to Phillip; it never changes the McCoy role of a James Beatty user.
insert into public.provider_seller_links(
  rep_user_id,rep_email,provider,seller_identifier,seller_name,active
)
select u.id,lower(u.email),'Quantum',alias.identifier,'Phillip Beatty',true
from auth.users u
join public.app_user_access a on lower(a.email)=lower(u.email)
cross join (values ('James Beatty'),('Jmbeatty'),('PAGHV')) as alias(identifier)
where lower(u.email)='phillip.beatty@gmail.com'
  and a.role='admin' and a.active=true
on conflict (rep_user_id,provider,seller_identifier) do update
set rep_email=excluded.rep_email,seller_name=excluded.seller_name,active=true;

comment on table public.provider_corporate_access is
  'Internal allowlist for importing authoritative corporate provider reports. Provider identities never grant McCoy app roles.';
