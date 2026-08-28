import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const compact=fs.readFileSync(new URL('./app-sales-hub-layout.js',import.meta.url),'utf8')
const finalPlacement=fs.readFileSync(new URL('./app-sales-hub-fieldcoach-workday-layout.js',import.meta.url),'utf8')
const loader=fs.readFileSync(new URL('./app-page-layout.js',import.meta.url),'utf8')

test('production loader uses the two approved preview layout files in order',()=>{
  const compactIndex=loader.indexOf('app-sales-hub-layout.js')
  const finalIndex=loader.indexOf('app-sales-hub-fieldcoach-workday-layout.js')
  assert.ok(compactIndex>=0,'compact preview layout must be loaded')
  assert.ok(finalIndex>compactIndex,'final placement override must load after compact layout')
  assert.doesNotMatch(loader,/app-sales-hub-production-layout\.js/)
})

test('compact layout preserves the preview three-column structure',()=>{
  assert.match(compact,/grid-template-columns:minmax\(250px,\.94fr\) minmax\(230px,\.78fr\) minmax\(390px,1\.28fr\)/)
  assert.match(compact,/grid-template-areas:"field middle door" "workday workday door"/)
  assert.match(compact,/#salesHubMiddleStack\{grid-area:middle;display:grid;grid-template-rows:minmax\(0,1fr\) minmax\(0,1fr\)/)
  assert.match(compact,/middle\.replaceChildren\(liveStats,pay\)/)
})

test('final preview placement puts Workday under Background Mode and Field Coach below the first two columns',()=>{
  assert.match(finalPlacement,/grid-template-areas:"field middle door" "coach coach door"!important/)
  assert.match(finalPlacement,/background\.insertAdjacentElement\('afterend',workday\)/)
  assert.match(finalPlacement,/top\.replaceChildren\(fieldSession,middle,door,coach\)/)
  assert.match(finalPlacement,/grid-template-areas:"field" "coach" "door" "middle"!important/)
})

test('promoted layouts use bounded retries and no document-wide observer',()=>{
  assert.match(compact,/\[0,80,220,500,900,1500,2500\]/)
  assert.match(finalPlacement,/\[0,80,220,500,900,1500,2800,4500,7000\]/)
  assert.doesNotMatch(compact+finalPlacement,/MutationObserver/)
})
