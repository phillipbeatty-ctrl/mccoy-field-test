import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const context={globalThis:{},module:{exports:{}}};
vm.runInNewContext(fs.readFileSync(new URL('./app-lead-address-core.js',import.meta.url),'utf8'),context);
const core=context.module.exports;
const migration=fs.readFileSync(new URL('./supabase/migrations/20260824080000_typed_ad_hoc_lead_dispositions.sql',import.meta.url),'utf8');
const client=fs.readFileSync(new URL('./app-part2.js',import.meta.url),'utf8');
const distance=fs.readFileSync(new URL('./app-distance-to-lead.js',import.meta.url),'utf8');
const typedUi=fs.readFileSync(new URL('./app-typed-lead-address.js',import.meta.url),'utf8');
const autoArrival=fs.readFileSync(new URL('./app-auto-door-arrival.js',import.meta.url),'utf8');
const providerRouter=fs.readFileSync(new URL('./app-provider-sale-router.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8');

const leads=[
  {id:1,dbId:'a',address:'123 Main St',city:'Portland',stateCode:'OR',zip:'97201',fullAddress:'123 Main St, Portland, OR 97201'},
  {id:2,dbId:'b',address:'55 Oak Ave',city:'Raleigh',stateCode:'NC',zip:'27601',fullAddress:'55 Oak Ave, Raleigh, NC 27601'}
];

test('assigned addresses resolve to scoped leads while unmatched addresses remain ad-hoc',()=>{
  const assigned=core.context({value:'123 Main St, Portland, OR 97201',leads});
  assert.equal(assigned.kind,'assigned');assert.equal(assigned.lead.dbId,'a');
  const typed=core.context({value:' 900 Outside Area Road, Boise, ID 83702 ',leads});
  assert.equal(typed.kind,'typed');assert.equal(typed.lead,null);assert.equal(typed.address,'900 Outside Area Road, Boise, ID 83702');
});

test('typed addresses are bounded, sanitized, and never impersonate a database lead',()=>{
  assert.equal(core.context({value:'x',leads}).kind,'invalid');
  const adHoc=core.adHocLead('9 New\nAddress Road');
  assert.equal(adHoc.dbId,null);assert.equal(adHoc.isAdHoc,true);assert.equal(adHoc.selectionSource,'typed_address');assert.equal(adHoc.address,'9 New Address Road');
  assert.ok(core.cleanAddress('z'.repeat(400)).length<=core.MAX_ADDRESS_LENGTH);
});

test('server creates an owned-session typed-address audit without lead membership or area restriction',()=>{
  assert.match(migration,/record_ad_hoc_door_visit_start/);
  assert.match(migration,/coalesce\(v_access\.role,''\) not in \('admin','manager','trainer','rep','tester'\)/);
  assert.match(migration,/tester_user_id=v_uid and ended_at is null/);
  assert.match(migration,/p_accuracy_meters>150/);
  assert.match(migration,/'selection_source','typed_address'/);
  assert.match(migration,/'assigned_area_required',false/);
  assert.match(migration,/'lead_pool_membership_created',false/);
  assert.match(migration,/revoke all on function public\.record_ad_hoc_door_visit_start[\s\S]+from public,anon/);
  assert.match(migration,/grant execute on function public\.record_ad_hoc_door_visit_start[\s\S]+to authenticated/);
});

test('non-sale typed-address completion keeps fresh GPS but skips assigned-lead distance only for the explicit source',()=>{
  assert.match(migration,/v_is_typed:=v_visit\.selection_source='typed_address' and v_visit\.lead_id is null/);
  assert.match(migration,/if p_gps_captured_at is null[\s\S]+fresh_current_location_required/);
  assert.match(migration,/if not v_is_typed then[\s\S]+outside_quarter_mile_sale_only/);
  assert.match(migration,/'selection_source',v_visit\.selection_source/);
  assert.match(migration,/typed-address activities require fresh GPS but may be completed inside or outside assigned areas/);
});

test('Sales Hub routes typed addresses through the dedicated RPC and preserves sale context',()=>{
  assert.match(client,/isTyped\?'record_ad_hoc_door_visit_start':'record_door_visit_start'/);
  assert.match(client,/p_service_address:addressContext\.address/);
  assert.match(distance,/selectionSource:'typed_address'/);
  assert.match(providerRouter,/selection_source:typedAddress\?'typed_address':null/);
  assert.match(typedUi,/not added to your assigned lead list/);
  assert.match(autoArrival,/MCCOY_LEAD_ADDRESS\?\.current\?\.\(\)\.kind==='typed'/);
});

test('typed-address scripts load before the shared distance and sales workflows',()=>{
  const coreAt=html.indexOf('app-lead-address-core.js'),uiAt=html.indexOf('app-typed-lead-address.js'),distanceAt=html.indexOf('app-distance-to-lead.js'),salesAt=html.indexOf('app-sales.js');
  assert.ok(coreAt>0&&uiAt>coreAt&&distanceAt>uiAt&&salesAt>distanceAt);
});
