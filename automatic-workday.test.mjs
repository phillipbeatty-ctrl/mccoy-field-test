import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const migration=fs.readFileSync(new URL('./supabase/migrations/20260904150000_automatic_daily_workday_segments.sql',import.meta.url),'utf8')
const gapGuard=fs.readFileSync(new URL('./supabase/migrations/20260904160000_enforce_tracking_gap_exclusion.sql',import.meta.url),'utf8')
const control=fs.readFileSync(new URL('./supabase/functions/session-control/index.ts',import.meta.url),'utf8')
const ui=fs.readFileSync(new URL('./app-automatic-workday.js',import.meta.url),'utf8')

test('workday has only the requested automatic segment classes',()=>{
  assert.match(migration,/segment_type in \('working','break','tracking_gap'\)/)
  assert.match(migration,/unique \(rep_user_id, work_date\)/)
  assert.match(migration,/workday_timezone/)
})

test('break allowance is one eighth of working time and excessive idle counts',()=>{
  assert.match(migration,/break_allowance_seconds'[\s\S]*p_working_seconds, 0\), 0\) \/ 8/)
  assert.match(migration,/'sph_counted_seconds'[\s\S]*p_working_seconds[\s\S]*p_idle_seconds/)
  assert.match(migration,/v_counted := v_working \+ v_excess/)
})

test('tracking gaps and conservative homeward travel are excluded',()=>{
  assert.match(migration,/telemetry_missing_over_15_minutes/)
  assert.match(migration,/\) \/ extract\(epoch from o\.event_at - o\.prev_at\) > 2\.5/)
  assert.match(migration,/o\.prev_home_distance - o\.distance_home_m >= 250/)
  assert.match(migration,/homeward_travel_and_post_work_idle_excluded/)
  assert.match(migration,/returned\.inside_area is true or returned\.event_type in \('field_start','sale'\)/)
  assert.match(gapGuard,/new\.segment_type = 'tracking_gap'[\s\S]*new\.sph_counted_seconds := 0/)
  assert.match(gapGuard,/before insert or update on private\.field_workday_segments/)
})

test('automatic stops are removed and only midnight closes the session',()=>{
  assert.doesNotMatch(control,/outside_assigned_area|stationary_after_disposition/)
  assert.match(control,/action:'continue'/)
  assert.match(migration,/reason in \('inactive_30_minutes','maximum_16_hours','local_midnight'\)/)
  assert.match(migration,/due\.midnight_at <= clock_timestamp\(\)/)
  assert.doesNotMatch(migration,/now\(\) - interval '30 minutes'/)
})

test('the user starts once and sees no break or stop controls',()=>{
  assert.match(ui,/stop\.hidden=true/)
  assert.match(ui,/No Stop button is required/)
  assert.doesNotMatch(ui,/START BREAK|RESUME KNOCKING/)
})

test('derived records and formulas remain private',()=>{
  assert.match(migration,/revoke all on table private\.field_workdays, private\.field_workday_segments[\s\S]*authenticated/)
  assert.match(migration,/revoke all on function private\.refresh_automatic_field_workdays\(date,timestamptz\)[\s\S]*authenticated/)
})
