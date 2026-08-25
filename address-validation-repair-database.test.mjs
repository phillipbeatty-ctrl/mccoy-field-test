import assert from 'node:assert/strict'
import test from 'node:test'
import {readFile} from 'node:fs/promises'

const migration=await readFile(new URL('./supabase/migrations/20260825050000_guarded_address_validation_pilot_repair.sql',import.meta.url),'utf8')

test('database independently enforces every strict automatic repair signal',()=>{
  for(const signal of [
    "possible_next_action'='ACCEPT'","address_complete","validation_granularity","geocode_granularity",
    "usps_dpv_confirmation","address_identity_match","has_unconfirmed_components","has_inferred_components",
    "has_replaced_components","has_spell_corrected_components","unresolved_token_count","missing_component_types",
    "place_id","v_distance between 0 and 100"
  ])assert.match(migration,new RegExp(signal.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')))
})

test('repair is service-role-only, audited, idempotent, and preserves review coordinates',()=>{
  assert.match(migration,/security definer/)
  assert.match(migration,/service_role_required/)
  assert.match(migration,/revoke all on function public\.apply_address_validation_pilot_repair[\s\S]*from public,anon,authenticated/)
  assert.match(migration,/operation_key/)
  assert.match(migration,/on conflict \(operation_key\)[\s\S]*do nothing/)
  assert.match(migration,/previous_latitude,previous_longitude/)
  assert.match(migration,/geocode_verification_status='address_validation_admin_review'/)
  assert.match(migration,/if v_apply then[\s\S]*set latitude=v_candidate_latitude/)
})

test('repair rejects stale snapshots and protects manual or field placements',()=>{
  assert.match(migration,/lead_changed_after_pilot_snapshot/)
  assert.match(migration,/manual_door_verified/)
  assert.match(migration,/field_verified/)
  assert.match(migration,/for update/)
  assert.match(migration,/jsonb_array_length\(p_rows\) <> 100/)
})
