import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const compact=readFileSync(new URL('./app-sales-hub-layout.js',import.meta.url),'utf8')
const finalPlacement=readFileSync(new URL('./app-sales-hub-fieldcoach-workday-layout.js',import.meta.url),'utf8')
const pageLayout=readFileSync(new URL('./app-page-layout.js',import.meta.url),'utf8')
const workday=readFileSync(new URL('./app-sph-presence.js',import.meta.url),'utf8')

test('final production layout is a left stack beside Door Workflow',()=>{
  assert.match(finalPlacement,/grid-template-columns:minmax\(280px,\.72fr\) minmax\(430px,1\.28fr\)!important/)
  assert.match(finalPlacement,/grid-template-areas:"left door"!important/)
  assert.match(finalPlacement,/#salesHubLeftStack\{/)
  assert.match(finalPlacement,/top\.replaceChildren\(left,door\)/)
})

test('left stack uses the exact requested top-to-bottom order',()=>{
  assert.match(finalPlacement,/left\.replaceChildren\(fieldSession,workday,liveStats,pay\)/)
  assert.match(finalPlacement,/order:\['Field Session','Sales \/ Hour Workday','Live Session Stats','Weekly Pay Progress'\]/)
  assert.match(finalPlacement,/grid-template-rows:auto auto auto minmax\(0,1fr\)/)
  assert.match(finalPlacement,/#salesHubLeftStack #payProgressCard[\s\S]*height:100%!important/)
})

test('Background Mode shows only its button and Live Session Stats stays two by two',()=>{
  assert.match(finalPlacement,/makeBackgroundButtonOnly/)
  assert.match(finalPlacement,/if\(child!==toggle\)child\.hidden=true/)
  assert.match(finalPlacement,/grid-template-columns:repeat\(2,minmax\(0,1fr\)\)!important/)
})

test('Workday remains the compact address plus EDIT control',()=>{
  assert.match(workday,/sphHomeAddressDisplay/)
  assert.match(workday,/id="sphEditHome"/)
  assert.doesNotMatch(workday,/Private Home label or address/)
})

test('corrected layout is production-loaded, responsive, and observer-free',()=>{
  const compactIndex=pageLayout.indexOf('app-sales-hub-layout.js')
  const finalIndex=pageLayout.indexOf('app-sales-hub-fieldcoach-workday-layout.js?v=2026082803')
  assert.ok(compactIndex>=0)
  assert.ok(finalIndex>compactIndex)
  assert.doesNotMatch(pageLayout,/app-sales-hub-production-layout\.js/)
  assert.match(finalPlacement,/@media\(max-width:980px\)/)
  assert.match(finalPlacement,/grid-template-areas:"left" "door"!important/)
  assert.doesNotMatch(compact+finalPlacement,/MutationObserver/)
})
