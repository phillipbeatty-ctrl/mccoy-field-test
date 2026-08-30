begin;

create or replace function private.set_lead_import_identity_fields()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public,private
as $$
begin
  if upper(coalesce(new.source_system,''))='SPOTIO' then
    new.provider_lead_id:=nullif(btrim(new.provider_lead_id),'');
    new.source_record_key:=coalesce(
      nullif(btrim(new.source_record_key),''),
      nullif(btrim(coalesce(new.source_payload->>'permanent_source_record_key','')),'')
    );
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

create or replace function private.preserve_stronger_lead_coordinates_v1()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
begin
  if old.latitude is not null and old.longitude is not null
     and coalesce(new.geocode_verification_status,'')='approximate_address_review'
     and coalesce(old.geocode_verification_status,'')<>'approximate_address_review' then
    new.latitude:=old.latitude;
    new.longitude:=old.longitude;
    new.geocode_status:=old.geocode_status;
    new.geocode_provider:=old.geocode_provider;
    new.geocode_precision:=old.geocode_precision;
    new.geocode_formatted_address:=old.geocode_formatted_address;
    new.geocode_place_id:=old.geocode_place_id;
    new.geocode_verified_at:=old.geocode_verified_at;
    new.geocode_verification_status:=old.geocode_verification_status;
    new.geocode_comparison_distance_meters:=old.geocode_comparison_distance_meters;
    new.geocode_candidate_latitude:=old.geocode_candidate_latitude;
    new.geocode_candidate_longitude:=old.geocode_candidate_longitude;
    new.geocode_verification_details:=old.geocode_verification_details;
  end if;
  return new;
end;
$$;

drop trigger if exists preserve_stronger_lead_coordinates on public.leads;
create trigger preserve_stronger_lead_coordinates
before update of latitude,longitude,geocode_status,geocode_provider,geocode_precision,
  geocode_formatted_address,geocode_place_id,geocode_verified_at,
  geocode_verification_status,geocode_comparison_distance_meters,
  geocode_candidate_latitude,geocode_candidate_longitude,geocode_verification_details
on public.leads
for each row execute function private.preserve_stronger_lead_coordinates_v1();

commit;
