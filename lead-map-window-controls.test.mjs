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

test('Lead Pool entry automatically maximizes while preserving requested map transitions',()=>{
  assert.match(controls,/mode=STANDARD/)
  assert.match(entryFix,/controller\.getMode\?\.\(\)==='standard'/)
  assert.match(entryFix,/controller\.maximize\?\.\(\)/)
  assert.match(entryFix,/view==='leads'/)
  assert.match(controls,/MOVE_PIN_READY='move-pin-ready'/)
  assert.match(controls,/handleControl\(maximize,'MAXIMIZE'/)
  assert.match(controls,/handleControl\(actions,'ACTIONS'/)
  assert.match(controls,/handleControl\(restore,'RESTORE'/)
  assert.match(controls,/mountWorkflow\([^\n]*'DISPOSITION',DISPOSITION\)/)
  assert.match(controls,/mode=MOVE_PIN_READY;sync\(\);showHint\('MOVE PIN'\)/)
  assert.match(controls,/mccoy-map-move-pin-started/)
  assert.match(controls,/mccoy-map-move-pin-ended/)
  assert.match(controls,/mccoy-door-visit-completed/)
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

test('unavailable controls remain visible, explain themselves, and do not rely on color',()=>{
  assert.match(controls,/aria-disabled/)
  assert.match(controls,/SELECT A LEAD FIRST/)
  assert.match(controls,/MAXIMIZE MAP FIRST/)
  assert.match(controls,/MOVE PIN NOT AUTHORIZED/)
  assert.match(controls,/MOVE THE PIN FIRST/)
  assert.match(controls,/setTimeout\(\(\)=>\{suppressClick=true;showHint\(label\)\},500\)/)
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

test('production lifecycle loads the compact MOVE PIN entry fix',()=>{
  assert.match(html,/app-lead-map\.js\?v=2026090401/)
  assert.match(html,/app-lead-map-window-controls\.js\?v=2026090401/)
  assert.match(loader,/app-lead-map-window-entry-fix\.js\?v=2026090401/)
  assert.ok(html.indexOf('app-lead-detail-panel.js?v=2026090401')<html.indexOf('app-lead-map-window-controls.js?v=2026090401'))
  assert.match(worker,/field-coach-app-shell-v10-20260904-map-window-controls/)
})
