begin;

-- Canonical SPOTIO consolidation uses new reason values while retaining a full
-- soft-delete audit trail. No McCoy operational record is hard-deleted.
alter table public.leads drop constraint if exists leads_deletion_reason_check;
alter table public.leads
  add constraint leads_deletion_reason_check check (
    deletion_reason is null or deletion_reason in (
      'manual','duplicate','canonical_spotio_merge','invalid_spotio_import_row'
    )
  );

alter table public.lead_removal_audit drop constraint if exists lead_removal_audit_reason_check;
alter table public.lead_removal_audit
  add constraint lead_removal_audit_reason_check check (
    reason in (
      'manual','duplicate','canonical_spotio_merge','invalid_spotio_import_row'
    )
  );

create or replace function public.spotio_canonical_merge_plan()
returns jsonb
language sql
stable
security definer
set search_path = 'pg_catalog', 'public', 'private'
as $$
with active as (
  select l.*,
    private.mccoy_spotio_valid_address(l.address1,l.address2,l.city,l.state,l.zip) as valid_address,
    exists(select 1 from public.door_visits v where v.lead_id=l.id) as has_visits,
    exists(select 1 from public.door_activities a where a.lead_id=l.id) as has_activities,
    exists(select 1 from public.location_events e where e.lead_id=l.id) as has_locations,
    exists(select 1 from public.provider_sale_captures c where c.lead_id=l.id) as has_provider_capture,
    exists(select 1 from public.sales_records s where s.distance_lead_id=l.id) as has_sales,
    exists(select 1 from public.lead_geocode_verifications g where g.lead_id=l.id) as has_geocode_history
  from public.leads l
  where l.deleted_at is null
    and upper(coalesce(l.source_system,''))='SPOTIO'
), valid as (
  select *,
    private.mccoy_normalized_lead_address(address1,address2,city,state,zip) as identity_address
  from active
  where valid_address
), grouped as (
  select organization_id, identity_address,
    count(*)::integer as copies,
    count(distinct assigned_rep_id) filter(where assigned_rep_id is not null)::integer as rep_values,
    count(distinct assigned_manager_id) filter(where assigned_manager_id is not null)::integer as manager_values,
    count(distinct current_disposition) filter(
      where current_disposition is not null and lower(current_disposition)<>'uncontacted'
    )::integer as disposition_values,
    count(distinct stage) filter(
      where stage is not null and stage<>'Prospecting'
    )::integer as stage_values
  from valid
  group by organization_id, identity_address
), invalid as (
  select * from active where not valid_address
), token_source as (
  select md5(coalesce(string_agg(
    id::text||':'||coalesce(normalized_address_key,'')||':'||coalesce(import_batch_id::text,''),
    ',' order by id
  ),'')) as snapshot_token
  from active
)
select jsonb_build_object(
  'ok',true,
  'snapshot_token',(select snapshot_token from token_source),
  'active_spotio_rows',(select count(*) from active),
  'valid_address_rows',(select count(*) from valid),
  'canonical_valid_leads',(select count(*) from grouped),
  'duplicate_address_groups',(select count(*) from grouped where copies>1),
  'duplicate_rows_to_merge',(select coalesce(sum(copies-1),0) from grouped where copies>1),
  'conflicting_rep_groups',(select count(*) from grouped where rep_values>1),
  'conflicting_manager_groups',(select count(*) from grouped where manager_values>1),
  'conflicting_disposition_groups',(select count(*) from grouped where disposition_values>1),
  'conflicting_stage_groups',(select count(*) from grouped where stage_values>1),
  'invalid_rows_to_quarantine',(select count(*) from invalid),
  'invalid_rows_with_operational_history',(
    select count(*) from invalid
    where has_visits or has_activities or has_locations or has_provider_capture or has_sales
  )
);
$$;

revoke all on function public.spotio_canonical_merge_plan() from public, anon, authenticated;
grant execute on function public.spotio_canonical_merge_plan() to service_role;

create or replace function public.apply_spotio_canonical_merge(
  p_snapshot_token text,
  p_actor_email text default 'system@mccoy.local'
)
returns jsonb
language plpgsql
security definer
set search_path = 'pg_catalog', 'public', 'private'
as $$
declare
  v_plan jsonb;
  v_merged integer := 0;
  v_quarantined integer := 0;
  v_reparented jsonb := '{}'::jsonb;
  v_count integer := 0;
