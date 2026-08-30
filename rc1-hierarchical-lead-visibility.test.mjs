import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const read = path => readFile(new URL(path, import.meta.url), 'utf8')
const [leadAdmin, addressSearch, realLeads, accessFix, migration] = await Promise.all([
  read('./supabase/functions/lead-admin/index.ts'),
  read('./supabase/functions/lead-map-address-search/index.ts'),
  read('./app-real-leads.js'),
  read('./app-lead-map-access-fix.js'),
  read('./supabase/migrations/20260830043000_hierarchical_lead_visibility.sql'),
])

assert.match(leadAdmin, /scopeName = 'organization_all'/)
assert.match(leadAdmin, /scopeName = 'manager_pool'/)
assert.match(leadAdmin, /scopeName = 'rep_assigned'/)
assert.match(leadAdmin, /\.eq\('organization_id', access\.organization_id\)/)
assert.match(leadAdmin, /\.eq\('assigned_manager_id', profile\.id\)/)
assert.match(leadAdmin, /\.eq\('assigned_rep_id', profile\.id\)/)
assert.match(leadAdmin, /ADMIN_ACTIONS = new Set\(\[/)
assert.match(leadAdmin, /'delete_lead'/)
assert.doesNotMatch(leadAdmin, /Every active field account may view, disposition, and clean up real leads/)

assert.match(addressSearch, /kind: 'manager_pool'/)
assert.match(addressSearch, /kind: 'rep_assigned'/)
assert.match(addressSearch, /exact_authorized_address/)
assert.match(addressSearch, /google_place_id_authorized/)
assert.match(addressSearch, /\.eq\('assigned_rep_id', scope\.rep_id\)/)

assert.match(realLeads, /lead_scope_mismatch/)
assert.match(realLeads, /state\.realLeads=\[\]/)
assert.match(realLeads, /No leads are assigned to this account/)
assert.match(realLeads, /role-scoped Lead Pool loaded through lead-admin/)

for (const id of [
  'mapAssignLabel',
  'mapRepSelect',
  'bulkAssignMapBtn',
  'lassoSelectBtn',
  'selectVisiblePinsBtn',
  'clearMapSelectionBtn',
  'mapSelectionStatus',
]) {
  assert.match(accessFix, new RegExp(`#${id}|getElementById\\('${id}'\\)`))
}
assert.match(accessFix, /body\.lead-pool-rep-layout/)
assert.match(accessFix, /mapView\.textContent=assigner\?'MAP \/ ASSIGN':'MAP'/)
assert.match(accessFix, /Open lead map and assignment tools':'Open lead map'/)
assert.match(accessFix, /view its service address and disposition/)
assert.match(accessFix, /heading\.textContent=assigner\?'Map Assignment':'Lead Details'/)
assert.match(accessFix, /checkDuplicateLeadsBtn/)
assert.doesNotMatch(accessFix, /MutationObserver/)

assert.match(migration, /create policy leads_select_scope/)
assert.match(migration, /private\.current_rep_manager_id\(\)/)
assert.match(migration, /private\.current_rep_admin_email\(\)/)
assert.match(migration, /lead_outside_assigned_scope/)
assert.match(migration, /record_lead_pool_pin_disposition_internal/)
assert.match(migration, /revoke all on function public\.get_closest_mccoy_lead[\s\S]*from public, anon/)
assert.match(migration, /leads_org_manager_assignment_scope_idx/)
assert.match(migration, /leads_org_rep_assignment_scope_idx/)

console.log('RC1 hierarchical Lead Pool access contracts passed')
