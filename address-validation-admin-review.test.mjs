import assert from 'node:assert/strict'
import test from 'node:test'
import {readFile} from 'node:fs/promises'

const edge=await readFile(new URL('./supabase/functions/address-validation-admin-review/index.ts',import.meta.url),'utf8')
const migration=await readFile(new URL('./supabase/migrations/20260825083000_address_validation_admin_review_decisions.sql',import.meta.url),'utf8')

test('Admin review Edge Function requires authenticated active Admin access',()=>{
  assert.match(edge,/admin\.auth\.getUser\(jwt\)/)
  assert.match(edge,/access\.role!=='admin'/)
  assert.match(edge,/address_validation_admin_review/)
})

test('Admin review API only supports explicit keep or apply decisions',()=>{
  assert.match(edge,/\['keep_original','apply_google_candidate'\]/)
  assert.match(edge,/apply_address_validation_admin_review_decision/)
  assert.doesNotMatch(edge,/service_role.*return json\(\{ok:true/)
})

test('database review decision is service-role-only and protects field-confirmed pins',()=>{
  assert.match(migration,/service_role_required/)
  assert.match(migration,/field_confirmed_pin_protected/)
  assert.match(migration,/lead_not_pending_address_validation_admin_review/)
  assert.match(migration,/revoke all on function public\.apply_address_validation_admin_review_decision/)
  assert.match(migration,/grant execute on function public\.apply_address_validation_admin_review_decision[\s\S]*to service_role/)
})

test('Admin decision preserves an immutable audit before changing a pin',()=>{
  assert.match(migration,/insert into public\.lead_geocode_verifications/)
  assert.match(migration,/on conflict \(operation_key\).*do nothing/)
  assert.match(migration,/admin_approved_google_candidate/)
  assert.match(migration,/admin_kept_original_pin/)
})
