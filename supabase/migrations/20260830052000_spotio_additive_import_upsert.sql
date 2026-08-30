begin;

-- One active SPOTIO lead per organization/provider identity and per normalized
-- street+unit+city+state+ZIP fallback identity. Archived records remain auditable.
create unique index if not exists leads_active_spotio_provider_uidx
  on public.leads (organization_id, lower(provider_lead_id))
  where deleted_at is null
    and upper(coalesce(source_system,''))='SPOTIO'
    and nullif(btrim(provider_lead_id),'') is not null;

create unique index if not exists leads_active_spotio_canonical_uidx
  on public.leads (organization_id, canonical_identity_key)
  where deleted_at is null
    and upper(coalesce(source_system,''))='SPOTIO'
    and canonical_identity_key is not null;

create unique index if not exists leads_active_spotio_address_uidx
  on public.leads (organization_id, normalized_address_key)
  where deleted_at is null
    and upper(coalesce(source_system,''))='SPOTIO'
    and split_part(normalized_address_key,'|',1)<>''
    and split_part(normalized_address_key,'|',3)<>''
    and split_part(normalized_address_key,'|',4)<>''
    and split_part(normalized_address_key,'|',5)<>'';

create or replace function public.mccoy_upsert_spotio_lead_v1(
  p_batch_id uuid,
  p_item_index integer,
  p_record jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = 'pg_catalog', 'public', 'private'
as $$
declare
  v_batch public.spotio_import_batches%rowtype;
  v_provider_id text := nullif(btrim(coalesce(p_record->>'provider_lead_id','')),'');
  v_source_stage_id text := nullif(btrim(coalesce(p_record->>'source_stage_id','')),'');
  v_address1 text := btrim(coalesce(p_record->>'address1',''));
  v_address2 text := nullif(btrim(coalesce(p_record->>'address2','')),'');
  v_city text := btrim(coalesce(p_record->>'city',''));
  v_state text := upper(btrim(coalesce(p_record->>'state','')));
  v_zip text := btrim(coalesce(p_record->>'zip',''));
  v_customer_name text := nullif(btrim(coalesce(p_record->>'customer_name','')),'');
  v_phone text := nullif(btrim(coalesce(p_record->>'phone','')),'');
  v_latitude double precision;
  v_longitude double precision;
  v_identity text;
  v_address_key text;
  v_source_id text;
  v_by_provider public.leads%rowtype;
  v_by_identity public.leads%rowtype;
  v_archived public.leads%rowtype;
  v_existing public.leads%rowtype;
  v_updated public.leads%rowtype;
  v_action text;
  v_detail jsonb := '{}'::jsonb;
  v_material_change boolean := false;
  v_preserve_coordinates boolean := false;
  v_now timestamptz := clock_timestamp();
  v_result jsonb;
begin
  if p_batch_id is null then
    raise exception 'batch_id_required' using errcode='22023';
  end if;
  if p_item_index is null or p_item_index<0 then
    raise exception 'valid_item_index_required' using errcode='22023';
  end if;

  select * into v_batch
  from public.spotio_import_batches
  where id=p_batch_id
  for update;
  if not found or v_batch.organization_id is null then
    raise exception 'spotio_batch_not_found_or_unscoped' using errcode='P0002';
  end if;

  if nullif(p_record->>'latitude','') is not null then
    begin v_latitude := (p_record->>'latitude')::double precision;
    exception when others then v_latitude := null; end;
  end if;
  if nullif(p_record->>'longitude','') is not null then
    begin v_longitude := (p_record->>'longitude')::double precision;
    exception when others then v_longitude := null; end;
  end if;
  if v_latitude not between -90 and 90 then v_latitude := null; end if;
  if v_longitude not between -180 and 180 then v_longitude := null; end if;
  if v_latitude is null or v_longitude is null then
    v_latitude := null;
    v_longitude := null;
  end if;

  if not private.mccoy_spotio_valid_address(
    v_address1,v_address2,v_city,v_state,v_zip
  ) then
    v_action := 'quarantined';
    v_detail := jsonb_build_object(
      'reason','invalid_or_incomplete_service_address',
      'address1',v_address1,'city',v_city,'state',v_state,'zip',v_zip,
      'retained_prior_leads',true
    );
    insert into public.spotio_import_results(
      organization_id,batch_id,item_index,action,provider_lead_id,detail
    ) values (
      v_batch.organization_id,p_batch_id,p_item_index,v_action,v_provider_id,v_detail
    )
    on conflict(batch_id,item_index) do update set
      organization_id=excluded.organization_id,
      lead_id=null,
      action=excluded.action,
      canonical_identity_key=null,
      provider_lead_id=excluded.provider_lead_id,
      detail=excluded.detail,
      created_at=clock_timestamp();
    return jsonb_build_object('ok',true,'action',v_action,'lead_id',null,'detail',v_detail);
  end if;

  v_address_key := private.mccoy_normalized_lead_address(
    v_address1,v_address2,v_city,v_state,v_zip
  );
  v_identity := private.mccoy_spotio_canonical_identity(
    v_provider_id,v_address1,v_address2,v_city,v_state,v_zip
  );
  v_source_id := 'SPOTIO:'||v_batch.organization_id::text||':'||
    case when v_provider_id is not null
      then 'PROVIDER:'||regexp_replace(lower(v_provider_id),'[^a-z0-9:_-]+','','g')
      else 'ADDRESS:'||md5(v_address_key)
    end;

  if v_provider_id is not null then
    select * into v_by_provider
    from public.leads
    where organization_id=v_batch.organization_id
      and deleted_at is null
      and upper(coalesce(source_system,''))='SPOTIO'
      and lower(provider_lead_id)=lower(v_provider_id)
    order by created_at,id
    limit 1
    for update;
  end if;

  select * into v_by_identity
  from public.leads
  where organization_id=v_batch.organization_id
    and deleted_at is null
    and upper(coalesce(source_system,''))='SPOTIO'
    and (
      canonical_identity_key=v_identity
      or normalized_address_key=v_address_key
    )
  order by
    (canonical_identity_key=v_identity) desc,
    (assigned_rep_id is not null) desc,
    (assigned_manager_id is not null) desc,
    last_activity_at desc nulls last,
    created_at,id
  limit 1
  for update;

  if v_by_provider.id is not null
     and v_by_identity.id is not null
     and v_by_provider.id<>v_by_identity.id then
    v_action := 'collision';
    v_detail := jsonb_build_object(
      'reason','provider_id_and_address_resolve_to_different_active_leads',
      'provider_match_lead_id',v_by_provider.id,
      'address_match_lead_id',v_by_identity.id,
      'retained_prior_leads',true
    );
    insert into public.spotio_import_results(
      organization_id,batch_id,item_index,action,canonical_identity_key,
      provider_lead_id,detail
    ) values (
      v_batch.organization_id,p_batch_id,p_item_index,v_action,v_identity,
      v_provider_id,v_detail
    )
    on conflict(batch_id,item_index) do update set
      organization_id=excluded.organization_id,
      lead_id=null,
      action=excluded.action,
      canonical_identity_key=excluded.canonical_identity_key,
      provider_lead_id=excluded.provider_lead_id,
      detail=excluded.detail,
      created_at=clock_timestamp();
    return jsonb_build_object('ok',true,'action',v_action,'lead_id',null,'detail',v_detail);
  end if;

  if v_by_provider.id is not null then
    v_existing := v_by_provider;
  else
    v_existing := v_by_identity;
  end if;

  if v_existing.id is null then
    select * into v_archived
    from public.leads
    where organization_id=v_batch.organization_id
      and deleted_at is not null
      and upper(coalesce(source_system,''))='SPOTIO'
      and (
        (v_provider_id is not null and lower(coalesce(provider_lead_id,''))=lower(v_provider_id))
        or canonical_identity_key=v_identity
        or normalized_address_key=v_address_key
      )
    order by deleted_at desc,created_at,id
    limit 1;

    if v_archived.duplicate_of_lead_id is not null then
      select * into v_existing
      from public.leads
      where id=v_archived.duplicate_of_lead_id
        and organization_id=v_batch.organization_id
        and deleted_at is null
      for update;
    elsif v_archived.id is not null and v_archived.deletion_reason='manual' then
      v_action := 'archived';
      v_detail := jsonb_build_object(
        'reason','explicitly_archived_lead_retained',
        'archived_lead_id',v_archived.id,
        'retained_prior_leads',true
      );
      insert into public.spotio_import_results(
        organization_id,batch_id,item_index,lead_id,action,canonical_identity_key,
        provider_lead_id,detail
      ) values (
        v_batch.organization_id,p_batch_id,p_item_index,v_archived.id,v_action,
        v_identity,v_provider_id,v_detail
      )
      on conflict(batch_id,item_index) do update set
        organization_id=excluded.organization_id,
        lead_id=excluded.lead_id,
        action=excluded.action,
        canonical_identity_key=excluded.canonical_identity_key,
        provider_lead_id=excluded.provider_lead_id,
        detail=excluded.detail,
        created_at=clock_timestamp();
      return jsonb_build_object('ok',true,'action',v_action,'lead_id',v_archived.id,'detail',v_detail);
    end if;
  end if;

  if v_existing.id is null then
    insert into public.leads(
      organization_id,source_system,source_id,provider_lead_id,
      canonical_identity_key,import_batch_id,source_stage_id,source_payload,
      address1,address2,city,state,zip,latitude,longitude,
      customer_name,phone,current_disposition,stage,pin_color,pin_color_source,
      source_first_seen_at,source_last_seen_at,source_seen_count
    ) values (
      v_batch.organization_id,'SPOTIO',v_source_id,v_provider_id,
      v_identity,p_batch_id,v_source_stage_id,coalesce(p_record->'source_payload',p_record),
      v_address1,v_address2,v_city,v_state,v_zip,v_latitude,v_longitude,
      v_customer_name,v_phone,'uncontacted','Prospecting','#fbbf24','stage',
      v_now,v_now,1
    )
    returning * into v_updated;
    v_action := 'created';
    v_detail := jsonb_build_object(
      'assignment_preserved',true,
      'disposition_preserved',true,
      'verified_coordinates_preserved',null,
      'retained_prior_leads',true
    );
  else
    v_preserve_coordinates :=
      coalesce(v_existing.geocode_verification_status,'') in (
        'manual_door_verified','google_verified_preserved','google_address_validation_applied'
      )
      or coalesce(v_existing.geocode_status,'') in (
        'manual','field_verified','google_rooftop','google_address_validation'
      );

    v_material_change :=
      v_existing.address1 is distinct from v_address1
      or v_existing.address2 is distinct from v_address2
      or v_existing.city is distinct from v_city
      or v_existing.state is distinct from v_state
      or v_existing.zip is distinct from v_zip
      or (v_customer_name is not null and v_existing.customer_name is distinct from v_customer_name)
      or (v_phone is not null and v_existing.phone is distinct from v_phone)
      or (v_provider_id is not null and v_existing.provider_lead_id is distinct from v_provider_id)
      or v_existing.source_stage_id is distinct from v_source_stage_id
      or (
        not v_preserve_coordinates
        and v_latitude is not null
        and (
          v_existing.latitude is distinct from v_latitude
          or v_existing.longitude is distinct from v_longitude
        )
      );

    update public.leads
    set source_system='SPOTIO',
        source_id=v_source_id,
        provider_lead_id=coalesce(v_provider_id,provider_lead_id),
        canonical_identity_key=v_identity,
        import_batch_id=p_batch_id,
        source_stage_id=coalesce(v_source_stage_id,source_stage_id),
        source_payload=coalesce(p_record->'source_payload',p_record),
        address1=v_address1,
        address2=v_address2,
        city=v_city,
        state=v_state,
        zip=v_zip,
        latitude=case when v_preserve_coordinates or v_latitude is null then latitude else v_latitude end,
        longitude=case when v_preserve_coordinates or v_longitude is null then longitude else v_longitude end,
        geocode_status=case
          when v_preserve_coordinates or v_latitude is null then geocode_status
          else coalesce(geocode_status,'spotio_source') end,
        geocode_provider=case
          when v_preserve_coordinates or v_latitude is null then geocode_provider
          else coalesce(geocode_provider,'spotio') end,
        geocode_verification_status=case
          when v_preserve_coordinates or v_latitude is null then geocode_verification_status
          else coalesce(geocode_verification_status,'unverified_source') end,
        customer_name=coalesce(v_customer_name,customer_name),
        phone=coalesce(v_phone,phone),
        source_first_seen_at=coalesce(source_first_seen_at,created_at,v_now),
        source_last_seen_at=v_now,
        source_seen_count=greatest(coalesce(source_seen_count,1),1)+1
    where id=v_existing.id
    returning * into v_updated;

    v_action := case when v_material_change then 'updated' else 'unchanged' end;
    v_detail := jsonb_build_object(
      'assignment_preserved',
        v_updated.assigned_rep_id is not distinct from v_existing.assigned_rep_id
        and v_updated.assigned_manager_id is not distinct from v_existing.assigned_manager_id
        and v_updated.assigned_admin_email is not distinct from v_existing.assigned_admin_email,
      'disposition_preserved',
        v_updated.current_disposition is not distinct from v_existing.current_disposition
        and v_updated.stage is not distinct from v_existing.stage
        and v_updated.last_activity_type is not distinct from v_existing.last_activity_type
        and v_updated.visit_result is not distinct from v_existing.visit_result,
      'verified_coordinates_preserved',
        not v_preserve_coordinates
        or (
          v_updated.latitude is not distinct from v_existing.latitude
          and v_updated.longitude is not distinct from v_existing.longitude
        ),
      'retained_prior_leads',true
    );
  end if;

  insert into public.spotio_import_results(
    organization_id,batch_id,item_index,lead_id,action,canonical_identity_key,
    provider_lead_id,detail
  ) values (
    v_batch.organization_id,p_batch_id,p_item_index,v_updated.id,v_action,
    v_identity,v_provider_id,v_detail
  )
  on conflict(batch_id,item_index) do update set
    organization_id=excluded.organization_id,
    lead_id=excluded.lead_id,
    action=excluded.action,
    canonical_identity_key=excluded.canonical_identity_key,
    provider_lead_id=excluded.provider_lead_id,
    detail=excluded.detail,
    created_at=clock_timestamp();

  v_result := jsonb_build_object(
    'ok',true,
    'action',v_action,
    'lead_id',v_updated.id,
    'provider_lead_id',v_provider_id,
    'canonical_identity_key',v_identity,
    'normalized_address_key',v_address_key
  ) || v_detail;
  return v_result;
exception
  when unique_violation then
    return jsonb_build_object(
      'ok',true,'action','collision','lead_id',null,
      'provider_lead_id',v_provider_id,
      'canonical_identity_key',v_identity,
      'detail',jsonb_build_object(
        'reason','active_canonical_identity_changed_during_import',
        'retained_prior_leads',true
      )
    );
end;
$$;

create or replace function public.mccoy_upsert_spotio_batch_v1(
  p_batch_id uuid,
  p_records jsonb,
  p_item_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = 'pg_catalog', 'public'
as $$
declare
  v_record jsonb;
  v_result jsonb;
  v_index integer := 0;
  v_created integer := 0;
  v_updated integer := 0;
  v_unchanged integer := 0;
  v_collision integer := 0;
  v_quarantined integer := 0;
  v_archived integer := 0;
begin
  if jsonb_typeof(p_records)<>'array' then
    raise exception 'records_array_required' using errcode='22023';
  end if;

  for v_record in select value from jsonb_array_elements(p_records)
  loop
    v_result := public.mccoy_upsert_spotio_lead_v1(
      p_batch_id,greatest(coalesce(p_item_offset,0),0)+v_index,v_record
    );
    case v_result->>'action'
      when 'created' then v_created:=v_created+1;
      when 'updated' then v_updated:=v_updated+1;
      when 'unchanged' then v_unchanged:=v_unchanged+1;
      when 'collision' then v_collision:=v_collision+1;
      when 'quarantined' then v_quarantined:=v_quarantined+1;
      when 'archived' then v_archived:=v_archived+1;
      else v_collision:=v_collision+1;
    end case;
    v_index:=v_index+1;
  end loop;

  update public.spotio_import_batches
  set created_count=created_count+v_created,
      updated_count=updated_count+v_updated,
      unchanged_count=unchanged_count+v_unchanged,
      collision_count=collision_count+v_collision,
      quarantined_count=quarantined_count+v_quarantined
  where id=p_batch_id;

  return jsonb_build_object(
    'ok',true,
    'processed',v_index,
    'created',v_created,
    'updated',v_updated,
    'unchanged',v_unchanged,
    'collisions',v_collision,
    'quarantined',v_quarantined,
    'archived',v_archived,
    'retention_mode','additive_missing_retained',
    'import_batch_is_provenance_only',true
  );
end;
$$;

revoke all on function public.mccoy_upsert_spotio_lead_v1(uuid,integer,jsonb)
  from public, anon, authenticated;
revoke all on function public.mccoy_upsert_spotio_batch_v1(uuid,jsonb,integer)
  from public, anon, authenticated;
grant execute on function public.mccoy_upsert_spotio_lead_v1(uuid,integer,jsonb)
  to service_role;
grant execute on function public.mccoy_upsert_spotio_batch_v1(uuid,jsonb,integer)
  to service_role;

notify pgrst, 'reload schema';
commit;
