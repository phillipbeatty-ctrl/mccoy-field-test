import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const ui=readFileSync(new URL('./app-admin-session-history.js',import.meta.url),'utf8')
const fn=readFileSync(new URL('./supabase/functions/admin-session-history/index.ts',import.meta.url),'utf8')
const loader=readFileSync(new URL('./app-page-layout.js',import.meta.url),'utf8')
const migration=readFileSync(new URL('./supabase/migrations/20260829000000_admin_daily_session_metrics_indexes.sql',import.meta.url),'utf8')

test('admin calendar loads a selected Pacific day',()=>{
  assert.match(ui,/id="adminSessionDate" type="date"/)
  assert.match(ui,/TIME_ZONE='America\/Los_Angeles'/)
  assert.match(ui,/admin-session-history/)
  assert.match(ui,/Sessions started/)
  assert.match(ui,/Sessions terminated/)
})

test('protected endpoint enforces admin and organization isolation',()=>{
  assert.match(fn,/access\.role !== 'admin'/)
  assert.match(fn,/\.eq\('organization_id', access\.organization_id\)/)
  assert.match(fn,/valid_non_future_date_required/)
  assert.match(fn,/TIME_ZONE = 'America\/Los_Angeles'/)
})

test('session termination reasons cover manual and automatic stops',()=>{
  assert.match(fn,/manual_stop/)
  assert.match(fn,/outside_assigned_area/)
  assert.match(fn,/stationary_after_disposition/)
  assert.match(fn,/inactive_30_minutes/)
  assert.match(fn,/maximum_16_hours/)
  assert.match(fn,/field_session_auto_closures/)
})

test('existing session lifecycle remains the source of truth',()=>{
  assert.match(fn,/test_sessions/)
  assert.match(fn,/test_events/)
  assert.doesNotMatch(ui+fn,/MutationObserver/)
  assert.match(loader,/app-admin-session-history\.js/)
})

test('daily query indexes are included',()=>{
  assert.match(migration,/test_sessions_org_started_at_idx/)
  assert.match(migration,/test_sessions_org_ended_at_idx/)
  assert.match(migration,/test_events_session_termination_idx/)
})
