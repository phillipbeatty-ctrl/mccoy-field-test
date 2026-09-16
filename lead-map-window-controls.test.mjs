import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const controls=fs.readFileSync(new URL('./app-lead-map-window-controls.js',import.meta.url),'utf8')
const entryFix=fs.readFileSync(new URL('./app-lead-map-window-entry-fix.js',import.meta.url),'utf8')
const viewportLock=fs.readFileSync(new URL('./app-map-viewport-lock.js',import.meta.url),'utf8')
const manualMap=fs.readFileSync(new URL('./app-map-manual-control.js',import.meta.url),'utf8')
const independent=fs.readFileSync(new URL('./app-lead-pool-independent-activity.js',import.meta.url),'utf8')
const map=fs.readFileSync(new URL('./app-lead-map.js',import.meta.url),'utf8')
const detail=fs.readFileSync(new URL('./app-lead-detail-panel.js',import.meta.url),'utf8')
const html=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8')
const loader=fs.readFileSync(new URL('./app-page-layout.js',import.meta.url),'utf8')
const worker=fs.readFileSync(new URL('./service-worker.js',import.meta.url),'utf8')

test('traffic-light controls use icons, stable accessible meanings, and one-hand touch targets',()=>{
  assert.match(controls,/aria-label="MAXIMIZE MAP"/)
  assert.match(controls,/aria-label="LEAD ACTIONS"/)
  assert.match(controls,/aria-label="RESTORE MAP"/)
  assert.doesNotMatch(controls,/aria-label="CLOSE|>CLOSE</)
  assert.match(controls,/min-width:44px!important/)
  assert.match(controls,/min-height:44px!important/)
  assert.match(controls,/map-window-lamp-green/)
  assert.match(controls,/map-window-lamp-yellow/)
  assert.match(controls,/map-window-lamp-red/)
  assert.match(controls,/touch-action:manipulation/)
})

test('Lead Pool stays standard until MOVE PIN is explicitly selected',()=>{
  assert.match(controls,/mode=STANDARD/)
  assert.doesNotMatch(entryFix,/mccoy-real-leads-loaded[^\n]*maximize|pageshow[^\n]*maximize|view==='leads'[^\n]*maximize/s)
  assert.match(entryFix,/leadMapMovePinLauncher/)
  assert.match(controls,/MOVE_PIN_READY='move-pin-ready'/)
  assert.match(controls,/handleControl\(maximize,'MAXIMIZE'/)
  assert.match(controls,/handleControl\(actions,'ACTIONS'/)
  assert.match(controls,/handleControl\(restore,'RESTORE'/)
})

test('Standard MOVE PIN calls first-class controller transition directly',()=>{
  assert.match(entryFix,/MCCOY_LEAD_MAP_WINDOW\?\.beginMovePin\?\.\(selectedLeadId\)/)
  assert.doesNotMatch(entryFix,/leadMapActionsBtn/)
  assert.doesNotMatch(entryFix,/leadMapMovePinAction/)
  assert.doesNotMatch(entryFix,/\.maximize\?\.\(\)/)
  assert.doesNotMatch(entryFix,/requestAnimationFrame/)
  assert.doesNotMatch(entryFix,/\.click\(\)/)
  assert.match(controls,/function beginMovePin\(leadId\)/)
  assert.match(controls,/const resolved=leadId\?leadById\(leadId\):selectedLead/)
  assert.match(controls,/movePinLeadId=String\(resolved\.dbId\|\|resolved\.id\)/)
  assert.match(controls,/MCCOY_MAP_VIEWPORT_LOCK\?\.acquire\?\.\('move-pin',movePinLeadId\)/)
  assert.match(controls,/mode=MOVE_PIN_READY;sync\(\);showHint\('MOVE PIN'\);triggerUnderlyingMove\(\);return true/)
})

test('MOVE PIN locks the workflow to the original lead until confirm or cancel',()=>{
  assert.match(controls,/let mode=STANDARD,expanded=false,selectedLead=null,movePinLeadId=null/)
  assert.match(controls,/if\(movePinLeadId&&String\(nextId\?\?''\)!==String\(movePinLeadId\)\)return/)
  assert.match(controls,/getMovePinLeadId:\(\)=>movePinLeadId/)
  assert.match(controls,/function releaseMovePinOwnership\(\)/)
  assert.match(controls,/mccoy-map-move-pin-ended[^\n]*releaseMovePinOwnership\(\)/)
})

test('nearest-lead automation is disabled at the source while MOVE PIN owns the viewport',()=>{
  assert.match(independent,/function autoSelectNearest\(\)\{\s*if\(!autoNearestEnabled\(\)\)return;\s*if\(window\.MCCOY_MAP_VIEWPORT_LOCK\?\.owner\?\.\(\)==='move-pin'\)return;/)
  assert.match(independent,/function scheduleAutoSelect\(delay=150\)\{\s*clearTimeout\(autoSelectTimer\);\s*if\(!autoNearestEnabled\(\)\)return;\s*if\(manualViewportHold\|\|window\.MCCOY_MAP_VIEWPORT_LOCK\?\.owner\?\.\(\)==='move-pin'\)return;/)
  assert.match(independent,/MCCOY_MAP_VIEWPORT_LOCK\?\.blocksSelection\?\.\(nextId\)/)
  assert.match(independent,/MCCOY_MAP_VIEWPORT_LOCK\?\.blocksSelection\?\.\(id\)/)
  assert.match(independent,/mccoy-map-viewport-lock-changed/)
  assert.match(independent,/clearTimeout\(autoSelectTimer\)/)
})

test('MOVE PIN viewport lock blocks every automatic Leaflet camera method',()=>{
  assert.match(viewportLock,/\['setView','panTo','fitBounds','flyTo','flyToBounds'\]/)
  assert.match(viewportLock,/if\(isMovePinOwner\(\)\)return this/)
  assert.match(viewportLock,/lockedLeadId=leadId==null\?null:String\(leadId\)/)
  assert.match(viewportLock,/blocksSelection:id=>isMovePinOwner\(\)&&!sameLead\(id\)/)
  assert.match(viewportLock,/leadId:\(\)=>lockedLeadId/)
})

test('MOVE PIN viewport lock turns location follow off but leaves GPS collection untouched',()=>{
  const acquireStart=viewportLock.indexOf("function acquire(nextOwner='move-pin',leadId=null)")
  const acquireEnd=viewportLock.indexOf('function release',acquireStart)
  assert.ok(acquireStart>=0&&acquireEnd>acquireStart)
  const acquireBody=viewportLock.slice(acquireStart,acquireEnd)
  assert.ok(acquireBody.indexOf('stopLocationFollow()')<acquireBody.indexOf('owner=nextOwner'))
  assert.match(viewportLock,/followMyLocationBtn/)
  assert.doesNotMatch(viewportLock,/navigator\.geolocation|mccoy-gps-update|receiveFix/)
})

test('manual map browsing no longer fakes lead selection',()=>{
  assert.doesNotMatch(manualMap,/__mccoy_map_browse__/)
  assert.doesNotMatch(manualMap,/mccoy-map-lead-selected/)
  assert.match(manualMap,/pauseLocationFollow/)
})

test('viewport and nearest-selection guards are loaded with fresh mobile cache keys',()=>{
  assert.match(loader,/app-lead-pool-independent-activity\.js\?v=2026091108/)
  assert.match(loader,/app-map-viewport-lock\.js\?v=2026090402/)
  assert.match(worker,/field-coach-app-shell-v25-20260914-photo-outcome-fixes/)
  assert.match(worker,/app-lead-pool-independent-activity\.js\?v=2026091108/)
  assert.match(worker,/app-map-viewport-lock\.js\?v=2026090402/)
})

test('beginMovePin state transition maximizes and reveals compact MOVE PIN without yellow Actions',()=>{
  const beginStart=controls.indexOf('function beginMovePin(leadId)')
  const beginEnd=controls.indexOf('function mountWorkflow',beginStart)
  assert.ok(beginStart>=0&&beginEnd>beginStart)
  const beginBody=controls.slice(beginStart,beginEnd)
  assert.match(beginBody,/mode=MOVE_PIN_READY/)
  assert.match(beginBody,/sync\(\)/)
  assert.doesNotMatch(beginBody,/actions\.click|moveAction\.click|ACTION_MENU/)
})

test('MOVE PIN uses a compact in-map controller with 16px visuals and 44px hit targets',()=>{
  assert.match(controls,/moveDock\.id='leadMapMoveDock'/)
  assert.match(controls,/\.map-move-lamp\{width:16px;height:16px/)
  assert.match(entryFix,/setAttribute\('aria-label','MOVE PIN'\)/)
  assert.match(controls,/aria-label="CONFIRM PIN LOCATION"/)
  assert.match(controls,/aria-label="CANCEL PIN MOVE"/)
})

test('compact MOVE PIN delegates to the existing audited move backend controls',()=>{
  assert.match(controls,/const underlying=byId\('moveLeadPinBtn'\)/)
  assert.match(controls,/const underlying=byId\('confirmLeadPinBtn'\)/)
  assert.match(controls,/await underlying\.onclick\.call\(underlying,event\)/)
  assert.match(controls,/byId\('cancelLeadPinBtn'\)\?\.click\(\)/)
  assert.match(map,/mccoy-map-move-pin-started/)
  assert.match(map,/mccoy-map-move-pin-ended/)
  assert.match(map,/action:'move_lead_pin'/)
})

test('legacy outside-map correction panel cannot surface',()=>{
  assert.match(entryFix,/#leadCorrectionPanel\{display:none!important\}/)
  assert.doesNotMatch(controls,/mountWorkflow\(byId\('leadCorrectionPanel'\),'MOVE PIN'/)
})

test('expanded map preserves selected lead context and lead lifecycle safety',()=>{
  assert.match(controls,/leadMapSelectedAddress/)
  assert.match(controls,/MCCOY_MAP_MOVE_PIN_ACTIVE/)
  assert.match(detail,/mccoy-map-lead-deleted/)
  assert.match(controls,/mccoy-map-lead-deleted/)
})

test('orientation preserves mode while leaving Lead Pool restores standard',()=>{
  assert.match(controls,/window\.addEventListener\('resize'/)
  assert.doesNotMatch(controls,/localStorage|sessionStorage/)
  assert.match(controls,/view!==undefined&&view!=='leads'/)
  assert.match(controls,/setMode\(STANDARD\)/)
})

test('production lifecycle still loads the MOVE PIN entry launcher',()=>{
  assert.match(html,/app-lead-map\.js\?v=\d+/)
  assert.match(html,/app-lead-map-window-controls\.js\?v=\d+/)
  assert.match(loader,/app-lead-map-window-entry-fix\.js\?v=\d+/)
})

test('expanded iPad map owns the dynamic viewport and locks both scroll roots',()=>{
  assert.match(controls,/html\.lead-map-window-open,body\.lead-map-window-open/)
  assert.match(controls,/#leadMapPanel\.lead-map-window-expanded\{[^}]*position:fixed!important;[^}]*inset:0!important;[^}]*width:100vw!important;[^}]*height:100dvh!important/)
  assert.match(controls,/#leadMapPanel\.lead-map-window-expanded #leadMapFrame\{[^}]*width:100vw!important;[^}]*height:100dvh!important;[^}]*max-height:100dvh!important/)
  assert.match(controls,/document\.documentElement\.classList\.toggle\('lead-map-window-open',expanded\)/)
})
