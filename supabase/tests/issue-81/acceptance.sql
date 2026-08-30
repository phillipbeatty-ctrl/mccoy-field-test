\set ON_ERROR_STOP on

create schema if not exists issue81_test;

create or replace function issue81_test.assert_true(p_condition boolean, p_message text)
returns void
language plpgsql
as $$
begin
  if not coalesce(p_condition, false) then
    raise exception 'ISSUE81_ASSERTION_FAILED: %', p_message;
  end if;
end;
$$;

do $acceptance$
declare
  v_org uuid := '81818181-0000-0000-0000-000000000002';
  v_admin uuid := '81818181-0000-0000-0000-000000000201';
  v_manager uuid := '81818181-0000-0000-0000-000000000202';
  v_rep uuid := '81818181-0000-0000-0000-000000000203';
  v_batch_a uuid := '81818181-0000-0000-0000-000000001001';
  v_batch_b uuid := '81818181-0000-0000-0000-000000001002';
  v_batch_c uuid := '81818181-0000-0000-0000-000000001003';
  v_batch_d uuid := '81818181-0000-0000-0000-000000001004';
  v_result jsonb;
  v_missing jsonb;
  v_count integer;
  v_lead_id uuid;
  v_archived_at timestamptz := '2026-08-29T00:00:00Z';
  v_summary jsonb;
