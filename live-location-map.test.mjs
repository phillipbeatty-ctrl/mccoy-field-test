import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

function loadCore(){
  const context={globalThis:{},module:{exports:{}}}
  vm.runInNewContext(fs.readFileSync(new URL('./app-live-location-core.js',import.meta.url),'utf8'),context)
  return context.module.exports
}

const core=loadCore()
const mapUi=fs.readFileSync(new URL('./app-live-location-map.js',import.meta.url),'utf8')
const gpsClient=fs.readFileSync(new URL('./app-part1.js',import.meta.url),'utf8')
const index=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8')

test('live location becomes stale gracefully and then disappears',()=>{
  const now=1_000_000,gps={lat:45.64,lng:-122.66,accuracy:9,capturedAt:now}
  assert.equal(core.freshness(gps,now+29_999).state,'live')
  assert.equal(core.freshness(gps,now+30_001).state,'signal_lost')
  assert.equal(core.freshness(gps,now+119_999).visible,true)
  assert.equal(core.freshness(gps,now+120_001).visible,false)
})

test('invalid or misleading visual fixes are rejected',()=>{
  assert.equal(core.normalizeGps({lat:91,lng:0,accuracy:4,capturedAt:10}),null)
  assert.equal(core.normalizeGps({lat:45,lng:-122,accuracy:1001,capturedAt:10}),null)
  const first={lat:45,lng:-122,accuracy:8,capturedAt:10_000}
  const impossible={lat:46,lng:-122,accuracy:8,capturedAt:12_000}
  const nearby={lat:46.0001,lng:-122,accuracy:9,capturedAt:14_000}
  assert.equal(core.isImplausibleJump(first,impossible),true)
  assert.equal(core.confirmsJump(impossible,nearby),true)
})

test('trail sampling limits visual noise without losing movement',()=>{
  const first={lat:45,lng:-122,accuracy:5,capturedAt:10_000}
  assert.equal(core.shouldAppendTrail(null,first),true)
  assert.equal(core.shouldAppendTrail(first,{...first,capturedAt:12_000}),false)
  assert.equal(core.shouldAppendTrail(first,{lat:45.0001,lng:-122,accuracy:5,capturedAt:12_000}),true)
  assert.equal(core.shouldAppendTrail(first,{...first,capturedAt:20_000}),true)
})

test('map tracking is self-only, session-bound, and reuses the existing GPS watch',()=>{
  assert.match(mapUi,/Only you see this map marker/)
  assert.match(mapUi,/Boolean\(state\?\.session\)/)
  assert.match(mapUi,/mccoy-field-session-ended/)
  assert.match(mapUi,/mccoy-gps-update/)
  assert.match(mapUi,/L\.circle\(/)
  assert.match(mapUi,/L\.polyline\(/)
  assert.doesNotMatch(mapUi,/watchPosition|location_events|supabase|\.from\(/i)
  assert.match(gpsClient,/publishGpsUpdate\(state\.latestGps,'watch'\)/)
  assert.equal((gpsClient.match(/navigator\.geolocation\.watchPosition/g)||[]).length,1)
})

test('live-location scripts load around the Leaflet map in dependency order',()=>{
  const coreAt=index.indexOf('app-live-location-core.js'),mapAt=index.indexOf('app-lead-map.js'),uiAt=index.indexOf('app-live-location-map.js')
  assert.ok(coreAt>0&&mapAt>coreAt&&uiAt>mapAt)
})
