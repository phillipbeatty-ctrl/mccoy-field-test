import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const layout=readFileSync(new URL('./app-sales-hub-production-layout.js',import.meta.url),'utf8')
const pageLayout=readFileSync(new URL('./app-page-layout.js',import.meta.url),'utf8')
const workday=readFileSync(new URL('./app-sph-presence.js',import.meta.url),'utf8')

test('desktop layout gives extra width to Door Workflow and keeps a compact right metrics column',()=>{
  assert.match(layout,/grid-template-columns:clamp\(250px,20vw,330px\) minmax\(0,1fr\) clamp\(220px,16vw,280px\)/)
  assert.match(layout,/grid-template-areas:"field door metrics"/)
  assert.match(layout,/grid-area:door/)
  assert.match(layout,/grid-area:metrics/)
})

test('right column stacks Live Session Stats, Weekly Pay Progress, then Workday',()=>{
  assert.match(layout,/grid-template-rows:auto minmax\(0,1fr\) auto/)
  assert.match(layout,/metrics\.appendChild\(liveStats\)/)
  assert.match(layout,/metrics\.appendChild\(pay\)/)
  assert.match(layout,/metrics\.appendChild\(workday\)/)
})

test('Live Session Stats uses a two-by-two tile grid',()=>{
  assert.match(layout,/grid-template-columns:repeat\(2,minmax\(0,1fr\)\)!important/)
  assert.match(layout,/metricsTwoByTwo:true/)
})

test('Background Mode is reduced to its button and Workday uses address plus EDIT',()=>{
  assert.match(layout,/makeBackgroundButtonOnly/)
  assert.match(layout,/if\(child!==toggle\)child\.hidden=true/)
  assert.match(workday,/sphHomeAddressDisplay/)
  assert.match(workday,/id="sphEditHome"/)
  assert.doesNotMatch(workday,/Private Home label or address/)
})

test('layout is production-loaded and avoids document-wide observers',()=>{
  assert.match(pageLayout,/app-sales-hub-production-layout\.js/)
  assert.doesNotMatch(layout,/MutationObserver/)
  assert.match(layout,/@media\(max-width:760px\)/)
  assert.match(layout,/grid-template-areas:"field" "door" "metrics"/)
})
