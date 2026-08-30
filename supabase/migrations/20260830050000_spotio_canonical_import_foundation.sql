begin;

-- SPOTIO batches belong to one McCoy organization. A batch is provenance,
-- not an authoritative replacement snapshot of the Lead Pool.
alter table public.spotio_import_batches
  add column if not exists organization_id uuid references public.organizations(id) on delete restrict,
  add column if not exists created_count integer not null default 0,
  add column if not exists updated_count integer not null default 0,
  add column if not exists unchanged_count integer not null default 0,
  add column if not exists collision_count integer not null default 0,
  add column if not exists quarantined_count integer not null default 0,
  add column if not exists normalization_completed_at timestamptz;

update public.spotio_import_batches b
set organization_id = access.organization_id
from public.app_user_access access
where b.organization_id is null
  and lower(access.email) = lower(b.uploaded_by_email)
  and access.organization_id is not null;

create index if not exists spotio_import_batches_org_created_idx
  on public.spotio_import_batches (organization_id, created_at desc);
create index if not exists spotio_import_batches_org_status_idx
  on public.spotio_import_batches (organization_id, status, created_at desc);
create unique index if not exists spotio_import_items_batch_position_uidx
  on public.spotio_import_items (batch_id, chunk_index, item_index);

-- Provider identity and source-observation metadata are separate from McCoy's
-- operational fields. Import updates must never reset assignment or disposition.
alter table public.leads
  add column if not exists provider_lead_id text,
  add column if not exists canonical_identity_key text,
  add column if not exists source_first_seen_at timestamptz,
  add column if not exists source_last_seen_at timestamptz,
  add column if not exists source_seen_count integer not null default 1;

update public.leads
set source_first_seen_at = coalesce(source_first_seen_at, created_at),
    source_last_seen_at = coalesce(source_last_seen_at, last_activity_at, created_at),
    source_seen_count = greatest(coalesce(source_seen_count, 1), 1)
where source_first_seen_at is null
   or source_last_seen_at is null
   or source_seen_count < 1;

alter table public.leads drop constraint if exists leads_source_seen_count_check;
alter table public.leads
  add constraint leads_source_seen_count_check check (source_seen_count >= 1);

create index if not exists leads_spotio_provider_lookup_idx
  on public.leads (organization_id, lower(provider_lead_id), id)
  where deleted_at is null
    and upper(coalesce(source_system, '')) = 'SPOTIO'
    and provider_lead_id is not null;

create index if not exists leads_spotio_canonical_lookup_idx
  on public.leads (organization_id, canonical_identity_key, id)
  where deleted_at is null
    and upper(coalesce(source_system, '')) = 'SPOTIO'
    and canonical_identity_key is not null;

create or replace function private.mccoy_spotio_valid_address(
  p_address1 text,
  p_address2 text,
  p_city text,
  p_state text,
  p_zip text
)
returns boolean
language sql
immutable
set search_path = 'pg_catalog'
as $$
  select
    btrim(coalesce(p_address1, '')) <> ''
    and btrim(coalesce(p_city, '')) <> ''
    and upper(regexp_replace(coalesce(p_state, ''), '[^a-zA-Z]', '', 'g')) ~ '^[A-Z]{2}$'
    and left(regexp_replace(coalesce(p_zip, ''), '[^0-9]', '', 'g'), 5) ~ '^\d{5}$'
    and lower(btrim(coalesce(p_address1, ''))) not in (
      'prospecting / keep knocking', 'prospecting keep knocking',
      'hot lead', 'contacted', 'smb', 'follow-up', 'follow up',
      'no sale made', 'migrator', 'existing customer', 'sale made',
      'admin hold', 'no sale'
    );
$$;

create or replace function private.mccoy_spotio_canonical_identity(
  p_provider_lead_id text,
  p_address1 text,
  p_address2 text,
  p_city text,
  p_state text,
  p_zip text
)
returns text
language plpgsql
immutable
set search_path = 'pg_catalog', 'private'
as $$
declare
  v_provider text := lower(btrim(coalesce(p_provider_lead_id, '')));
  v_address text;
begin
  if v_provider <> '' then
    return 'provider|' || regexp_replace(v_provider, '[^a-z0-9:_-]+', '', 'g');
  end if;

  if not private.mccoy_spotio_valid_address(
    p_address1, p_address2, p_city, p_state, p_zip
  ) then
    return null;
  end if;

  v_address := private.mccoy_normalized_lead_address(
    p_address1, p_address2, p_city, p_state, p_zip
  );
  if split_part(v_address, '|', 1) = ''
     or split_part(v_address, '|', 3) = ''
     or split_part(v_address, '|', 4) = ''
     or split_part(v_address, '|', 5) = '' then
    return null;
  end if;
  return 'address|' || v_address;
end;
$$;

revoke all on function private.mccoy_spotio_valid_address(text,text,text,text,text)
  from public, anon;
revoke all on function private.mccoy_spotio_canonical_identity(text,text,text,text,text,text)
  from public, anon;
grant execute on function private.mccoy_spotio_valid_address(text,text,text,text,text)
  to authenticated, service_role;
grant execute on function private.mccoy_spotio_canonical_identity(text,text,text,text,text,text)
  to authenticated, service_role;

create table if not exists public.spotio_import_results (
  id bigint generated by default as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  batch_id uuid not null references public.spotio_import_batches(id) on delete cascade,
  item_index integer not null,
  lead_id uuid references public.leads(id) on delete set null,
  action text not null check (action in (
    'created','updated','unchanged','collision','quarantined','archived'
  )),
  canonical_identity_key text,
  provider_lead_id text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp(),
  unique (batch_id, item_index)
);

create index if not exists spotio_import_results_org_batch_idx
  on public.spotio_import_results (organization_id, batch_id, item_index);
create index if not exists spotio_import_results_lead_idx
  on public.spotio_import_results (lead_id)
  where lead_id is not null;

alter table public.spotio_import_results enable row level security;
drop policy if exists spotio_import_results_admin_read on public.spotio_import_results;
create policy spotio_import_results_admin_read
on public.spotio_import_results
for select
to authenticated
using (
  organization_id = private.current_organization_id()
  and private.current_app_role() = 'admin'
);

revoke all on table public.spotio_import_results from public, anon;
grant select on table public.spotio_import_results to authenticated;
grant all on table public.spotio_import_results to service_role;
grant usage, select on sequence public.spotio_import_results_id_seq to service_role;

notify pgrst, 'reload schema';
commit;
