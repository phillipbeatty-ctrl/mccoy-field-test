import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const controls=fs.readFileSync(new URL('./app-lead-map-window-controls.js',import.meta.url),'utf8')
const map=fs.readFileSync(new URL('./app-lead-map.js',import.meta.url),'utf8')
const detail=fs.readFileSync(new URL('./app-lead-detail-panel.js',import.meta.url),'utf8')
const html=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8')
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

test('map begins standard and implements the requested state transitions',()=>{
  assert.match(controls,/let mode=STANDARD/)
  assert.match(controls,/handleControl\(maximize,'MAXIMIZE'/)
  assert.match(controls,/handleControl\(actions,'ACTIONS'/)
  assert.match(controls,/handleControl\(restore,'RESTORE'/)
  assert.match(controls,/setMode\(EXPANDED\)/)
  assert.match(controls,/mountWorkflow\([^\n]*'DISPOSITION',DISPOSITION\)/)
  assert.match(controls,/mountWorkflow\([^\n]*'MOVE PIN',MOVE_PIN\)/)
  assert.match(controls,/leadMapWorkflowCancel'\)\.hidden=nextMode===MOVE_PIN/)
  assert.match(controls,/mccoy-map-move-pin-ended/)
  assert.match(controls,/mccoy-door-visit-completed/)
})

test('unavailable controls remain visible, explain themselves, and do not rely on color',()=>{
  assert.match(controls,/aria-disabled/)
  assert.match(controls,/SELECT A LEAD FIRST/)
  assert.match(controls,/MAXIMIZE MAP FIRST/)
  assert.match(controls,/MOVE PIN NOT AUTHORIZED/)
  assert.match(controls,/setTimeout\(\(\)=>\{suppressClick=true;showHint\(label\)\},500\)/)
})

test('expanded map preserves selection context and uses existing audited workflows',()=>{
  assert.match(controls,/leadMapSelectedAddress/)
  assert.match(controls,/map-pin-disposition/)
  assert.match(controls,/moveLeadPinBtn/)
  assert.match(controls,/MCCOY_MAP_MOVE_PIN_ACTIVE/)
  assert.match(map,/mccoy-map-move-pin-started/)
  assert.match(map,/mccoy-map-move-pin-ended/)
  assert.match(controls,/closest\?\.\('\.map-pick'\)/)
  assert.match(detail,/mccoy-map-lead-deleted/)
  assert.match(controls,/mccoy-map-lead-deleted/)
  assert.match(map,/requestId!==movePinRequest/)
})

test('orientation preserves mode while navigation and reload begin standard',()=>{
  assert.match(controls,/window\.addEventListener\('resize'/)
  assert.doesNotMatch(controls,/localStorage|sessionStorage/)
  assert.match(controls,/view!==undefined&&view!=='leads'/)
  assert.match(controls,/setMode\(STANDARD\)/)
})

test('production entrypoint and app shell ship the prototype with fresh cache keys',()=>{
  assert.match(html,/app-lead-map\.js\?v=2026090401/)
  assert.match(html,/app-lead-map-window-controls\.js\?v=2026090401/)
  assert.ok(html.indexOf('app-lead-detail-panel.js?v=2026090401')<html.indexOf('app-lead-map-window-controls.js?v=2026090401'))
  assert.match(worker,/field-coach-app-shell-v10-20260904-map-window-controls/)
  assert.match(worker,/'\/app-lead-map-window-controls\.js\?v=2026090401'/)
})
