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
const autoStop=fs.readFileSync(new URL('./app-auto-stop.js',import.meta.url),'utf8')
const resumeClient=fs.readFileSync(new URL('./app-distance-to-lead.js',import.meta.url),'utf8')
const index=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8')

test('stale GPS is visibly last-known and then disappears',()=>{
  const now=1_000_000,gps={lat:45.64,lng:-122.66,accuracy:9,capturedAt:now}
  assert.equal(core.freshness(gps,now+29_999).state,'live')
  assert.equal(core.freshness(gps,now+30_001).state,'signal_lost')
  assert.equal(core.freshness(gps,now+119_999).visible,true)
  assert.equal(core.freshness(gps,now+120_001).visible,false)
  assert.equal(core.evaluateFix(null,null,gps,now+30_001).action,'last_known')
  assert.equal(core.evaluateFix(null,null,gps,now+120_001).action,'expired')
  assert.match(mapUi,/Your last known location/)
  assert.match(mapUi,/The marker is not live/)
})

test('invalid and misleading visual fixes are rejected',()=>{
  assert.equal(core.normalizeGps({lat:91,lng:0,accuracy:4,capturedAt:10}),null)
  assert.equal(core.normalizeGps({lat:45,lng:-122,accuracy:1001,capturedAt:10}),null)
  assert.equal(core.evaluateFix(null,null,{lat:91,lng:0,accuracy:4,capturedAt:10},10).action,'reject')
})

test('GPS jumps require confirmation and a good recovery fix is not delayed',()=>{
  const previous={lat:45,lng:-122,accuracy:8,capturedAt:10_000}
  const impossible={lat:46,lng:-122,accuracy:8,capturedAt:12_000}
  const pending=core.evaluateFix(previous,null,impossible,12_000)
  assert.equal(pending.action,'pending')
  assert.equal(JSON.stringify(pending.pending),JSON.stringify(impossible))

  const recovered={lat:45.00001,lng:-122,accuracy:9,capturedAt:14_000}
  const recovery=core.evaluateFix(previous,pending.pending,recovered,14_000)
  assert.equal(recovery.action,'accept')
  assert.equal(recovery.reason,'recovered')

  const confirmed={lat:46.00005,lng:-122,accuracy:9,capturedAt:14_000}
  const confirmation=core.evaluateFix(previous,pending.pending,confirmed,14_000)
  assert.equal(confirmation.action,'accept')
  assert.equal(confirmation.reason,'confirmed_jump')
  assert.match(mapUi,/GPS jump rejected/)
})

test('permission, timeout, and unavailable failures immediately stop live labeling',()=>{
  assert.equal(core.geolocationErrorReason({code:1}),'permission_denied')
  assert.equal(core.geolocationErrorReason({code:2}),'position_unavailable')
  assert.equal(core.geolocationErrorReason({code:3}),'timeout')
  assert.match(gpsClient,/mccoy-gps-error/)
  assert.match(gpsClient,/publishGpsError\(e,'watch'\)/)
  assert.match(gpsClient,/publishGpsError\(e,'fresh_request'\)/)
  assert.match(mapUi,/addEventListener\('mccoy-gps-error'/)
  assert.match(mapUi,/Location permission is off\. The marker is not live/)
  assert.match(mapUi,/showFix\(lastAccepted,'signal_lost'\)/)
})

test('accuracy is presented separately from self-location state',()=>{
  assert.match(mapUi,/status\.id='liveLocationStatus'/)
  assert.match(mapUi,/accuracy\.id='liveLocationAccuracy'/)
  assert.match(mapUi,/Accuracy: unavailable/)
  assert.match(mapUi,/L\.circle\(/)
})

test('map reload restores only an active session and cannot revive stale GPS as live',()=>{
  const now=500_000
  const fresh={lat:45.64,lng:-122.66,accuracy:7,capturedAt:now-5_000}
  const stale={...fresh,capturedAt:now-45_000}
  assert.equal(core.evaluateFix(null,null,fresh,now).action,'accept')
  assert.equal(core.evaluateFix(null,null,stale,now).action,'last_known')
  assert.match(mapUi,/addEventListener\('pageshow'/)
  assert.match(mapUi,/if\(activeSession\(\)&&state\.latestGps\)receiveFix\(state\.latestGps\)/)
  assert.match(resumeClient,/mccoy-field-session-started/)
  assert.match(resumeClient,/startGpsWatch\(\)/)
})

test('battery protection reuses the session GPS watch and sleeps display timers when hidden',()=>{
  assert.equal((gpsClient.match(/navigator\.geolocation\.watchPosition/g)||[]).length,1)
  assert.match(gpsClient,/navigator\.geolocation\.clearWatch/)
  assert.match(autoStop,/stopGpsWatch\(\)/)
  assert.match(autoStop,/state\.session=null/)
  assert.doesNotMatch(mapUi,/watchPosition|setInterval/)
  assert.match(mapUi,/setTimeout\(/)
  assert.match(mapUi,/addEventListener\('pagehide',clearFreshnessTimer\)/)
  assert.match(mapUi,/visibilityState==='hidden'/)
})

test('self-location marker adds no manager feed, remote read, or local movement trail',()=>{
  assert.match(mapUi,/This marker exists only in your browser/)
  assert.match(mapUi,/Boolean\(state\?\.session\)/)
  assert.match(mapUi,/mccoy-field-session-ended/)
  assert.match(mapUi,/mccoy-gps-update/)
  assert.doesNotMatch(mapUi,/L\.polyline|trail|location_events|supabase|\.from\(|manager|trainer/i)
})

test('one tap on the self-location marker centers and zooms without enabling Follow mode',()=>{
  assert.match(mapUi,/marker\.on\('click',zoomToLocation\)/)
  assert.doesNotMatch(mapUi,/marker\.on\('dblclick'/)
  assert.match(mapUi,/const domEvent=event\?\.originalEvent\|\|event/)
  assert.match(mapUi,/L\.DomEvent\.stop\(domEvent\)/)
  assert.doesNotMatch(mapUi,/L\.DomEvent\.stopPropagation\(event\)/)
  assert.match(mapUi,/iconSize:\[44,44\]/)
  assert.match(mapUi,/Math\.min\(19,Math\.max\(minimumZoom,map\.getZoom\(\)\+zoomStep\)\)/)
  assert.match(mapUi,/map\.stop\?\.\(\);map\.setView\(\[lastAccepted\.lat,lastAccepted\.lng\],targetZoom/)
  assert.match(mapUi,/map\.setView\(\[lastAccepted\.lat,lastAccepted\.lng\],targetZoom/)
  assert.match(mapUi,/Zoomed to your last known location\. The marker is not live/)
  const zoomBody=mapUi.slice(mapUi.indexOf('function centerOnLocation'),mapUi.indexOf('function showFix'))
  assert.doesNotMatch(zoomBody,/setFollow\(/)
})

test('live-location scripts load around the Leaflet map in dependency order',()=>{
  const coreAt=index.indexOf('app-live-location-core.js'),mapAt=index.indexOf('app-lead-map.js'),uiAt=index.indexOf('app-live-location-map.js')
  assert.ok(coreAt>0&&mapAt>coreAt&&uiAt>mapAt)
})
