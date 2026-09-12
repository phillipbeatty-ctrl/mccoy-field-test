import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const router=fs.readFileSync(new URL('./app-provider-sale-router.js',import.meta.url),'utf8')
const distance=fs.readFileSync(new URL('./app-distance-to-lead.js',import.meta.url),'utf8')
const captureFunction=fs.readFileSync(new URL('./supabase/functions/provider-sale-capture/index.ts',import.meta.url),'utf8')
const auditMigration=fs.readFileSync(new URL('./supabase/migrations/20260828053500_allow_customer_list_return_to_review_audit.sql',import.meta.url),'utf8')

function loadDoorCore(){
  const context={globalThis:{},module:{exports:{}}}
  vm.runInNewContext(fs.readFileSync(new URL('./app-door-workflow-core.js',import.meta.url),'utf8'),context)
  return context.module.exports
}

const core=loadDoorCore()

test('provider dashboard opens in a separately closable tab with same-tab fallback',()=>{
  assert.match(router,/window\.open\('about:blank',target\)/)
  assert.match(router,/mccoy_provider_\$\{Date\.now\(\)\}/)
  assert.match(router,/Return to Field Coach when finished, then choose the green check or red X/)
  assert.match(router,/trackProviderWindow\(reservedWindow\)/)
  assert.match(router,/markCaptureReturned\(true\)/)
  assert.match(router,/window\.location\.assign\(destination\.url\)/)
})

test('nearest lead considers all usable mapped McCoy leads but excludes known low-precision candidates',()=>{
  const now=Date.now(),gps={lat:45,lng:-122,accuracy:8,capturedAt:now}
  const imported={dbId:'imported',lat:45.0001,lng:-122,geocodeStatus:'matched',isDemo:false}
  const rooftop={dbId:'rooftop',lat:45.0002,lng:-122,geocodeStatus:'google_rooftop',isDemo:false}
  const lowPrecision={dbId:'low',lat:45,lng:-122,geocodeStatus:'google_low_precision',isDemo:false}
  const demo={dbId:'demo',lat:45,lng:-122,geocodeStatus:'manual',isDemo:true}
  assert.equal(core.nearestCandidateLead(imported),true)
  assert.equal(core.nearestCandidateLead(rooftop),true)
  assert.equal(core.nearestCandidateLead(lowPrecision),false)
  assert.equal(core.nearestCandidateLead(demo),false)
  assert.equal(core.nearestLead([lowPrecision,rooftop,imported,demo],gps).lead.dbId,'imported')
})

test('Door Workflow retains nearest selection behind the paused release switch',()=>{
  assert.match(distance,/if\(nearest\)\{if\(String\(select\.value\)!==String\(nearest\.lead\.id\)\)chooseLead\(nearest\.lead,true\);\}/)
  assert.doesNotMatch(distance,/nearest&&nearest\.distance<=core\.QUARTER_MILE_METERS/)
  assert.match(distance,/function useClosest\(\).*if\(nearest\)chooseLead\(nearest\.lead,true\)/s)
  assert.match(distance,/Automatic arrival remains restricted to field\/manual-verified pins/)
})

test('starting SALE supersedes older unfinished captures for the same user',()=>{
  assert.match(captureFunction,/Older unfinished attempts/)
  assert.match(captureFunction,/\.eq\('rep_user_id', user\.id\)/)
  assert.match(captureFunction,/\.in\('status', \['dashboard_opened', 'details_required'\]\)/)
  assert.match(captureFunction,/status: 'cancelled'/)
})

test('Customer List return-to-review is a permitted Admin audit action',()=>{
  assert.match(auditMigration,/return_to_review/)
  assert.match(auditMigration,/action in \('edit','approve','return_to_review'\)/)
})

