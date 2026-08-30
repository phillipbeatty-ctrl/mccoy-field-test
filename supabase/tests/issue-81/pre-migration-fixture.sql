\set ON_ERROR_STOP on

insert into public.organizations(id, name)
values ('81818181-0000-0000-0000-000000000001', 'Issue 81 legacy backfill fixture');

insert into public.leads(
  id, organization_id, source_system, source_id,
  provider, provider_lead_id, canonical_identity_key,
  address1, address2, city, state, zip,
  current_disposition, stage, created_at
) values
(
  '81818181-0000-0000-0000-000000000101',
  '81818181-0000-0000-0000-000000000001',
  'SPOTIO', 'legacy-provider-row',
  null, 'LEGACY-1', 'provider:legacy-1',
  '500 Legacy Street', null, 'Portland', 'OR', '97206',
  'Follow Up', 'Interested', '2026-08-01T12:00:00Z'
),
(
  '81818181-0000-0000-0000-000000000102',
  '81818181-0000-0000-0000-000000000001',
  'SPOTIO', 'legacy-address-row',
  null, null, null,
  '501 Legacy Road', 'Apartment 2', 'Portland', 'OR', '97206-1234',
  'Interested', 'Follow Up', '2026-08-02T12:00:00Z'
);
