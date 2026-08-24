import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

function loadCore(){
  const context={globalThis:{},module:{exports:{}}}
  vm.runInNewContext(fs.readFileSync(new URL('./app-door-workflow-core.js',import.meta.url),'utf8'),context)
  return context.module.exports
}

const core=loadCore()
const schemaMigration=fs.readFileSync(new URL('./supabase/migrations/20260824020000_distance_to_lead_door_workflow.sql',import.meta.url),'utf8')
const migration=fs.readFileSync(new URL('./supabase/migrations/20260824152622_coaching_only_door_location.sql',import.meta.url),'utf8')

test('quarter-mile boundary and closest verified lead are deterministic',()=>{
  assert.equal(core.QUARTER_MILE_METERS,402.336)
  const now=Date.now(),gps={lat:45,lng:-122,accuracy:8,capturedAt:now}
  const near={dbId:'a',lat:45.0001,lng:-122,geocodeStatus:'exact'}
  const far={dbId:'b',lat:45.001,lng:-122,geocodeStatus:'exact'}
  const approximate={dbId:'c',lat:45,lng:-122,geocodeStatus:'approx_zip'}
  assert.equal(core.nearestLead([far,approximate,near],gps).lead.dbId,'a')
  assert.equal(core.distanceState(near,gps).withinRange,true)
})

test('automatic disposition is conservative until a full minute',()=>{
  assert.equal(JSON.stringify(core.autoDispositionForDwell(44_999)),JSON.stringify({activityType:'Visit',visitResult:'No Answer',stage:null,visitOutcome:'No Answer',contactStatus:'Not Contacted',disposition:'visit'}))
  assert.equal(JSON.stringify(core.autoDispositionForDwell(59_999)),JSON.stringify({activityType:'Visit',visitResult:'No Answer',stage:null,visitOutcome:'No Answer',contactStatus:'Not Contacted',disposition:'visit'}))
  assert.equal(JSON.stringify(core.autoDispositionForDwell(60_000)),JSON.stringify({activityType:'Visit',visitResult:'Contacted',stage:null,visitOutcome:'Contacted',contactStatus:'Contacted',disposition:'no_sale'}))
})

test('SPOTIO-style disposition labels and colors stay exact',()=>{
  assert.equal(JSON.stringify(core.ACTIVITY_TYPES),JSON.stringify(['Visit','Call','Appointment','Text','Qualify','Investigate & Estimate','Make a Proposal','Get Feedback']))
  assert.equal(JSON.stringify(core.VISIT_RESULTS.map(item=>[item.label,item.color])),JSON.stringify([['No Answer','#fbbf24'],['Contacted','#9ca3af'],['Follow-Up','#3b82f6']]))
  assert.equal(JSON.stringify(core.STAGES.map(item=>[item.label,item.color])),JSON.stringify([
    ['Prospecting','#fbbf24'],['Hot Lead','#c4b5fd'],['Contacted','#93c5fd'],['Follow Up','#1d4ed8'],['Migrator','#f97316'],
    ['Existing Customer','#ffffff'],['SMB','#ec4899'],['Sale Made','#22c55e'],['No Sale','#9ca3af'],['Admin Hold','#581c87']
  ]))
})

test('Stage wins only when supplied in the same save',()=>{
  assert.equal(JSON.stringify(core.pinState({visitResult:'Follow-Up'})),JSON.stringify({label:'Follow-Up',color:'#3b82f6',source:'visit_result'}))
  assert.equal(JSON.stringify(core.pinState({visitResult:'No Answer',stage:'Hot Lead'})),JSON.stringify({label:'Hot Lead',color:'#c4b5fd',source:'stage'}))
  assert.equal(JSON.stringify(core.pinState({previousColor:'#123456',previousSource:'legacy'})),JSON.stringify({label:null,color:'#123456',source:'legacy'}))
})

test('provider or manual address is required when outside the lead radius',()=>{
  assert.equal(JSON.stringify(core.saleAddress({withinRange:true,leadAddress:'1 Main St',manualAddress:'',providerAddress:''})),JSON.stringify({address:'1 Main St',source:'lead'}))
  assert.equal(JSON.stringify(core.saleAddress({withinRange:false,leadAddress:'1 Main St',manualAddress:'2 Oak St',providerAddress:''})),JSON.stringify({address:'2 Oak St',source:'manual'}))
  assert.equal(JSON.stringify(core.saleAddress({withinRange:false,leadAddress:'1 Main St',manualAddress:'',providerAddress:'3 Pine St'})),JSON.stringify({address:'3 Pine St',source:'provider'}))
  assert.equal(core.saleAddress({withinRange:false,leadAddress:'1 Main St',manualAddress:'',providerAddress:''}).source,'required')
})

test('server records distance for coaching without using it as disposition authorization',()=>{
  assert.doesNotMatch(migration,/raise exception 'outside_quarter_mile_sale_only'/)
  assert.doesNotMatch(migration,/raise exception 'verified_lead_location_required'/)
  assert.match(migration,/'quarter_mile_coaching_threshold_meters',402\.336/)
  assert.match(migration,/'door_location_authorization_required',false/)
  assert.match(migration,/auth_user_id=v_uid/)
  assert.match(migration,/open_owned_field_session_required/)
  assert.match(migration,/owned_door_visit_not_found/)
  assert.match(schemaMigration,/sales_records_sync_completed_door_workflow/)
  assert.match(schemaMigration,/one_active_session_idx/)
  assert.match(schemaMigration,/revoke all on public\.door_visits from public,anon,authenticated/)
})
