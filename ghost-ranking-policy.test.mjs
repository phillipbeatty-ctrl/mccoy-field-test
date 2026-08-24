import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const migration = readFileSync(
  new URL('./supabase/migrations/20260823090000_ghost_ranking_benchmarks.sql', import.meta.url),
  'utf8'
)
const rankingsUi = readFileSync(new URL('./app-compensation.js', import.meta.url), 'utf8')
const salesUi = readFileSync(new URL('./app-sales.js', import.meta.url), 'utf8')

test('Ghost uses the required real-rep benchmark totals', () => {
  assert.match(migration, /day_goal integer not null default 3 check \(day_goal >= 3\)/)
  assert.match(migration, /week_goal integer not null default 15 check \(week_goal >= 15\)/)
  assert.match(migration, /month_goal integer not null default 30 check \(month_goal >= 30\)/)
  assert.match(migration, /year_goal integer not null default 600 check \(year_goal >= 600\)/)
  assert.match(migration, /today_sales >= s\.day_goal/)
  assert.match(migration, /week_sales >= s\.week_goal/)
  assert.match(migration, /month_sales >= s\.month_goal/)
  assert.match(migration, /year_sales >= s\.year_goal/)
})

test('Ghost is first, second, then hidden as zero, one, or two real reps reach a goal', () => {
  assert.match(migration, /b\.today_passed < 2 then b\.today_passed \+ 1 else null/)
  assert.match(migration, /'placement_rule', 'zero_reps_at_goal_rank_1_one_rep_at_goal_rank_2_two_reps_at_goal_hidden'/)
  assert.match(migration, /'comparison', 'greater_than_or_equal'/)
  assert.match(rankingsUi, /ghostVisibleFor\(rep,selectedRankingPeriod\)/)
})

test('Ghost goals are Admin-managed, hidden until reached, and never all-time', () => {
  assert.match(migration, /not public\.is_mccoy_admin\(\)/)
  assert.match(migration, /'goals_hidden_until_first_rep_reaches_them', true/)
  assert.match(migration, /'all_time_sales', null/)
  assert.match(migration, /'all_time_record', false/)
  assert.match(rankingsUi, /Ghost Benchmark Controls/)
})

test('Tester simulations are recorded and celebrated only as Ghost', () => {
  assert.doesNotMatch(salesUi, /Tester PKB rankings/)
  assert.match(salesUi, /Ghost leaderboard row follows Admin benchmark rules/)
  assert.match(migration, /new\.rep_name := 'Ghost'/)
  assert.match(migration, /Ghost recorded a verified %s benchmark simulation/)
})
