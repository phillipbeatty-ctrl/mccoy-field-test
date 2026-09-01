import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const security = await readFile(new URL('./app-security.js', import.meta.url), 'utf8')
const worker = await readFile(new URL('./service-worker.js', import.meta.url), 'utf8')

test('Update Required uses a real production link instead of a same-build reload loop', () => {
  assert.doesNotMatch(security, /location\.reload\s*\(/)
  assert.match(security, /href="https:\/\/mccoy-field-test\.vercel\.app\/\?app_update=manual"/)
  assert.match(security, /updateButton\.addEventListener\('click',forceProductionUpdate\)/)
  assert.match(security, /window\.location\.replace\(target\.href\)/)
})

test('preview or copied builds are redirected to the canonical production origin', () => {
  assert.match(security, /MCCOY_CANONICAL_PRODUCTION_URL='https:\/\/mccoy-field-test\.vercel\.app\/'/)
  assert.match(security, /MCCOY_PRODUCTION_HOSTS=new Set/)
  assert.match(security, /'mccoyplatform\.com'/)
  assert.match(security, /'www\.mccoyplatform\.com'/)
  assert.match(security, /currentOriginIsProduction\?window\.location\.origin:MCCOY_CANONICAL_PRODUCTION_URL/)
  assert.match(security, /target\.searchParams\.set\('app_update',String\(Date\.now\(\)\)\)/)
})

test('installed PWA recovery removes only Field Coach application-shell state', () => {
  assert.match(security, /navigator\.serviceWorker\.getRegistrations\(\)/)
  assert.match(security, /registration\.unregister\(\)/)
  assert.match(security, /MCCOY_APP_SHELL_CACHE_PREFIXES=\['mccoy-app-shell-','field-coach-app-shell-'\]/)
  assert.match(security, /window\.caches\.delete\(key\)/)
  assert.match(security, /navigator\.serviceWorker\.register\('\/service-worker\.js',\{scope:'\/',updateViaCache:'none'\}\)/)
})

test('the update action always navigates even if service-worker APIs stall', () => {
  assert.match(security, /setTimeout\(\(\)=>navigateToProduction\(target\),1600\)/)
  assert.match(security, /Promise\.race\(/)
  assert.match(security, /new Promise\(resolve=>setTimeout\(resolve,1100\)\)/)
  assert.match(security, /finally\{[\s\S]*navigateToProduction\(target\)/)
})

test('the current service worker activates immediately and cleans both legacy cache namespaces', () => {
  assert.match(worker, /mccoy-app-shell-v2-20260831-update-recovery/)
  assert.match(worker, /APP_SHELL_PREFIXES=\['mccoy-app-shell-','field-coach-app-shell-'\]/)
  assert.match(worker, /type==='SKIP_WAITING'/)
  assert.match(worker, /type==='CLEAR_APP_SHELL'/)
  assert.match(worker, /self\.skipWaiting\(\)/)
  assert.match(worker, /self\.clients\.claim\(\)/)
})
