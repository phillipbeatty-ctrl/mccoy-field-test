begin;

-- Make the 17,517 already-preserved production rows idempotent under the
-- permanent list-row import identity used by the production uploader.
do $$
declare
  v_rows integer;
  v_keys integer;
begin
  with keyed as (
    select encode(digest(concat_ws('|',
      coalesce(ob.raw_payload->'metadata'->>'source_origin',''),
      coalesce(ob.raw_payload->'metadata'->>'started_at',''),
      coalesce(l.source_payload->'raw_payload'->>'row_index',''),
      lower(regexp_replace(coalesce(l.address1,''),'[^a-zA-Z0-9]+',' ','g')),
      lower(regexp_replace(coalesce(l.address2,''),'[^a-zA-Z0-9]+',' ','g')),
      lower(regexp_replace(coalesce(l.city,''),'[^a-zA-Z0-9]+',' ','g')),
      upper(coalesce(l.state,'')),
      left(regexp_replace(coalesce(l.zip,''),'[^0-9]','','g'),5),
      lower(regexp_replace(coalesce(l.customer_name,''),'[^a-zA-Z0-9]+',' ','g'))
    ),'sha256'),'hex') as h
    from public.leads l
    left join public.spotio_import_batches ob
      on ob.id=nullif(l.source_payload->>'original_batch_id','')::uuid
    where l.deleted_at is null
      and l.import_batch_id='b3ae2da8-2a48-487c-8714-6ec57d642b24'::uuid
  )
  select count(*),count(distinct h) into v_rows,v_keys from keyed;
  if v_rows<>v_keys then
    raise exception 'spotio_preserved_row_hash_collision: % rows / % keys',v_rows,v_keys;
  end if;
end;
$$;

with keyed as (
  select l.id,l.organization_id,
    encode(digest(concat_ws('|',
      coalesce(ob.raw_payload->'metadata'->>'source_origin',''),
      coalesce(ob.raw_payload->'metadata'->>'started_at',''),
      coalesce(l.source_payload->'raw_payload'->>'row_index',''),
      lower(regexp_replace(coalesce(l.address1,''),'[^a-zA-Z0-9]+',' ','g')),
      lower(regexp_replace(coalesce(l.address2,''),'[^a-zA-Z0-9]+',' ','g')),
      lower(regexp_replace(coalesce(l.city,''),'[^a-zA-Z0-9]+',' ','g')),
      upper(coalesce(l.state,'')),
      left(regexp_replace(coalesce(l.zip,''),'[^0-9]','','g'),5),
      lower(regexp_replace(coalesce(l.customer_name,''),'[^a-zA-Z0-9]+',' ','g'))
    ),'sha256'),'hex') as h
  from public.leads l
  left join public.spotio_import_batches ob
    on ob.id=nullif(l.source_payload->>'original_batch_id','')::uuid
  where l.deleted_at is null
    and l.import_batch_id='b3ae2da8-2a48-487c-8714-6ec57d642b24'::uuid
)
update public.leads l
set
  provider_lead_id='LISTROW:'||substr(k.h,1,32),
  source_record_key='spotiolist:'||k.h,
  source_id='SPOTIO:'||k.organization_id::text||':PROVIDER:listrow:'||substr(k.h,1,32),
  source_payload=coalesce(l.source_payload,'{}'::jsonb)||jsonb_build_object(
    'row_preservation_version',1,
    'permanent_source_record_key','spotiolist:'||k.h,
    'synthetic_list_row_provider_id','LISTROW:'||substr(k.h,1,32)
  )
from keyed k
where l.id=k.id;

-- Future LISTROW identities automatically expose their permanent source key.
create or replace function private.set_lead_import_identity_fields()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public,private
as $$
begin
  if upper(coalesce(new.source_system,''))='SPOTIO' then
    new.provider_lead_id:=nullif(btrim(new.provider_lead_id),'');
    new.source_record_key:=nullif(btrim(new.source_record_key),'');
    if new.source_record_key is null and upper(coalesce(new.provider_lead_id,'')) like 'LISTROW:%' then
      new.source_record_key:='spotiolist:'||lower(substr(new.provider_lead_id,9));
    end if;
    new.provider:=coalesce(nullif(btrim(new.provider),''),'SPOTIO');
    new.fallback_identity_key:=private.mccoy_spotio_fallback_identity_v1(
      new.provider,new.address1,new.address2,new.zip
    );
    new.canonical_identity_key:=private.mccoy_spotio_canonical_identity_v3(
      new.provider_lead_id,new.source_record_key,new.provider,
      new.address1,new.address2,new.city,new.state,new.zip
    );
    new.building_identity_key:=private.mccoy_spotio_building_identity_v1(
      new.provider,new.address1,new.city,new.state,new.zip
    );
    new.source_first_seen_at:=coalesce(new.source_first_seen_at,new.created_at,clock_timestamp());
    new.source_last_seen_at:=coalesce(new.source_last_seen_at,clock_timestamp());
    new.source_seen_count:=greatest(coalesce(new.source_seen_count,1),1);
  end if;
  return new;
end;
$$;

-- Server-only map fallback lookup used by the importer. Missing source pins no
-- longer prevent a lead from entering or appearing in the live map.
create or replace function public.mccoy_spotio_map_centroids_v1(p_zip_codes text[])
returns table(
  zip text,
  city text,
  state text,
  latitude double precision,
  longitude double precision,
  provider text,
  formatted_address text,
  place_id text
)
language sql
stable
security definer
set search_path=pg_catalog,private
as $$
  select c.zip,c.city,c.state,c.latitude,c.longitude,c.provider,c.formatted_address,c.place_id
  from private.lead_map_centroids c
  where coalesce(array_length(p_zip_codes,1),0)=0
     or c.zip=any(p_zip_codes)
  order by c.zip,c.updated_at desc;
$$;

revoke all on function public.mccoy_spotio_map_centroids_v1(text[]) from public,anon,authenticated;
grant execute on function public.mccoy_spotio_map_centroids_v1(text[]) to service_role;

commit;
