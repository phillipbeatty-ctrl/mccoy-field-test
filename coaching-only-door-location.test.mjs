import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration=fs.readFileSync(new URL('./supabase/migrations/20260824152622_coaching_only_door_location.sql',import.meta.url),'utf8');
const client=fs.readFileSync(new URL('./app-part2.js',import.meta.url),'utf8');
const detail=fs.readFileSync(new URL('./app-lead-detail-panel.js',import.meta.url),'utf8');

test('GPS quality, door geocode, and quarter-mile distance are never authorization failures',()=>{
  for(const blocker of ['valid_current_location_required','usable_location_accuracy_required','fresh_current_location_required','verified_lead_location_required','outside_quarter_mile_sale_only']){
    assert.doesNotMatch(migration,new RegExp(`raise exception '${blocker}'`));
  }
  assert.match(migration,/'door_location_authorization_required',false/);
  assert.match(migration,/'door_location_coaching_only',true/);
});

test('security and workflow integrity gates remain in place',()=>{
  assert.match(migration,/authentication_required/);
  assert.match(migration,/active_mccoy_account_required/);
  assert.match(migration,/open_owned_field_session_required/);
  assert.match(migration,/field_session_expired/);
  assert.match(migration,/owned_door_visit_not_found/);
  assert.match(migration,/invalid_door_disposition/);
  assert.match(migration,/invalid_typed_address_audit/);
  assert.match(migration,/revoke all on function public\.record_door_visit_start[\s\S]+from public,anon/);
  assert.match(migration,/grant execute on function public\.record_door_visit_completion[\s\S]+to authenticated/);
});

test('client records available location without waiting for or requiring a fresh fix',()=>{
  const start=client.slice(client.indexOf('window.MCCOY_START_DOOR_VISIT'),client.indexOf('window.MCCOY_COMPLETE_DOOR_VISIT'));
  const complete=client.slice(client.indexOf('window.MCCOY_COMPLETE_DOOR_VISIT'),client.indexOf("document.getElementById('arriveDoorBtn')?.addEventListener"));
  assert.match(client,/function gpsAuditParams\(gps\)/);
  assert.match(start,/requestFreshGpsInBackground\?\.\(\)/);
  assert.doesNotMatch(start,/Promise\.race|await getGPSOnce|if\(!gps\)|distanceState\(/);
  assert.match(complete,/requestFreshGpsInBackground\?\.\(\)/);
  assert.doesNotMatch(complete,/Promise\.race|await getGPSOnce/);
  assert.match(start,/\.\.\.gpsParams/);
  assert.match(complete,/\.\.\.gpsParams/);
});

test('users are told unverified door location is a coaching signal rather than a failed save',()=>{
  assert.match(client,/Door location not verified; disposition remains available/);
  assert.match(client,/Door location not verified; the disposition was still saved/);
  assert.match(detail,/Disposition is allowed regardless of door verification/);
  assert.match(detail,/verified-sale rules still apply/);
});
