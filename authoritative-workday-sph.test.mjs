import assert from 'node:assert/strict'
import test from 'node:test'
import {readFile} from 'node:fs/promises'

const migration=await readFile(new URL('./supabase/migrations/20260824040000_authoritative_workday_sales_per_hour.sql',import.meta.url),'utf8')
const presence=await readFile(new URL('./app-sph-presence.js',import.meta.url),'utf8')
const privacy=await readFile(new URL('./app-security.js',import.meta.url),'utf8')
const ui=await readFile(new URL('./app-compensation.js',import.meta.url),'utf8')

test('Sales/Hour is independent of the Start Knocking button and samples signed-in workdays',()=>{
  assert.match(migration,/'active_session_button_required',false/)
  assert.match(presence,/record\('login'\)/)
  assert.match(presence,/SAMPLE_MS=5\*60\*1000/)
  assert.match(ui,/generated from authenticated McCoy workday sessions/)
})

test('the server owns the requested workday starts, Sunday exclusion, and lunch allowance',()=>{
  assert.match(migration,/time '13:00'/)
  assert.match(migration,/time '11:00'/)
  assert.match(migration,/time '19:00'/)
  assert.match(migration,/extract\(isodow from d\.work_date\)<>7/)
  assert.match(migration,/counted_end-w\.window_start\)\)-3600/)
})

test('area departure supports Home, after-7 quarter mile, and 20-minute outbound signals',()=>{
  assert.match(migration,/left_area_heading_home/)
  assert.match(migration,/distance_outside_area_m>=402\.336/)
  assert.match(migration,/max\(event_at\)-min\(event_at\)>=interval '20 minutes'/)
  assert.match(migration,/last_sale_when_day_closes/)
})

test('Home and workday GPS are consent gated and inaccessible through direct table grants',()=>{
  assert.match(migration,/current_privacy_consent_required/)
  assert.match(migration,/revoke all on table public\.sph_rep_settings, public\.sph_presence_events/)
  assert.match(privacy,/precise location while you are signed in and the app is open for field work/)
  assert.match(privacy,/2026-08-24-v2/)
})

test('assigned areas prefer explicit assignments and fall back to assigned geocoded leads',()=>{
  assert.match(migration,/v_basis:='explicit_assignment'/)
  assert.match(migration,/v_basis:='assigned_leads'/)
  assert.match(migration,/l\.assigned_rep_id=v_profile_id/)
})

test('historical telemetry backfill is bounded and idempotent',()=>{
  assert.match(migration,/backfill_sph_presence\(p_limit integer default 200\)/)
  assert.match(migration,/p_limit not between 1 and 500/)
  assert.match(migration,/on conflict\(source_test_event_id\).*do nothing/s)
})
