import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const read = path => readFile(new URL(path, import.meta.url), 'utf8')

const [
  importFunction,
  leadAdmin,
  foundation,
  backfill,
  upsert,
] = await Promise.all([
  read('./supabase/functions/spotio-import/index.ts'),
  read('./supabase/functions/lead-admin/index.ts'),
  read('./supabase/migrations/20260830050000_spotio_canonical_import_foundation.sql'),
  read('./supabase/migrations/20260830051000_spotio_canonical_backfill.sql'),
  read('./supabase/migrations/20260830052000_spotio_additive_import_upsert.sql'),
])

// Every import is additive. Omission from a later capture is not deletion.
assert.match(importFunction, /retention_mode:\s*'additive_missing_retained'/)
assert.match(importFunction, /import_batch_is_provenance_only:\s*true/)
assert.match(importFunction, /mccoy_upsert_spotio_batch_v1/)
assert.match(importFunction, /created/)
assert.match(importFunction, /updated/)
assert.match(importFunction, /unchanged/)
assert.match(importFunction, /collisions/)
assert.match(importFunction, /quarantined/)
assert.doesNotMatch(importFunction, /DOM:\$\{[^}]*batch/i)

// Lead visibility is based on organization and assignment scope—not one batch.
assert.match(leadAdmin, /scope = 'organization_all'/)
assert.match(leadAdmin, /scope = 'manager_pool'/)
assert.match(leadAdmin, /scope = 'rep_assigned'/)
assert.match(leadAdmin, /import_batch_is_provenance_only:\s*true/)
assert.match(leadAdmin, /\.eq\('organization_id', organizationId\)/)
assert.match(leadAdmin, /\.eq\('assigned_manager_id', profile\.id\)/)
assert.match(leadAdmin, /\.eq\('assigned_rep_id', profile\.id\)/)
assert.doesNotMatch(leadAdmin, /canonicalSpotio/)
assert.doesNotMatch(leadAdmin, /import_batch_id\.in/)

// Stable provider identity wins; normalized street+unit+city+state+ZIP is fallback.
assert.match(foundation, /provider_lead_id/)
assert.match(foundation, /canonical_identity_key/)
assert.match(foundation, /mccoy_spotio_canonical_identity/)
assert.match(foundation, /mccoy_normalized_lead_address/)
assert.match(foundation, /spotio_import_results/)

// Existing duplicate records are merged without dropping operational references.
for (const table of [
  'door_activities',
  'door_visits',
  'lead_assignment_history',
  'lead_geocode_verifications',
  'location_events',
  'provider_sale_captures',
  'sales_records',
]) assert.match(backfill, new RegExp(`update public\\.${table}`))
assert.match(backfill, /canonical_spotio_merge/)
assert.match(backfill, /invalid_spotio_import_row/)
assert.match(backfill, /spotio_canonical_conflicts_require_review/)
assert.match(backfill, /soft_delete/)

// Future uploads preserve operational state and are idempotent.
assert.match(upsert, /leads_active_spotio_provider_uidx/)
assert.match(upsert, /leads_active_spotio_canonical_uidx/)
assert.match(upsert, /leads_active_spotio_address_uidx/)
assert.match(upsert, /assignment_preserved/)
assert.match(upsert, /disposition_preserved/)
assert.match(upsert, /verified_coordinates_preserved/)
assert.match(upsert, /explicitly_archived_lead_retained/)
assert.match(upsert, /retained_prior_leads/)
assert.match(upsert, /active_canonical_identity_changed_during_import/)

console.log('SPOTIO additive canonical import contracts passed')
