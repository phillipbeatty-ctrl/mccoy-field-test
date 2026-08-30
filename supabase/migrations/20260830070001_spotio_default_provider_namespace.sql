begin;

-- SPOTIO DOM captures do not currently expose a narrower provider value.
-- Give every fallback identity a stable provider namespace instead of an empty component.
create or replace function private.mccoy_spotio_fallback_identity_v1(
  p_provider text,
  p_address1 text,
  p_address2 text,
  p_zip text
)
returns text
language plpgsql
immutable
set search_path = pg_catalog, public, private
as $$
declare
  v_provider text := coalesce(
    nullif(public.mccoy_normalize_lead_identity_part_v1(p_provider), ''),
    'spotio'
  );
  v_street text := private.mccoy_normalized_spotio_street_v1(p_address1);
  v_unit text := private.mccoy_normalized_spotio_unit_v1(p_address2);
  v_zip text := left(regexp_replace(coalesce(p_zip, ''), '[^0-9]', '', 'g'), 5);
begin
  if v_street = '' or v_zip !~ '^\d{5}$' then
    return null;
  end if;
  return 'address:' || concat_ws('|', v_provider, v_street, v_unit, v_zip);
end;
$$;

create or replace function private.set_lead_import_identity_fields()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if upper(coalesce(new.source_system, '')) = 'SPOTIO' then
    new.provider_lead_id := nullif(btrim(new.provider_lead_id), '');
    new.provider := coalesce(nullif(btrim(new.provider), ''), 'SPOTIO');
    new.fallback_identity_key := private.mccoy_spotio_fallback_identity_v1(
      new.provider, new.address1, new.address2, new.zip
    );
    new.canonical_identity_key := private.mccoy_spotio_canonical_identity_v2(
      new.provider_lead_id, new.provider,
      new.address1, new.address2, new.city, new.state, new.zip
    );
    new.source_first_seen_at := coalesce(new.source_first_seen_at, new.created_at, clock_timestamp());
    new.source_last_seen_at := coalesce(new.source_last_seen_at, clock_timestamp());
    new.source_seen_count := greatest(coalesce(new.source_seen_count, 1), 1);
  end if;
  return new;
end;
$$;

-- Abort before rewriting keys if the provider namespace exposes any active collision.
do $$
declare
  v_collision_groups integer;
begin
  select count(*) into v_collision_groups
  from (
    select organization_id,
      private.mccoy_spotio_canonical_identity_v2(
        provider_lead_id,
        coalesce(nullif(btrim(provider), ''), 'SPOTIO'),
        address1, address2, city, state, zip
      ) as proposed_identity
    from public.leads
    where deleted_at is null
      and upper(coalesce(source_system, '')) = 'SPOTIO'
    group by organization_id,
      private.mccoy_spotio_canonical_identity_v2(
        provider_lead_id,
        coalesce(nullif(btrim(provider), ''), 'SPOTIO'),
        address1, address2, city, state, zip
      )
    having count(*) > 1
  ) collisions;

  if v_collision_groups > 0 then
    raise exception
      'spotio_provider_namespace_migration_blocked: % active collision group(s) require review',
      v_collision_groups;
  end if;
end;
$$;

update public.leads
set
  provider = coalesce(nullif(btrim(provider), ''), 'SPOTIO'),
  fallback_identity_key = private.mccoy_spotio_fallback_identity_v1(
    coalesce(nullif(btrim(provider), ''), 'SPOTIO'), address1, address2, zip
  ),
  canonical_identity_key = private.mccoy_spotio_canonical_identity_v2(
    provider_lead_id,
    coalesce(nullif(btrim(provider), ''), 'SPOTIO'),
    address1, address2, city, state, zip
  )
where upper(coalesce(source_system, '')) = 'SPOTIO';

commit;
