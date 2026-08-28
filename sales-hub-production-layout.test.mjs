import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const compact=readFileSync(new URL('./app-sales-hub-layout.js',import.meta.url),'utf8')
const finalPlacement=readFileSync(new URL('./app-sales-hub-fieldcoach-workday-layout.js',import.meta.url),'utf8')
const pageLayout=readFileSync(new URL('./app-page-layout.js',import.meta.url),'utf8')
const workday=readFileSync(new URL('./app-sph-presence.js',import.meta.url),'utf8')

test('desktop production uses the approved preview three-column layout',()=>{
  assert.match(compact,/grid-template-columns:minmax\(250px,\.94fr\) minmax\(230px,\.78fr\) minmax\(390px,1\.28fr\)/)
  assert.match(compact,/grid-template-areas:"field middle door" "workday workday door"/)
  assert.match(compact,/#salesHubMiddleStack\{grid-area:middle/)
  assert.match(compact,/#salesHubTopGrid \.sales-hub-door-workflow\{grid-area:door/)
})

test('middle column stacks Live Session Stats above Weekly Pay Progress',()=>{
  assert.match(compact,/grid-template-rows:minmax\(0,1fr\) minmax\(0,1fr\)/)
  assert.match(compact,/middle\.replaceChildren\(liveStats,pay\)/)
})

test('final placement moves Workday beneath Background Mode and Field Coach into the lower row',()=>{
  assert.match(finalPlacement,/grid-template-areas:"field middle door" "coach coach door"!important/)
  assert.match(finalPlacement,/background\.insertAdjacentElement\('afterend',workday\)/)
  assert.match(finalPlacement,/top\.replaceChildren\(fieldSession,middle,door,coach\)/)
})

test('Workday remains the compact address plus EDIT control',()=>{
  assert.match(workday,/sphHomeAddressDisplay/)
  assert.match(workday,/id="sphEditHome"/)
  assert.doesNotMatch(workday,/Private Home label or address/)
})

test('approved preview layouts are production-loaded and avoid document-wide observers',()=>{
  const compactIndex=pageLayout.indexOf('app-sales-hub-layout.js')
  const finalIndex=pageLayout.indexOf('app-sales-hub-fieldcoach-workday-layout.js')
  assert.ok(compactIndex>=0)
  assert.ok(finalIndex>compactIndex)
  assert.doesNotMatch(pageLayout,/app-sales-hub-production-layout\.js/)
  assert.doesNotMatch(compact+finalPlacement,/MutationObserver/)
  assert.match(finalPlacement,/grid-template-areas:"field" "coach" "door" "middle"!important/)
})
