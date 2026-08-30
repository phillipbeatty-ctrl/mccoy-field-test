import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const control = read('./supabase/functions/session-control/index.ts')
const migration = read('./supabase/migrations/20260830180000_session_inactivity_autostop_30_minutes.sql')
const staleSessionMigration = read('./supabase/migrations/20260824010000_provisional_sales_per_hour_and_stale_sessions.sql')
const browser = read('./app-auto-stop.js')

test('session-control uses one 30-minute inactivity fallback for sales and non-sales', () => {
  assert.match(control, /INACTIVITY_AUTO_STOP_MS\s*=\s*30\s*\*\s*60\s*\*\s*1000/)
  assert.match(control, /post_disposition_idle_ms:\s*INACTIVITY_AUTO_STOP_MS/)
  assert.match(control, /post_sale_idle_ms:\s*INACTIVITY_AUTO_STOP_MS/)
  assert.doesNotMatch(control, /post_disposition_idle_ms:\s*120_000/)
  assert.doesNotMatch(control, /post_sale_idle_ms:\s*240_000/)
})

test('database defaults and every active production rule are set to 1,800,000 milliseconds', () => {
  assert.match(migration, /alter column post_disposition_idle_ms set default 1800000/)
  assert.match(migration, /alter column post_sale_idle_ms set default 1800000/)
  assert.match(migration, /post_disposition_idle_ms = 1800000/)
  assert.match(migration, /post_sale_idle_ms = 1800000/)
  assert.match(migration, /where active is true/)
  assert.match(migration, /session_inactivity_rule_update_failed/)
})

test('inactivity audit events record the threshold that caused the stop', () => {
  assert.match(control, /inactivityAutoStopMs:\s*idleLimit/)
  assert.match(control, /reason:\s*'stationary_after_disposition'/)
  assert.match(control, /now\s*-\s*stationarySince\s*>=\s*idleLimit/)
})

test('the browser remains a polling client and does not own the inactivity threshold', () => {
  assert.match(browser, /session-control/)
  assert.match(browser, /CHECK_EVERY_MS=15000/)
  assert.doesNotMatch(browser, /INACTIVITY_AUTO_STOP_MS/)
  assert.doesNotMatch(browser, /post_disposition_idle_ms/)
  assert.doesNotMatch(browser, /post_sale_idle_ms/)
})

test('the general stale-session closer remains aligned at 30 minutes', () => {
  assert.match(staleSessionMigration, /now\(\) - interval '30 minutes'/)
  assert.match(staleSessionMigration, /inactive_30_minutes/)
})

test('outside-area grace remains independent and unchanged at 30 minutes', () => {
  assert.match(control, /OUTSIDE_AREA_GRACE_MS\s*=\s*30\s*\*\s*60\s*\*\s*1000/)
  assert.match(control, /outside_area_grace_ms:\s*OUTSIDE_AREA_GRACE_MS/)
  assert.doesNotMatch(migration, /outside_area_grace_ms\s*=/)
})
