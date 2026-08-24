import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const migration = readFileSync(
  new URL('./supabase/migrations/20260823092500_rank_every_real_user_sales_per_hour.sql', import.meta.url),
  'utf8'
)
const ui = readFileSync(new URL('./app-compensation.js', import.meta.url), 'utf8')

test('equal totals rank by faster accumulation then later matching sale', () => {
  assert.match(migration, /today_sales desc, today_elapsed_seconds asc nulls last, today_reached_at desc nulls last/)
  assert.match(migration, /week_sales desc, week_elapsed_seconds asc nulls last, week_reached_at desc nulls last/)
  assert.match(migration, /month_sales desc, month_elapsed_seconds asc nulls last, month_reached_at desc nulls last/)
  assert.match(migration, /year_sales desc, year_elapsed_seconds asc nulls last, year_reached_at desc nulls last/)
  assert.match(migration, /equal_sales_faster_elapsed_accumulation_then_later_goal_time_wins_no_shared_rank/)
  assert.match(ui, /Equal totals: faster accumulation wins/)
})

test('weekly sales per hour uses verified sales and bounded tracked session time', () => {
  assert.match(migration, /week_sales_per_hour/)
  assert.match(migration, /week_tracked_hours/)
  assert.match(migration, /ts\.started_at \+ interval '16 hours'/)
  assert.match(migration, /least\(daily_seconds, 57600::numeric\)/)
  assert.match(migration, /sales_per_hour_rank/)
  assert.doesNotMatch(migration, /case when week_tracked_hours > 0 then row_number/)
  assert.match(migration, /else 0::numeric/)
  assert.match(ui, /Sales\/Hr \(Week\)/)
  assert.match(ui, /SPH Rank/)
})

test('Ghost is excluded from sales per hour', () => {
  assert.match(migration, /'sales_per_hour', null/)
  assert.match(migration, /'sales_per_hour', null\s*\n\s*\)/)
  assert.match(migration, /Ghost is excluded from sales\/hour and all-time records/)
  assert.match(ui, /if\(rep\?\.is_ghost\)return \{rate:'Excluded'/)
})
