import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const controls=fs.readFileSync(new URL('./app-lead-map-window-controls.js',import.meta.url),'utf8')
const entryFix=fs.readFileSync(new URL('./app-lead-map-window-entry-fix.js',import.meta.url),'utf8')
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
  assert.match(controls,/mountWorkflow\([^\n]*'DISPOSITION',DISPOSITION\)/)
})

test('Standard MOVE PIN calls first-class controller transition directly',()=>{
  assert.match(entryFix,/MCCOY_LEAD_MAP_WINDOW\?\.beginMovePin\?\.\(selectedLeadId\)/)
  assert.doesNotMatch(entryFix,/leadMapActionsBtn/)
  assert.doesNotMatch(entryFix,/leadMapMovePinAction/)
  assert.doesNotMatch(entryFix,/\.maximize\?\.\(\)/)
  assert.doesNotMatch(entryFix,/requestAnimationFrame/)
  assert.doesNotMatch(entryFix,/\.click\(\)/)
  assert.match(controls,/function beginMovePin\(leadId\)/)
  assert.match(controls,/const resolved=leadById\(leadId\)\|\|selectedLead/)
  assert.match(controls,/selectedLead=resolved/)
  assert.match(controls,/if\(!mayMoveSelectedLead\(\)\)/)
  assert.match(controls,/mode=MOVE_PIN_READY;sync\(\);showHint\('MOVE PIN'\);return true/)
  assert.match(controls,/beginMovePin\}/)
})

test('beginMovePin state transition maximizes and reveals compact MOVE PIN without yellow Actions',()=>{
  const beginStart=controls.indexOf('function beginMovePin(leadId)')
  const beginEnd=controls.indexOf('function mountWorkflow',beginStart)
  assert.ok(beginStart>=0&&beginEnd>beginStart)
  const beginBody=controls.slice(beginStart,beginEnd)
  assert.match(beginBody,/mode=MOVE_PIN_READY/)
  assert.match(beginBody,/sync\(\)/)
  assert.doesNotMatch(beginBody,/actions\.click|moveAction\.click|ACTION_MENU/)

  const syncStart=controls.indexOf('function sync()')
  const syncEnd=controls.indexOf('function setMode',syncStart)
  assert.ok(syncStart>=0&&syncEnd>syncStart)
  const syncBody=controls.slice(syncStart,syncEnd)
  assert.match(syncBody,/const expanded=mode!==STANDARD/)
  assert.match(syncBody,/moveReady=mode===MOVE_PIN_READY/)
  assert.match(syncBody,/panel\.classList\.toggle\('lead-map-window-expanded',expanded\)/)
  assert.match(syncBody,/moveDock\.classList\.toggle\('show',moveReady\|\|moveActive\)/)
})

