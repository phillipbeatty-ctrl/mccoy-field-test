begin;

-- Phase 1 created the organization gate before accounting became a distinct
-- entitlement. Existing internal-unlimited organizations must retain accounting
-- access when accounting endpoints stop borrowing the broader admin_controls
-- entitlement. No paid/trial plan is upgraded by this backfill.
insert into public.organization_entitlements(
  organization_id,
  entitlement_key,
  enabled,
  limit_value,
  source,
  created_at,
  updated_at
)
select
  organization.id,
  'accounting',
  true,
  null,
  'internal_unlimited',
  now(),
  now()
from public.organizations organization
where organization.active
  and organization.billing_status='internal_unlimited'
on conflict (organization_id,entitlement_key)
do update set
  enabled=true,
  limit_value=null,
  source='internal_unlimited',
  updated_at=now();

commit;
