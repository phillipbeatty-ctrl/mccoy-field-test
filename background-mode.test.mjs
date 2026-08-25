import assert from 'node:assert/strict'
import test from 'node:test'
import {readFile} from 'node:fs/promises'

const source=await readFile(new URL('./app-session-heartbeat.js',import.meta.url),'utf8')

test('Background Mode is explicit, user-controlled, and persisted',()=>{
  assert.match(source,/BACKGROUND MODE: \$\{backgroundEnabled\?'ON':'OFF'\}/)
  assert.match(source,/mccoy_background_mode_enabled/)
  assert.match(source,/setBackgroundEnabled\(!backgroundEnabled,true\)/)
  assert.match(source,/aria-pressed/)
})

test('hidden sessions keep best-effort heartbeats only when Background Mode is enabled',()=>{
  assert.match(source,/document\.visibilityState!=='visible'&&!backgroundEnabled/)
  assert.match(source,/BACKGROUND_HEARTBEAT_EVERY_MS/)
  assert.match(source,/sendHeartbeat\('visibility_hidden'\)/)
  assert.match(source,/background_interval/)
})

test('resume reconciles heartbeat and GPS without fabricating background positions',()=>{
  assert.match(source,/resumeIfDue\('visibility_resume'\)/)
  assert.match(source,/requestFreshGpsInBackground/)
  assert.match(source,/startGpsWatch/)
  assert.match(source,/GPS is being refreshed/)
  assert.doesNotMatch(source,/fake|synthetic.*gps|fabricat.*gps/i)
})

test('wake lock is best effort and released outside visible active use',()=>{
  assert.match(source,/navigator\.wakeLock\?\.request/)
  assert.match(source,/document\.visibilityState!=='visible'/)
  assert.match(source,/releaseWakeLock\(\)/)
  assert.match(source,/iOS\/Android may suspend GPS or JavaScript/)
})
