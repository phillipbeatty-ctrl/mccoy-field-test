import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const ui=readFileSync(new URL('./app-customer-list-credit-ranking-refresh.js',import.meta.url),'utf8')
const migration=readFileSync(
  new URL('./supabase/migrations/20260827190000_order_date_calendar_rankings.sql',import.meta.url),
  'utf8'
)

test('Customer List treats YYYY-MM-DD as a local calendar date',()=>{
  assert.match(ui,/\^\(\\d\{4\}\)-\(\\d\{2\}\)-\(\\d\{2\}\)\$/)
  assert.match(ui,/new Date\(year,month-1,day,12,0,0,0\)/)
  assert.match(ui,/year<2000\|\|year>currentYear\+1/)
  assert.match(ui,/Ordered \$\{formatCalendarDate\(record\.order_date\)\}/)
  assert.match(ui,/Install \$\{formatCalendarDate\(record\.install_date\)\}/)
  assert.doesNotMatch(ui,/new Date\(record\.order_date\)/)
  assert.doesNotMatch(ui,/MutationObserver/)
})

test('ranking buckets use the approved order date without losing time of day',()=>{
  assert.match(migration,/create or replace function private\.sale_ranking_at/)
  assert.match(migration,/p_order_date[\s\S]*timezone\('America\/Los_Angeles',fallback\.actual_at\)::time/)
  assert.match(migration,/at time zone 'America\/Los_Angeles'/)
  assert.match(migration,/get_verified_sales_rankings_unredacted/)
  assert.match(migration,/get_ghost_actual_period_metrics/)
  assert.match(migration,/get_authoritative_sph_metrics/)
  assert.match(migration,/publish_verified_sale_live_win/)
})

test('grossly invalid order dates cannot corrupt rankings',()=>{
  assert.match(migration,/p_order_date between date '2000-01-01'/)
  assert.match(migration,/current_timestamp\)::date \+ 1/)
  assert.match(migration,/else fallback\.actual_at/)
})

test('reported calendar example remains August 26 in Pacific time',()=>{
  assert.match(migration,/date '2026-08-26'/)
  assert.match(migration,/timestamptz '2026-08-27 03:48:16\+00'/)
  assert.match(migration,/Order-date ranking calendar validation failed/)
})