begin
  -- Existing production-style rows are safely backfilled by the migrations.
  perform issue81_test.assert_true(
    (select provider = 'SPOTIO'
       and canonical_identity_key = 'provider:legacy-1'
       and fallback_identity_key = 'address:spotio|500 legacy st||97206'
     from public.leads
     where id = '81818181-0000-0000-0000-000000000101'),
    'provider-ID legacy row was not backfilled safely'
  );
  perform issue81_test.assert_true(
    (select provider = 'SPOTIO'
       and canonical_identity_key = 'address:spotio|501 legacy rd|unit 2|97206'
       and fallback_identity_key = 'address:spotio|501 legacy rd|unit 2|97206'
     from public.leads
     where id = '81818181-0000-0000-0000-000000000102'),
    'fallback-identity legacy row was not backfilled safely'
  );
  perform issue81_test.assert_true(
    (select current_disposition = 'Follow Up' and stage = 'Interested'
     from public.leads
     where id = '81818181-0000-0000-0000-000000000101'),
    'legacy operational state changed during backfill'
  );

  insert into public.organizations(id, name)
  values (v_org, 'Issue 81 sequential upload acceptance');
  insert into public.users(id, organization_id, email, role)
  values
    (v_admin, v_org, 'owner@mccoy.test', 'admin'),
    (v_manager, v_org, 'manager@mccoy.test', 'manager'),
    (v_rep, v_org, 'rep@mccoy.test', 'rep');

  -- Upload A: five new leads.
  insert into public.spotio_import_batches(
    id, organization_id, uploaded_by, uploaded_by_email,
    source_filename, raw_payload, record_count, status
  ) values (
    v_batch_a, v_org, v_admin, 'owner@mccoy.test',
    'upload-a.json', '{"source_type":"spotio_json"}'::jsonb, 5, 'received'
  );

  v_result := public.mccoy_upsert_spotio_batch_v1(v_batch_a, $json$[
    {"provider":"Brightspeed","provider_lead_id":"A-1","address1":"101 Main Street","city":"Town","state":"OR","zip":"97001","phone":"111"},
    {"provider":"Brightspeed","provider_lead_id":"A-2","address1":"102 Main Street","city":"Town","state":"OR","zip":"97001"},
    {"provider":"Brightspeed","provider_lead_id":"A-3","address1":"103 Main Street","city":"Town","state":"OR","zip":"97001"},
    {"provider":"Brightspeed","address1":"104 Main Street","address2":"Apt 2","city":"Town","state":"OR","zip":"97001"},
    {"address1":"105 Main Street","city":"Town","state":"OR","zip":"97001"}
  ]$json$::jsonb, 0);
  v_missing := public.mccoy_classify_spotio_missing_retained_v1(v_batch_a, 5);

  perform issue81_test.assert_true((v_result->>'created')::integer = 5, 'Upload A did not create five leads');
  perform issue81_test.assert_true((v_result->>'updated')::integer = 0, 'Upload A unexpectedly updated a lead');
  perform issue81_test.assert_true((v_result->>'unchanged')::integer = 0, 'Upload A unexpectedly classified an unchanged lead');
  perform issue81_test.assert_true((v_result->>'collisions')::integer = 0, 'Upload A produced a collision');
  perform issue81_test.assert_true((v_missing->>'missing_retained')::integer = 0, 'Upload A reported missing retained leads');
  perform issue81_test.assert_true(
    (select count(*) = 5 from public.leads where organization_id = v_org and deleted_at is null),
    'Upload A did not leave five active leads'
  );
  perform issue81_test.assert_true(
    (select provider = 'SPOTIO' and canonical_identity_key like 'address:spotio|%'
     from public.leads where organization_id = v_org and address1 = '105 Main Street'),
    'missing provider metadata did not use the SPOTIO namespace'
  );

  -- Apply field state to two Upload A leads before Upload B.
  update public.leads
  set assigned_rep_id = v_rep,
      assigned_manager_id = v_manager,
      assigned_admin_email = 'owner@mccoy.test',
      current_disposition = 'Follow Up',
      stage = 'Interested',
      last_activity_type = 'Contacted',
      visit_result = 'Appointment',
      latitude = 45.5001,
      longitude = -122.6001,
      geocode_status = 'manual',
      geocode_provider = 'manual',
      geocode_verification_status = 'manual_door_verified'
  where organization_id = v_org and provider_lead_id = 'A-1';

  update public.leads
  set assigned_rep_id = v_rep,
      assigned_manager_id = v_manager,
      assigned_admin_email = 'owner@mccoy.test',
      current_disposition = 'Interested',
      stage = 'Follow Up',
      last_activity_type = 'Contacted',
      visit_result = 'Return Visit'
  where organization_id = v_org and address1 = '104 Main Street';

  -- Upload B: two new, one updated, two unchanged, and two omitted.
  insert into public.spotio_import_batches(
    id, organization_id, uploaded_by, uploaded_by_email,
    source_filename, raw_payload, record_count, status
  ) values (
    v_batch_b, v_org, v_admin, 'owner@mccoy.test',
    'upload-b.json', '{"source_type":"spotio_json"}'::jsonb, 5, 'received'
  );

  v_result := public.mccoy_upsert_spotio_batch_v1(v_batch_b, $json$[
    {"provider":"Brightspeed","provider_lead_id":"A-1","address1":"101 Main Street","city":"Town","state":"OR","zip":"97001","phone":"999","latitude":44.0,"longitude":-121.0},
    {"provider":"Brightspeed","provider_lead_id":"A-2","address1":"102 Main Street","city":"Town","state":"OR","zip":"97001"},
    {"provider":"Brightspeed","provider_lead_id":"A-3","address1":"103 Main Street","city":"Town","state":"OR","zip":"97001"},
    {"provider":"Brightspeed","provider_lead_id":"A-6","address1":"106 Main Street","city":"Town","state":"OR","zip":"97001"},
    {"provider":"Brightspeed","provider_lead_id":"A-7","address1":"107 Main Street","city":"Town","state":"OR","zip":"97001"}
  ]$json$::jsonb, 0);
  v_missing := public.mccoy_classify_spotio_missing_retained_v1(v_batch_b, 5);

  perform issue81_test.assert_true((v_result->>'created')::integer = 2, 'Upload B did not create two leads');
  perform issue81_test.assert_true((v_result->>'updated')::integer = 1, 'Upload B did not update exactly one lead');
  perform issue81_test.assert_true((v_result->>'unchanged')::integer = 2, 'Upload B did not classify two unchanged leads');
  perform issue81_test.assert_true((v_result->>'collisions')::integer = 0, 'Upload B produced a collision');
  perform issue81_test.assert_true((v_missing->>'missing_retained')::integer = 2, 'Upload B did not retain two omitted leads');
  perform issue81_test.assert_true(
    (select count(*) = 7 from public.leads where organization_id = v_org and deleted_at is null),
    'Upload B did not leave seven unique active leads'
  );
  perform issue81_test.assert_true(
    (select count(*) = 2
     from public.leads
     where organization_id = v_org and deleted_at is null and import_batch_id = v_batch_a),
    'omitted Upload A leads did not retain prior provenance'
  );
  perform issue81_test.assert_true(
    (select assigned_rep_id = v_rep
       and assigned_manager_id = v_manager
       and assigned_admin_email = 'owner@mccoy.test'
       and current_disposition = 'Follow Up'
       and stage = 'Interested'
       and latitude = 45.5001
       and longitude = -122.6001
       and phone = '999'
     from public.leads
     where organization_id = v_org and provider_lead_id = 'A-1'),
    'Upload B failed to preserve assignment, disposition, or verified coordinates on A-1'
  );
  perform issue81_test.assert_true(
    (select assigned_rep_id = v_rep
       and assigned_manager_id = v_manager
       and current_disposition = 'Interested'
       and stage = 'Follow Up'
       and import_batch_id = v_batch_a
     from public.leads
     where organization_id = v_org and address1 = '104 Main Street'),
    'omitted assigned lead lost field state or provenance'
  );
  perform issue81_test.assert_true(
    (select count(*) = 2 from public.spotio_import_results
     where batch_id = v_batch_b and action = 'missing_retained'),
    'Upload B missing-retained classifications were not stored'
  );

  -- Re-upload B as a new batch: zero duplicates and five unchanged records.
  insert into public.spotio_import_batches(
    id, organization_id, uploaded_by, uploaded_by_email,
    source_filename, raw_payload, record_count, status
  ) values (
    v_batch_c, v_org, v_admin, 'owner@mccoy.test',
    'upload-b-repeat.json', '{"source_type":"spotio_json"}'::jsonb, 5, 'received'
  );

  v_result := public.mccoy_upsert_spotio_batch_v1(v_batch_c, $json$[
    {"provider":"Brightspeed","provider_lead_id":"A-1","address1":"101 Main Street","city":"Town","state":"OR","zip":"97001","phone":"999","latitude":44.0,"longitude":-121.0},
    {"provider":"Brightspeed","provider_lead_id":"A-2","address1":"102 Main Street","city":"Town","state":"OR","zip":"97001"},
    {"provider":"Brightspeed","provider_lead_id":"A-3","address1":"103 Main Street","city":"Town","state":"OR","zip":"97001"},
    {"provider":"Brightspeed","provider_lead_id":"A-6","address1":"106 Main Street","city":"Town","state":"OR","zip":"97001"},
    {"provider":"Brightspeed","provider_lead_id":"A-7","address1":"107 Main Street","city":"Town","state":"OR","zip":"97001"}
  ]$json$::jsonb, 0);
  v_missing := public.mccoy_classify_spotio_missing_retained_v1(v_batch_c, 5);

  perform issue81_test.assert_true((v_result->>'created')::integer = 0, 're-upload created a duplicate lead');
  perform issue81_test.assert_true((v_result->>'updated')::integer = 0, 're-upload unexpectedly updated a lead');
  perform issue81_test.assert_true((v_result->>'unchanged')::integer = 5, 're-upload did not classify five unchanged leads');
  perform issue81_test.assert_true((v_missing->>'missing_retained')::integer = 2, 're-upload did not retain the two omitted leads');
  perform issue81_test.assert_true(
    (select count(*) = 7 from public.leads where organization_id = v_org and deleted_at is null),
    're-upload changed the seven-lead live pool'
  );

  -- Incomplete capture: one row may update provenance, but six other active leads remain.
  insert into public.spotio_import_batches(
    id, organization_id, uploaded_by, uploaded_by_email,
    source_filename, raw_payload, record_count, status
  ) values (
    v_batch_d, v_org, v_admin, 'owner@mccoy.test',
    'partial-capture.json', '{"source_type":"spotio_json","capture":"partial"}'::jsonb, 1, 'incomplete'
  );

  v_result := public.mccoy_upsert_spotio_batch_v1(v_batch_d, $json$[
    {"provider":"Brightspeed","provider_lead_id":"A-1","address1":"101 Main Street","city":"Town","state":"OR","zip":"97001","phone":"999","latitude":44.0,"longitude":-121.0}
  ]$json$::jsonb, 0);
  v_missing := public.mccoy_classify_spotio_missing_retained_v1(v_batch_d, 1);
  perform issue81_test.assert_true((v_result->>'unchanged')::integer = 1, 'partial capture did not classify the supplied lead as unchanged');
  perform issue81_test.assert_true((v_missing->>'missing_retained')::integer = 6, 'partial capture did not retain the six omitted leads');
  perform issue81_test.assert_true(
    (select count(*) = 7 from public.leads where organization_id = v_org and deleted_at is null),
    'partial/incomplete capture hid or removed a prior active lead'
  );

  -- Stable provider ID wins when the service address changes.
  insert into public.organizations(id, name)
  values ('81818181-0000-0000-0000-000000000003', 'Issue 81 provider-ID address change');
  insert into public.spotio_import_batches(id, organization_id, uploaded_by, uploaded_by_email, source_filename, raw_payload, record_count)
  values
    ('81818181-0000-0000-0000-000000002001', '81818181-0000-0000-0000-000000000003', v_admin, 'owner@mccoy.test', 'old-address.json', '{}'::jsonb, 1),
    ('81818181-0000-0000-0000-000000002002', '81818181-0000-0000-0000-000000000003', v_admin, 'owner@mccoy.test', 'new-address.json', '{}'::jsonb, 1);
  perform public.mccoy_upsert_spotio_batch_v1('81818181-0000-0000-0000-000000002001', '[{"provider":"Brightspeed","provider_lead_id":"STABLE-44","address1":"1 Old Road","city":"Town","state":"OR","zip":"97001"}]'::jsonb, 0);
  v_result := public.mccoy_upsert_spotio_batch_v1('81818181-0000-0000-0000-000000002002', '[{"provider":"Brightspeed","provider_lead_id":"STABLE-44","address1":"2 New Road","city":"Town","state":"OR","zip":"97002"}]'::jsonb, 0);
  perform issue81_test.assert_true((v_result->>'updated')::integer = 1, 'stable provider ID did not update a changed address');
  perform issue81_test.assert_true(
    (select count(*) = 1 and max(address1) = '2 New Road'
     from public.leads where organization_id = '81818181-0000-0000-0000-000000000003' and deleted_at is null),
    'provider-ID address change created a duplicate or failed to update'
  );

  -- Provider-ID and fallback-address disagreement must classify a collision without mutation.
  insert into public.organizations(id, name)
  values ('81818181-0000-0000-0000-000000000004', 'Issue 81 collision behavior');
  insert into public.spotio_import_batches(id, organization_id, uploaded_by, uploaded_by_email, source_filename, raw_payload, record_count)
  values
    ('81818181-0000-0000-0000-000000003001', '81818181-0000-0000-0000-000000000004', v_admin, 'owner@mccoy.test', 'collision-seed.json', '{}'::jsonb, 2),
    ('81818181-0000-0000-0000-000000003002', '81818181-0000-0000-0000-000000000004', v_admin, 'owner@mccoy.test', 'collision-attempt.json', '{}'::jsonb, 1);
  perform public.mccoy_upsert_spotio_batch_v1('81818181-0000-0000-0000-000000003001', '[
    {"provider":"Brightspeed","provider_lead_id":"P-1","address1":"10 First Street","city":"Town","state":"OR","zip":"97001"},
    {"provider":"Brightspeed","provider_lead_id":"P-2","address1":"20 Second Street","city":"Town","state":"OR","zip":"97001"}
  ]'::jsonb, 0);
  v_result := public.mccoy_upsert_spotio_batch_v1('81818181-0000-0000-0000-000000003002', '[{"provider":"Brightspeed","provider_lead_id":"P-1","address1":"20 Second Street","city":"Town","state":"OR","zip":"97001"}]'::jsonb, 0);
  perform issue81_test.assert_true((v_result->>'collisions')::integer = 1, 'provider/address disagreement was not classified as a collision');
  perform issue81_test.assert_true(
    (select count(*) = 2 from public.leads where organization_id = '81818181-0000-0000-0000-000000000004' and deleted_at is null),
    'collision attempt inserted, merged, or archived a lead'
  );
  perform issue81_test.assert_true(
    (select address1 = '10 First Street' from public.leads where organization_id = '81818181-0000-0000-0000-000000000004' and provider_lead_id = 'P-1'),
    'collision attempt mutated the provider-ID match'
  );

  -- Manual archive remains archived on re-import.
  insert into public.organizations(id, name)
  values ('81818181-0000-0000-0000-000000000005', 'Issue 81 manual archive behavior');
  insert into public.spotio_import_batches(id, organization_id, uploaded_by, uploaded_by_email, source_filename, raw_payload, record_count)
  values
    ('81818181-0000-0000-0000-000000004001', '81818181-0000-0000-0000-000000000005', v_admin, 'owner@mccoy.test', 'archive-seed.json', '{}'::jsonb, 1),
    ('81818181-0000-0000-0000-000000004002', '81818181-0000-0000-0000-000000000005', v_admin, 'owner@mccoy.test', 'archive-repeat.json', '{}'::jsonb, 1);
  perform public.mccoy_upsert_spotio_batch_v1('81818181-0000-0000-0000-000000004001', '[{"provider":"Brightspeed","provider_lead_id":"ARCH-1","address1":"88 Archive Road","city":"Town","state":"OR","zip":"97001"}]'::jsonb, 0);
  select id into v_lead_id from public.leads where organization_id = '81818181-0000-0000-0000-000000000005' and provider_lead_id = 'ARCH-1';
  update public.leads set deleted_at = v_archived_at, deletion_reason = 'manual' where id = v_lead_id;
  v_result := public.mccoy_upsert_spotio_batch_v1('81818181-0000-0000-0000-000000004002', '[{"provider":"Brightspeed","provider_lead_id":"ARCH-1","address1":"88 Archive Road","city":"Town","state":"OR","zip":"97001"}]'::jsonb, 0);
  perform issue81_test.assert_true((v_result->>'archived')::integer = 1, 'manual archive was not classified as archived');
  perform issue81_test.assert_true(
    (select deleted_at = v_archived_at and deletion_reason = 'manual' from public.leads where id = v_lead_id),
    'manual archive was revived or altered'
  );

  -- Missing provider and explicit SPOTIO provider resolve to the same permanent lead.
  insert into public.organizations(id, name)
  values ('81818181-0000-0000-0000-000000000006', 'Issue 81 default provider namespace');
  insert into public.spotio_import_batches(id, organization_id, uploaded_by, uploaded_by_email, source_filename, raw_payload, record_count)
  values
    ('81818181-0000-0000-0000-000000005001', '81818181-0000-0000-0000-000000000006', v_admin, 'owner@mccoy.test', 'implicit-provider.json', '{}'::jsonb, 1),
    ('81818181-0000-0000-0000-000000005002', '81818181-0000-0000-0000-000000000006', v_admin, 'owner@mccoy.test', 'explicit-provider.json', '{}'::jsonb, 1);
  perform public.mccoy_upsert_spotio_batch_v1('81818181-0000-0000-0000-000000005001', '[{"address1":"77 Default Road","city":"Town","state":"OR","zip":"97206"}]'::jsonb, 0);
  v_result := public.mccoy_upsert_spotio_batch_v1('81818181-0000-0000-0000-000000005002', '[{"provider":"SPOTIO","address1":"77 Default Road","city":"Town","state":"OR","zip":"97206"}]'::jsonb, 0);
  perform issue81_test.assert_true((v_result->>'unchanged')::integer = 1, 'explicit SPOTIO provider did not match the implicit namespace lead');
  perform issue81_test.assert_true(
    (select count(*) = 1 and max(provider) = 'SPOTIO'
     from public.leads where organization_id = '81818181-0000-0000-0000-000000000006' and deleted_at is null),
    'default provider namespace created a duplicate lead'
  );

  select jsonb_build_object(
    'backfill_rows', (select count(*) from public.leads where organization_id = '81818181-0000-0000-0000-000000000001'),
    'upload_a_active', 5,
    'upload_b_active', (select count(*) from public.leads where organization_id = v_org and deleted_at is null),
    'upload_b_missing_retained', (select count(*) from public.spotio_import_results where batch_id = v_batch_b and action = 'missing_retained'),
    'repeat_created', (select created_count from public.spotio_import_batches where id = v_batch_c),
    'partial_missing_retained', (select missing_retained_count from public.spotio_import_batches where id = v_batch_d),
    'collision_count', (select collision_count from public.spotio_import_batches where id = '81818181-0000-0000-0000-000000003002'),
    'manual_archive_retained', (select count(*) from public.leads where id = v_lead_id and deleted_at = v_archived_at),
    'status', 'PASS'
  ) into v_summary;

  raise notice 'ISSUE81_ACCEPTANCE_PASS %', v_summary;
end;
$acceptance$;

select
  source_filename,
  status,
  created_count,
  updated_count,
  unchanged_count,
  collision_count,
  archived_count,
  missing_retained_count
from public.spotio_import_batches
where organization_id = '81818181-0000-0000-0000-000000000002'
order by created_at, id;
