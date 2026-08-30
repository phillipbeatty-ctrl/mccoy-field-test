\set ON_ERROR_STOP on

insert into public.organizations(id, name)
values ('81818181-0000-0000-0000-000000000099', 'Issue 81 collision guard fixture');

insert into public.leads(
  id, organization_id, source_system, source_id,
  address1, address2, city, state, zip,
  current_disposition, stage
) values
(
  '81818181-0000-0000-0000-000000009901',
  '81818181-0000-0000-0000-000000000099',
  'SPOTIO', 'guard-collision-1',
  '10 Guard Street', null, 'Portland', 'OR', '97206',
  'Uncontacted', 'Prospecting'
),
(
  '81818181-0000-0000-0000-000000009902',
  '81818181-0000-0000-0000-000000000099',
  'SPOTIO', 'guard-collision-2',
  '10 Guard St.', null, 'Portland', 'OR', '97206-0001',
  'Follow Up', 'Interested'
);
