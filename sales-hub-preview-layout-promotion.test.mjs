import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const compact=fs.readFileSync(new URL('./app-sales-hub-layout.js',import.meta.url),'utf8')
const finalPlacement=fs.readFileSync(new URL('./app-sales-hub-fieldcoach-workday-layout.js',import.meta.url),'utf8')
const loader=fs.readFileSync(new URL('./app-page-layout.js',import.meta.url),'utf8')

test('production loader applies the compact foundation before the corrected placement',()=>{
  const compactIndex=loader.indexOf('app-sales-hub-layout.js')
  const finalIndex=loader.indexOf('app-sales-hub-fieldcoach-workday-layout.js?v=2026082803')
  assert.ok(compactIndex>=0,'compact layout must load')
  assert.ok(finalIndex>compactIndex,'corrected placement must load after compact layout')
  assert.doesNotMatch(loader,/app-sales-hub-production-layout\.js/)
})

test('corrected placement removes the floating Workday and middle-column white space',()=>{
  assert.match(finalPlacement,/#salesHubLeftStack/)
  assert.match(finalPlacement,/left\.replaceChildren\(fieldSession,workday,liveStats,pay\)/)
  assert.match(finalPlacement,/top\.replaceChildren\(left,door\)/)
  assert.match(finalPlacement,/if\(middle&&middle!==left&&!middle\.children\.length\)middle\.remove\(\)/)
})

test('Field Coach is placed below the two-column top region',()=>{
  assert.match(finalPlacement,/sales-hub-field-coach-below/)
  assert.match(finalPlacement,/top\.insertAdjacentElement\('afterend',coach\)/)
})

test('corrected layouts use bounded retries and no document-wide observer',()=>{
  assert.match(compact,/\[0,80,220,500,900,1500,2500\]/)
  assert.match(finalPlacement,/\[0,80,220,500,900,1500,2800,4500,7000\]/)
  assert.doesNotMatch(compact+finalPlacement,/MutationObserver/)
})