test('selected lead exposes a standard-view MOVE PIN launcher',()=>{
  assert.match(entryFix,/selectedLeadId=event\.detail\?\.leadId\|\|null/)
  assert.match(entryFix,/button\.textContent='MOVE PIN'/)
  assert.match(entryFix,/button\.setAttribute\('aria-label','MOVE PIN'\)/)
  assert.match(entryFix,/selectedLeadId&&standard&&leadsActive/)
  assert.match(entryFix,/#leadMapPanel\.lead-map-window-expanded #leadMapMovePinLauncher\{display:none!important\}/)
})

test('yellow Actions MOVE PIN uses the same first-class beginMovePin transition',()=>{
  assert.match(controls,/moveAction\.addEventListener\('click',event=>\{event\.stopPropagation\(\);beginMovePin\(selectedLead\?\.dbId\|\|selectedLead\?\.id\)\}\)/)
})

test('MOVE PIN uses a compact in-map controller with 16px visuals and 44px hit targets',()=>{
  assert.match(controls,/id="leadMapMoveDock"/)
  assert.match(controls,/right:max\(22px/)
  assert.match(controls,/bottom:max\(92px/)
  assert.match(controls,/\.map-move-lamp\{width:16px;height:16px/)
  assert.match(controls,/\.map-window-control,\.map-move-control/)
  assert.match(controls,/aria-label="MOVE PIN"/)
  assert.match(controls,/aria-label="CONFIRM PIN LOCATION"/)
  assert.match(controls,/aria-label="CANCEL PIN MOVE"/)
  assert.match(controls,/move-ready-only/)
  assert.match(controls,/move-active-only/)
  assert.match(controls,/#leadMapMoveDock\.active \.move-ready-only\{display:none\}/)
  assert.match(controls,/#leadMapMoveDock\.active \.move-active-only\{display:grid\}/)
})

test('legacy outside-map correction panel cannot surface',()=>{
  assert.match(entryFix,/#leadCorrectionPanel\{display:none!important\}/)
  assert.doesNotMatch(controls,/mountWorkflow\(byId\('leadCorrectionPanel'\),'MOVE PIN'/)
  assert.doesNotMatch(controls,/workflowBody\.appendChild\(byId\('moveLeadPinBtn'\)/)
})

test('MOVE PIN never mounts a workflow sheet, disposition controls, or address-editing controls',()=>{
  assert.doesNotMatch(controls,/mountMoveWorkflow/)
  assert.doesNotMatch(controls,/mountWorkflow\(byId\('leadCorrectionPanel'\),'MOVE PIN'/)
  assert.doesNotMatch(controls,/workflowBody\.appendChild\(byId\('moveLeadPinBtn'\)/)
  assert.doesNotMatch(controls,/adminLeadAddressFields/)
  assert.doesNotMatch(controls,/map-pin-disposition.*MOVE_PIN_READY|MOVE_PIN_READY.*map-pin-disposition/s)
  assert.match(controls,/sheet\.classList\.toggle\('show',dispositionOpen\)/)
})

test('compact MOVE PIN delegates to the existing audited move backend controls',()=>{
  assert.match(controls,/byId\('moveLeadPinBtn'\)\?\.click\(\)/)
  assert.match(controls,/byId\('confirmLeadPinBtn'\)\?\.click\(\)/)
  assert.match(controls,/byId\('cancelLeadPinBtn'\)\?\.click\(\)/)
  assert.match(controls,/MutationObserver\(syncCompactConfirm\)/)
  assert.match(map,/mccoy-map-move-pin-started/)
  assert.match(map,/mccoy-map-move-pin-ended/)
  assert.match(map,/action:'move_lead_pin'/)
  assert.match(map,/requestId!==movePinRequest/)
})

test('expanded map preserves selected lead context and lead lifecycle safety',()=>{
  assert.match(controls,/leadMapSelectedAddress/)
  assert.match(controls,/MCCOY_MAP_MOVE_PIN_ACTIVE/)
  assert.match(controls,/closest\?\.\('\.map-pick'\)/)
  assert.match(detail,/mccoy-map-lead-deleted/)
  assert.match(controls,/mccoy-map-lead-deleted/)
  assert.match(controls,/if\(window\.MCCOY_MAP_MOVE_PIN_ACTIVE\)byId\('cancelLeadPinBtn'\)\?\.click\(\)/)
})

test('orientation preserves mode while leaving Lead Pool restores standard',()=>{
  assert.match(controls,/window\.addEventListener\('resize'/)
  assert.doesNotMatch(controls,/localStorage|sessionStorage/)
  assert.match(controls,/view!==undefined&&view!=='leads'/)
  assert.match(controls,/setMode\(STANDARD\)/)
})

test('production lifecycle loads the MOVE PIN entry launcher',()=>{
  assert.match(html,/app-lead-map\.js\?v=2026090401/)
  assert.match(html,/app-lead-map-window-controls\.js\?v=2026090401/)
  assert.match(loader,/app-lead-map-window-entry-fix\.js\?v=2026090401/)
  assert.ok(html.indexOf('app-lead-detail-panel.js?v=2026090401')<html.indexOf('app-lead-map-window-controls.js?v=2026090401'))
  assert.match(worker,/field-coach-app-shell-v10-20260904-map-window-controls/)
})
