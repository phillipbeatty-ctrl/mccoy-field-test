import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import test from 'node:test'

const read=path=>readFile(new URL(path,import.meta.url),'utf8')

const [migration,permissionMigration,client,indexHtml,edge]=await Promise.all([
  read('./supabase/migrations/20260901033000_organization_access_paywall_gate.sql'),
  read('./supabase/migrations/20260901033100_organization_access_policy_execute_permission.sql'),
  read('./app-organization-access-gate.js'),
  read('./index.html'),
  read('./supabase/functions/organization-access/index.ts')
])

test('database gate combines organization, billing, entitlement, period, grace, and seat state',()=>{
  assert.match(migration,/organization_access_state\s*\(/)
  assert.match(migration,/billing_status='internal_unlimited'/)
  assert.match(migration,/billing_status='trial_active'/)
  assert.match(migration,/current_period_end<=now\(\)/)
  assert.match(migration,/billing_status='paid_active'/)
  assert.match(migration,/billing_status='past_due_grace'/)
  assert.match(migration,/grace_period_end<=now\(\)/)
  assert.match(migration,/entitlement_disabled/)
  assert.match(migration,/seat_limit_exceeded/)
  assert.match(migration,/purchase_model', 'organization_managed_external'/)
  assert.match(migration,/purchase_action_available', false/)
})

test('active legacy access rows are backfilled into memberships',()=>{
  assert.match(migration,/insert into public\.organization_memberships/)
  assert.match(migration,/join auth\.users auth_user/)
  assert.match(migration,/not exists \(\s*select 1\s*from public\.organization_memberships existing/)
})

test('RLS receives a restrictive organization subscription gate',()=>{
  assert.match(migration,/create policy organization_subscription_gate/)
  assert.match(migration,/as restrictive for all to authenticated/)
  assert.match(migration,/private\.organization_access_allowed\(organization_id,%L\)/)
  assert.match(permissionMigration,/grant execute on function private\.organization_access_allowed\(uuid,text\) to authenticated/)
})

test('client blocks the original access-ready event until verified',()=>{
  assert.match(client,/event\.stopImmediatePropagation\(\)/)
  assert.match(client,/window\.MCCOY_ACCESS=\{user:current\.user,access:null\}/)
  assert.match(client,/sb\.functions\.invoke\('organization-access'/)
  assert.match(client,/organization_access_verified/)
  assert.match(client,/purchase_action_available:false/)
  assert.doesNotMatch(client,/stripe|checkout|subscribe now|buy now/i)
})

test('organization gate loads before application modules',()=>{
  const gate=indexHtml.indexOf('app-organization-access-gate.js')
  const firstApp=indexHtml.indexOf('app-part1.js')
  const auth=indexHtml.indexOf('app-auth.js')
  assert.ok(gate>=0,'organization gate script missing')
  assert.ok(gate<firstApp,'organization gate must load before app-part1')
  assert.ok(gate<auth,'organization gate must load before app-auth')
})

test('Edge endpoint validates JWT and restricts entitlement names',()=>{
  assert.match(edge,/admin\.auth\.getUser\(jwt\)/)
  assert.match(edge,/ENTITLEMENTS=new Set/)
  assert.match(edge,/service_organization_access_state/)
  assert.match(edge,/'Cache-Control':'no-store'/)
})
