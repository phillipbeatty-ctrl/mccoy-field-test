import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const heartbeat = readFileSync(new URL('./app-session-heartbeat.js', import.meta.url), 'utf8')
const sessionInit = readFileSync(new URL('./app-session-init.js', import.meta.url), 'utf8')
const autoStop = readFileSync(new URL('./app-auto-stop.js', import.meta.url), 'utf8')
const index = readFileSync(new URL('./index.html', import.meta.url), 'utf8')
const migration = readFileSync(new URL('./supabase/migrations/20260824013000_field_session_heartbeat.sql', import.meta.url), 'utf8')

test('heartbeat follows the existing field session lifecycle', () => {
  assert.match(sessionInit, /mccoy-field-session-started/)
  assert.match(autoStop, /mccoy-field-session-ended/)
  assert.match(heartbeat, /mccoy-field-session-started/)
  assert.match(heartbeat, /mccoy-field-session-ended/)
  assert.match(index, /app-session-heartbeat\.js/)
})

test('heartbeat is lightweight, foreground-only, and duplicate-safe', () => {
  assert.match(heartbeat, /HEARTBEAT_EVERY_MS=5\*60\*1000/)
  assert.match(heartbeat, /if\(window\.MCCOY_FIELD_HEARTBEAT\)return/)
  assert.match(heartbeat, /document\.visibilityState==='visible'/)
  assert.match(heartbeat, /navigator\.onLine===false/)
  assert.match(heartbeat, /visibilitychange/)
  assert.match(heartbeat, /addEventListener\('online'/)
  assert.match(heartbeat, /addEventListener\('offline',clearTimer\)/)
  assert.match(heartbeat, /addEventListener\('pageshow'/)
  assert.match(heartbeat, /if\(inFlight\)\{schedule\(RETRY_AFTER_MS\)/)
  assert.doesNotMatch(heartbeat, /geolocation|latitude|longitude|customer|lead_label/i)
})

test('server timestamps and authorizes every heartbeat', () => {
  assert.match(heartbeat, /rpc\('record_field_session_heartbeat'/)
  assert.match(migration, /security invoker/)
  assert.match(migration, /s\.tester_user_id = \(select auth\.uid\(\)\)/)
  assert.match(migration, /s\.ended_at is null/)
  assert.match(migration, /v_server_at timestamptz := clock_timestamp\(\)/)
  assert.match(migration, /'contains_location', false/)
  assert.match(migration, /revoke all on function public\.record_field_session_heartbeat\(uuid\) from public, anon/)
})

test('heartbeat cannot keep a forgotten session alive forever', () => {
  assert.match(migration, /s\.started_at > v_server_at - interval '16 hours'/)
  assert.match(migration, /ts\.started_at <= now\(\) - interval '16 hours'/)
  assert.match(migration, /'maximum_16_hours'/)
  assert.match(migration, /ts\.started_at \+ interval '16 hours'/)
})
