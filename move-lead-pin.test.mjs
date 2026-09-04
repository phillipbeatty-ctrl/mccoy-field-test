import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration=fs.readFileSync(new URL('./supabase/migrations/20260903190000_move_lead_pin_transaction.sql',import.meta.url),'utf8');
const edge=fs.readFileSync(new URL('./supabase/functions/lead-admin/index.ts',import.meta.url),'utf8');
const map=fs.readFileSync(new URL('./app-lead-map.js',import.meta.url),'utf8');
const leads=fs.readFileSync(new URL('./app-real-leads.js',import.meta.url),'utf8');
const deselect=fs.readFileSync(new URL('./app-lead-map-deselect.js',import.meta.url),'utf8');

test('server exposes only the narrow move action to field roles',()=>{
  assert.match(edge,/action === 'move_lead_pin'/);
  assert.match(edge,/db\.rpc\('move_lead_pin'/);
  assert.match(migration,/revoke all on function public\.move_lead_pin\([^)]+\) from public, anon, authenticated/);
  assert.match(migration,/grant execute on function public\.move_lead_pin\([^)]+\) to service_role/);
  assert.match(migration,/security invoker/);
  assert.match(edge,/p_actor_user_id: profile\.id/);
  assert.doesNotMatch(map,/action:'update_lead'[^\n]*proposed_latitude/);
});

test('transaction locks the lead and rejects stale state',()=>{
  assert.match(migration,/where id = p_lead_id for update/);
  assert.match(migration,/v_lead\.pin_location_updated_at is distinct from p_expected_updated_at/);
  assert.match(migration,/v_lead\.latitude is distinct from p_original_latitude/);
  assert.match(migration,/'rejected','stale_lead'/);
});

test('role matrix is assignment scoped and excludes tester',()=>{
  assert.match(migration,/v_role = 'admin'/);
  assert.match(migration,/v_role in \('manager','trainer'\) and v_lead\.assigned_manager_id = p_actor_user_id/);
  assert.match(migration,/v_role = 'rep' and v_lead\.assigned_rep_id = p_actor_user_id/);
  assert.doesNotMatch(migration,/v_role = 'tester'[^\n]*v_authorized := true/);
  assert.match(migration,/'rejected','unauthorized_lead'/);
});

test('audit preserves old, proposed, saved, actor GPS, distance and assignment',()=>{
  for(const field of ['old_latitude','old_longitude','proposed_latitude','proposed_longitude','saved_latitude','saved_longitude','actor_user_id','actor_role','actor_accuracy_meters','gps_captured_at','moved_distance_meters','actor_distance_meters','assignment_snapshot'])assert.match(migration,new RegExp(field));
  assert.match(migration,/client_request_id uuid not null unique/);
});

test('non-admin confirmation requires a fresh GPS fix',()=>{
  assert.match(migration,/v_gps_required boolean := true/);
  assert.match(migration,/interval '30 seconds'/);
  assert.match(migration,/'fresh_gps_required'/);
  assert.match(map,/maximumAge:0,timeout:10000/);
});

test('mobile move mode previews before explicit confirmation',()=>{
  assert.match(map,/>MOVE PIN</);
  assert.match(map,/>CONFIRM LOCATION</);
  assert.match(map,/min-height:48px/);
  assert.match(map,/correctionMarker\.on\('dragend',[\s\S]*movePinProposed=/);
  assert.doesNotMatch(map,/correctionMarker\.on\('dragend',async/);
  assert.match(map,/document\.getElementById\('confirmLeadPinBtn'\)\.onclick=confirmMovePin/);
  assert.match(map,/window\.MCCOY_MAP_MOVE_PIN_ACTIVE=true/);
  assert.match(deselect,/MCCOY_MAP_MOVE_PIN_ACTIVE/);
});

test('lead list carries optimistic concurrency version to the client',()=>{
  assert.match(edge,/'latitude','longitude','pin_location_updated_at'/);
  assert.match(leads,/updatedAt:r\.pin_location_updated_at/);
  assert.match(map,/expected_updated_at:l\.updatedAt/);
});
