import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const providerReturn=readFileSync(new URL('./app-provider-return-focus.js',import.meta.url),'utf8')
const closestLead=readFileSync(new URL('./app-closest-lead-autofill.js',import.meta.url),'utf8')
const layout=readFileSync(new URL('./app-page-layout.js',import.meta.url),'utf8')
const migration=readFileSync(new URL('./supabase/migrations/20260828043000_closest_mccoy_lead_rpc.sql',import.meta.url),'utf8')

test('provider dashboard close and app-return signals reopen Provider Outcome',()=>{
  assert.match(providerReturn,/providerWindow\?\.closed/)
  assert.match(providerReturn,/visibilitychange/)
  assert.match(providerReturn,/pageshow/)
  assert.match(providerReturn,/action:'mark_returned'/)
  assert.match(providerReturn,/mccoy-provider-sale-returned/)
  assert.match(providerReturn,/window\.focus\(\)/)
  assert.doesNotMatch(providerReturn,/MutationObserver/)
})

test('empty address auto-fill asks the database for the closest organization lead',()=>{
  assert.match(closestLead,/get_closest_mccoy_lead/)
  assert.match(closestLead,/selectedAddressAlreadyPresent\(\)/)
  assert.match(closestLead,/mccoy-closest-lead-autofilled/)
  assert.match(closestLead,/event\.isTrusted/)
  assert.doesNotMatch(closestLead,/MutationObserver/)
})

test('nearest lead RPC ignores assignment while preserving active access and organization scope',()=>{
  assert.match(migration,/active_access_required/)
  assert.match(migration,/organization_id/)
  assert.match(migration,/tenant_id/)
  assert.match(migration,/order by distance_meters/)
  assert.doesNotMatch(migration,/assigned_rep_email\s*=/)
  assert.match(migration,/grant execute .* authenticated/i)
})

test('preview loader includes both new controls and leaves production merge gated',()=>{
  assert.match(layout,/app-provider-return-focus\.js\?v=2026082801/)
  assert.match(layout,/app-closest-lead-autofill\.js\?v=2026082801/)
})
