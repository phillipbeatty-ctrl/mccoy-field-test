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
const migration=fs.readFileSync(new URL('./supabase/migrations/20260824020000_distance_to_lead_door_workflow.sql',import.meta.url),'utf8')

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
  assert.equal(JSON.stringify(core.autoDispositionForDwell(44_999)),JSON.stringify({visitOutcome:'Visit',contactStatus:'Not Contacted',disposition:'visit'}))
  assert.equal(JSON.stringify(core.autoDispositionForDwell(59_999)),JSON.stringify({visitOutcome:'Visit',contactStatus:'Not Contacted',disposition:'visit'}))
  assert.equal(JSON.stringify(core.autoDispositionForDwell(60_000)),JSON.stringify({visitOutcome:'No Sale',contactStatus:'Contacted',disposition:'no_sale'}))
})

test('provider or manual address is required when outside the lead radius',()=>{
  assert.equal(JSON.stringify(core.saleAddress({withinRange:true,leadAddress:'1 Main St',manualAddress:'',providerAddress:''})),JSON.stringify({address:'1 Main St',source:'lead'}))
  assert.equal(JSON.stringify(core.saleAddress({withinRange:false,leadAddress:'1 Main St',manualAddress:'2 Oak St',providerAddress:''})),JSON.stringify({address:'2 Oak St',source:'manual'}))
  assert.equal(JSON.stringify(core.saleAddress({withinRange:false,leadAddress:'1 Main St',manualAddress:'',providerAddress:'3 Pine St'})),JSON.stringify({address:'3 Pine St',source:'provider'}))
  assert.equal(core.saleAddress({withinRange:false,leadAddress:'1 Main St',manualAddress:'',providerAddress:''}).source,'required')
})

test('server owns non-sale distance enforcement and completed-sale override',()=>{
  assert.match(migration,/v_distance>402\.336 then raise exception 'outside_quarter_mile_sale_only'/)
  assert.match(migration,/if v_disposition<>'sale' then/)
  assert.match(migration,/sales_records_sync_completed_door_workflow/)
  assert.match(migration,/auth_user_id=v_uid/)
  assert.match(migration,/one_active_session_idx/)
  assert.match(migration,/revoke all on public\.door_visits from public,anon,authenticated/)
})
