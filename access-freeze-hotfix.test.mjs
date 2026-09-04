import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const home=fs.readFileSync(new URL('./app-sph-home-admin-only.js',import.meta.url),'utf8')
const gate=fs.readFileSync(new URL('./app-organization-access-gate.js',import.meta.url),'utf8')
const html=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8')

test('Home lock is event-driven without a document-wide observer',()=>{
  assert.doesNotMatch(home,/MutationObserver/)
  assert.match(home,/addEventListener\('mccoy-sph-workday-ready'/)
  assert.doesNotMatch(home,/addEventListener\('mccoy-access-ready'/)
  assert.match(home,/getElementById\('sphWorkdayControl'\)/)
  assert.match(home,/MCCOY_SPH_PRESENCE\?\.refresh\?\.\(\)/)
})

test('Home lock writes labels only when values differ and removes editor once',()=>{
  assert.match(home,/element\.textContent!==value/)
  assert.match(home,/if\(!editorRemoved\)/)
  assert.match(home,/editorRemoved=true/)
  assert.match(home,/getElementById\('sphEditHome'\)\?\.remove\(\)/)
  assert.match(home,/getElementById\('sphHomeEditor'\)\?\.remove\(\)/)
})

test('organization access has a bounded check and visible retry state',()=>{
  assert.match(gate,/ACCESS_CHECK_TIMEOUT_MS=12000/)
  assert.match(gate,/Promise\.race/)
  assert.match(gate,/access_check_timeout/)
  assert.match(gate,/RECHECK ACCESS/)
  assert.match(gate,/retry\.hidden=false/)
  assert.match(gate,/clearTimeout\(timeoutId\)/)
})

test('production entrypoint cache-busts both corrected scripts',()=>{
  assert.match(html,/app-organization-access-gate\.js\?v=2026090402/)
  assert.match(html,/app-sph-home-admin-only\.js\?v=2026090502/)
  assert.doesNotMatch(html,/app-sph-home-admin-only\.js\?v=2026090501/)
})