begin
  v_plan := public.spotio_canonical_merge_plan();
  if coalesce(p_snapshot_token,'') <> coalesce(v_plan->>'snapshot_token','') then
    raise exception 'spotio_canonical_snapshot_changed' using errcode='40001';
  end if;
  if coalesce((v_plan->>'conflicting_rep_groups')::integer,0)>0
     or coalesce((v_plan->>'conflicting_manager_groups')::integer,0)>0
     or coalesce((v_plan->>'conflicting_disposition_groups')::integer,0)>0
     or coalesce((v_plan->>'conflicting_stage_groups')::integer,0)>0 then
    raise exception 'spotio_canonical_conflicts_require_review' using errcode='23514';
  end if;
  if coalesce((v_plan->>'invalid_rows_with_operational_history')::integer,0)>0 then
    raise exception 'invalid_spotio_rows_have_operational_history' using errcode='23514';
  end if;

  create temporary table if not exists pg_temp.mccoy_spotio_merge_map (
    duplicate_id uuid primary key,
    canonical_id uuid not null,
    organization_id uuid not null,
    normalized_address_key text not null
  ) on commit drop;
  truncate pg_temp.mccoy_spotio_merge_map;

  insert into pg_temp.mccoy_spotio_merge_map(
    duplicate_id,canonical_id,organization_id,normalized_address_key
  )
  with candidates as (
    select l.*,
      exists(select 1 from public.door_visits v where v.lead_id=l.id and v.status='active') as has_active_visit,
      exists(select 1 from public.door_visits v where v.lead_id=l.id) as has_visit,
      exists(select 1 from public.door_activities a where a.lead_id=l.id) as has_activity,
      exists(select 1 from public.provider_sale_captures c where c.lead_id=l.id) as has_capture,
      exists(select 1 from public.lead_geocode_verifications g where g.lead_id=l.id) as has_geocode_history,
      private.mccoy_normalized_lead_address(l.address1,l.address2,l.city,l.state,l.zip) as address_key
    from public.leads l
    where l.deleted_at is null
      and upper(coalesce(l.source_system,''))='SPOTIO'
      and private.mccoy_spotio_valid_address(l.address1,l.address2,l.city,l.state,l.zip)
  ), ranked as (
    select c.*,
      first_value(c.id) over(
        partition by c.organization_id,c.address_key
        order by
          c.has_active_visit desc,
          c.has_visit desc,
          c.has_activity desc,
          c.has_capture desc,
          (c.assigned_rep_id is not null) desc,
          (c.assigned_manager_id is not null) desc,
          (coalesce(c.attempt_count,0)>0 or c.last_activity_at is not null) desc,
          (coalesce(c.geocode_verification_status,'') in (
            'manual_door_verified','google_verified_preserved','google_address_validation_applied'
          )) desc,
          (c.latitude is not null and c.longitude is not null) desc,
          c.source_last_seen_at desc nulls last,
          c.created_at asc,
          c.id asc
      ) as canonical_id,
      row_number() over(
        partition by c.organization_id,c.address_key
        order by
          c.has_active_visit desc,
          c.has_visit desc,
          c.has_activity desc,
          c.has_capture desc,
          (c.assigned_rep_id is not null) desc,
          (c.assigned_manager_id is not null) desc,
          (coalesce(c.attempt_count,0)>0 or c.last_activity_at is not null) desc,
          (coalesce(c.geocode_verification_status,'') in (
            'manual_door_verified','google_verified_preserved','google_address_validation_applied'
          )) desc,
          (c.latitude is not null and c.longitude is not null) desc,
          c.source_last_seen_at desc nulls last,
          c.created_at asc,
          c.id asc
      ) as duplicate_rank,
      count(*) over(partition by c.organization_id,c.address_key) as copies
    from candidates c
  )
  select id,canonical_id,organization_id,address_key
  from ranked
  where copies>1 and duplicate_rank>1;

  -- Fill the chosen canonical row from the strongest available member without
  -- overwriting McCoy operational values already present on that row.
  with membership as (
    select canonical_id,canonical_id as member_id
    from pg_temp.mccoy_spotio_merge_map
    union
    select canonical_id,duplicate_id
    from pg_temp.mccoy_spotio_merge_map
  ), aggregate_values as (
    select m.canonical_id,
      max(l.assigned_rep_id::text)::uuid as assigned_rep_id,
      max(l.assigned_manager_id::text)::uuid as assigned_manager_id,
      max(l.assigned_admin_email) filter(where l.assigned_admin_email is not null) as assigned_admin_email,
      max(l.assigned_team_id::text)::uuid as assigned_team_id,
      max(l.attempt_count) as attempt_count,
      max(l.last_activity_at) as last_activity_at,
      min(coalesce(l.source_first_seen_at,l.created_at)) as source_first_seen_at,
      max(coalesce(l.source_last_seen_at,l.last_activity_at,l.created_at)) as source_last_seen_at,
      sum(greatest(coalesce(l.source_seen_count,1),1))::integer as source_seen_count,
      (array_agg(l.id order by
        (lower(coalesce(l.current_disposition,'')) not in ('','uncontacted')) desc,
        l.last_activity_at desc nulls last,l.created_at asc
      ))[1] as operational_source_id,
      (array_agg(l.id order by
        (coalesce(l.geocode_verification_status,'') in (
          'manual_door_verified','google_verified_preserved','google_address_validation_applied'
        )) desc,
        (l.latitude is not null and l.longitude is not null) desc,
        l.geocode_verified_at desc nulls last,
        l.source_last_seen_at desc nulls last,
        l.created_at asc
      ))[1] as coordinate_source_id,
      (array_agg(l.id order by
        l.source_last_seen_at desc nulls last,
        l.import_batch_id desc nulls last,
        l.created_at desc
      ))[1] as source_payload_id,
      max(l.provider_lead_id) filter(where nullif(btrim(l.provider_lead_id),'') is not null) as provider_lead_id
    from membership m
    join public.leads l on l.id=m.member_id
    group by m.canonical_id
  )
  update public.leads c
  set assigned_rep_id=coalesce(c.assigned_rep_id,a.assigned_rep_id),
      assigned_manager_id=coalesce(c.assigned_manager_id,a.assigned_manager_id),
      assigned_admin_email=coalesce(c.assigned_admin_email,a.assigned_admin_email),
      assigned_team_id=coalesce(c.assigned_team_id,a.assigned_team_id),
      attempt_count=greatest(coalesce(c.attempt_count,0),coalesce(a.attempt_count,0)),
      last_activity_at=greatest(c.last_activity_at,a.last_activity_at),
      current_disposition=case
        when lower(coalesce(c.current_disposition,'')) in ('','uncontacted')
          then coalesce(op.current_disposition,c.current_disposition)
        else c.current_disposition end,
      last_activity_type=coalesce(c.last_activity_type,op.last_activity_type),
      visit_result=coalesce(c.visit_result,op.visit_result),
      stage=case when coalesce(c.stage,'Prospecting')='Prospecting'
        then coalesce(op.stage,c.stage) else c.stage end,
      pin_color=case when coalesce(c.stage,'Prospecting')='Prospecting'
        then coalesce(op.pin_color,c.pin_color) else c.pin_color end,
      pin_color_source=case when coalesce(c.stage,'Prospecting')='Prospecting'
        then coalesce(op.pin_color_source,c.pin_color_source) else c.pin_color_source end,
      latitude=case when c.latitude is not null and c.longitude is not null
        then c.latitude else coord.latitude end,
      longitude=case when c.latitude is not null and c.longitude is not null
        then c.longitude else coord.longitude end,
      geocode_status=case when c.latitude is not null and c.longitude is not null
        then c.geocode_status else coord.geocode_status end,
      geocode_provider=case when c.latitude is not null and c.longitude is not null
        then c.geocode_provider else coord.geocode_provider end,
      geocode_precision=case when c.latitude is not null and c.longitude is not null
        then c.geocode_precision else coord.geocode_precision end,
      geocode_formatted_address=coalesce(c.geocode_formatted_address,coord.geocode_formatted_address),
      geocode_place_id=coalesce(c.geocode_place_id,coord.geocode_place_id),
      geocode_verified_at=coalesce(c.geocode_verified_at,coord.geocode_verified_at),
      geocode_verification_status=coalesce(c.geocode_verification_status,coord.geocode_verification_status),
      geocode_comparison_distance_meters=coalesce(c.geocode_comparison_distance_meters,coord.geocode_comparison_distance_meters),
      geocode_candidate_latitude=coalesce(c.geocode_candidate_latitude,coord.geocode_candidate_latitude),
      geocode_candidate_longitude=coalesce(c.geocode_candidate_longitude,coord.geocode_candidate_longitude),
      source_payload=coalesce(src.source_payload,c.source_payload),
      source_stage_id=coalesce(src.source_stage_id,c.source_stage_id),
      import_batch_id=coalesce(src.import_batch_id,c.import_batch_id),
      provider_lead_id=coalesce(c.provider_lead_id,a.provider_lead_id),
      canonical_identity_key=private.mccoy_spotio_canonical_identity(
        coalesce(c.provider_lead_id,a.provider_lead_id),
        c.address1,c.address2,c.city,c.state,c.zip
      ),
      source_first_seen_at=least(coalesce(c.source_first_seen_at,a.source_first_seen_at),a.source_first_seen_at),
      source_last_seen_at=greatest(coalesce(c.source_last_seen_at,a.source_last_seen_at),a.source_last_seen_at),
      source_seen_count=greatest(coalesce(a.source_seen_count,1),1)
  from aggregate_values a
  join public.leads op on op.id=a.operational_source_id
  join public.leads coord on coord.id=a.coordinate_source_id
  join public.leads src on src.id=a.source_payload_id
  where c.id=a.canonical_id;

  update public.door_activities x set lead_id=m.canonical_id
  from pg_temp.mccoy_spotio_merge_map m where x.lead_id=m.duplicate_id;
  get diagnostics v_count = row_count;
  v_reparented := v_reparented || jsonb_build_object('door_activities',v_count);

  update public.door_visits x set lead_id=m.canonical_id
  from pg_temp.mccoy_spotio_merge_map m where x.lead_id=m.duplicate_id;
  get diagnostics v_count = row_count;
  v_reparented := v_reparented || jsonb_build_object('door_visits',v_count);

  update public.lead_assignment_history x set lead_id=m.canonical_id
  from pg_temp.mccoy_spotio_merge_map m where x.lead_id=m.duplicate_id;
  get diagnostics v_count = row_count;
  v_reparented := v_reparented || jsonb_build_object('lead_assignment_history',v_count);

  update public.lead_geocode_verifications x set lead_id=m.canonical_id
  from pg_temp.mccoy_spotio_merge_map m where x.lead_id=m.duplicate_id;
  get diagnostics v_count = row_count;
  v_reparented := v_reparented || jsonb_build_object('lead_geocode_verifications',v_count);

  update public.location_events x set lead_id=m.canonical_id
  from pg_temp.mccoy_spotio_merge_map m where x.lead_id=m.duplicate_id;
  get diagnostics v_count = row_count;
  v_reparented := v_reparented || jsonb_build_object('location_events',v_count);

  update public.provider_sale_captures x set lead_id=m.canonical_id
  from pg_temp.mccoy_spotio_merge_map m where x.lead_id=m.duplicate_id;
  get diagnostics v_count = row_count;
  v_reparented := v_reparented || jsonb_build_object('provider_sale_captures',v_count);

  update public.sales_records x set distance_lead_id=m.canonical_id
  from pg_temp.mccoy_spotio_merge_map m where x.distance_lead_id=m.duplicate_id;
  get diagnostics v_count = row_count;
  v_reparented := v_reparented || jsonb_build_object('sales_records',v_count);

  update public.leads child set duplicate_of_lead_id=m.canonical_id
  from pg_temp.mccoy_spotio_merge_map m
  where child.duplicate_of_lead_id=m.duplicate_id;

  with snapshots as (
    select l.id,m.canonical_id,m.normalized_address_key,
      to_jsonb(l) as lead_snapshot
    from public.leads l
    join pg_temp.mccoy_spotio_merge_map m on m.duplicate_id=l.id
    where l.deleted_at is null
  ), updated as (
    update public.leads l
    set deleted_at=clock_timestamp(),
        deleted_by_email=lower(btrim(p_actor_email)),
        deleted_by_role='system',
        deletion_reason='canonical_spotio_merge',
        duplicate_of_lead_id=s.canonical_id
    from snapshots s
    where l.id=s.id
    returning l.id,l.deleted_at,s.canonical_id,s.normalized_address_key,s.lead_snapshot
  ), audited as (
    insert into public.lead_removal_audit(
      lead_id,canonical_lead_id,removed_at,removed_by_email,removed_by_role,
      reason,normalized_address_key,lead_snapshot,metadata
    )
    select id,canonical_id,deleted_at,lower(btrim(p_actor_email)),'system',
      'canonical_spotio_merge',normalized_address_key,lead_snapshot,
      jsonb_build_object('soft_delete',true,'canonical_spotio_merge',true,'references_reparented',true)
    from updated
    returning id
  )
  select count(*)::integer into v_merged from audited;

  with invalid as (
    select l.id,l.normalized_address_key,to_jsonb(l) as lead_snapshot
    from public.leads l
    where l.deleted_at is null
      and upper(coalesce(l.source_system,''))='SPOTIO'
      and not private.mccoy_spotio_valid_address(l.address1,l.address2,l.city,l.state,l.zip)
      and not exists(select 1 from public.door_visits v where v.lead_id=l.id)
      and not exists(select 1 from public.door_activities a where a.lead_id=l.id)
      and not exists(select 1 from public.location_events e where e.lead_id=l.id)
      and not exists(select 1 from public.provider_sale_captures c where c.lead_id=l.id)
      and not exists(select 1 from public.sales_records s where s.distance_lead_id=l.id)
  ), updated as (
    update public.leads l
    set deleted_at=clock_timestamp(),
        deleted_by_email=lower(btrim(p_actor_email)),
        deleted_by_role='system',
        deletion_reason='invalid_spotio_import_row'
    from invalid i
    where l.id=i.id
    returning l.id,l.deleted_at,i.normalized_address_key,i.lead_snapshot
  ), audited as (
    insert into public.lead_removal_audit(
      lead_id,removed_at,removed_by_email,removed_by_role,reason,
      normalized_address_key,lead_snapshot,metadata
    )
    select id,deleted_at,lower(btrim(p_actor_email)),'system',
      'invalid_spotio_import_row',coalesce(normalized_address_key,''),lead_snapshot,
      jsonb_build_object('soft_delete',true,'invalid_spotio_import_row',true,'operational_history',false)
    from updated
    returning id
  )
  select count(*)::integer into v_quarantined from audited;

  update public.leads l
  set canonical_identity_key=private.mccoy_spotio_canonical_identity(
        l.provider_lead_id,l.address1,l.address2,l.city,l.state,l.zip
      ),
      source_first_seen_at=coalesce(l.source_first_seen_at,l.created_at),
      source_last_seen_at=coalesce(l.source_last_seen_at,l.last_activity_at,l.created_at),
      source_seen_count=greatest(coalesce(l.source_seen_count,1),1)
  where l.deleted_at is null
    and upper(coalesce(l.source_system,''))='SPOTIO';

  return jsonb_build_object(
    'ok',true,
    'merged_duplicates',v_merged,
    'quarantined_invalid_rows',v_quarantined,
    'reparented',v_reparented,
    'remaining_active_spotio',(
      select count(*) from public.leads
      where deleted_at is null and upper(coalesce(source_system,''))='SPOTIO'
    )
  );
end;
$$;

revoke all on function public.apply_spotio_canonical_merge(text,text)
  from public, anon, authenticated;
grant execute on function public.apply_spotio_canonical_merge(text,text)
  to service_role;

-- This migration is safe to replay after production canonicalization. It only
-- applies when the current read-only plan reports work and no conflicts.
do $$
declare
  v_plan jsonb;
begin
  v_plan := public.spotio_canonical_merge_plan();
  if coalesce((v_plan->>'duplicate_rows_to_merge')::integer,0)>0
     or coalesce((v_plan->>'invalid_rows_to_quarantine')::integer,0)>0 then
    perform public.apply_spotio_canonical_merge(
      v_plan->>'snapshot_token','system@mccoy.local'
    );
  end if;
end;
$$;

notify pgrst, 'reload schema';
commit;
