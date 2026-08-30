import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const control = read('./supabase/functions/session-control/index.ts')
const migration = read('./supabase/migrations/20260830020000_outside_area_autostop_30_minutes.sql')
const browser = read('./app-auto-stop.js')

test('outside assigned-area auto-stop uses a 30-minute continuous grace period', () => {
  assert.match(control, /OUTSIDE_AREA_GRACE_MS\s*=\s*30\s*\*\s*60\s*\*\s*1000/)
  assert.match(control, /outside_area_grace_ms:\s*OUTSIDE_AREA_GRACE_MS/)
  assert.match(control, /now\s*-\s*outsideSince\s*>=\s*Number\(rule\.outside_area_grace_ms\)/)
})

test('production rule and future database default are both 1,800,000 milliseconds', () => {
  assert.match(migration, /alter column outside_area_grace_ms set default 1800000/)
  assert.match(migration, /set outside_area_grace_ms = 1800000/)
  assert.match(migration, /where active is true/)
})

test('browser remains a polling client and does not own the stop threshold', () => {
  assert.match(browser, /session-control/)
  assert.match(browser, /CHECK_EVERY_MS=15000/)
  assert.doesNotMatch(browser, /outside_area_grace_ms/)
})

test('the change does not alter the stationary-after-disposition configuration', () => {
  assert.doesNotMatch(migration, /post_disposition_idle_ms\s*=/)
  assert.doesNotMatch(migration, /post_sale_idle_ms\s*=/)
  assert.match(control, /stationary_after_disposition/)
})
