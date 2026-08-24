import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const migration=readFileSync(new URL('./supabase/migrations/20260824050000_ghost_automatic_overtake_visibility.sql',import.meta.url),'utf8')
const originalGhost=readFileSync(new URL('./supabase/migrations/20260823090000_ghost_ranking_benchmarks.sql',import.meta.url),'utf8')
const rankingsUi=readFileSync(new URL('./app-compensation.js',import.meta.url),'utf8')
const salesUi=readFileSync(new URL('./app-sales.js',import.meta.url),'utf8')

test('Ghost period totals come from verified Ghost-account sales',()=>{
  assert.match(migration,/private\.get_ghost_actual_period_metrics/)
  assert.match(migration,/lower\(trim\(s\.rep_email\)\)=g\.ghost_email/)
  assert.match(migration,/s\.ranking_eligible is true/)
  assert.match(migration,/s\.verification_status='verified_processed'/)
  assert.match(migration,/'ghost_rank_source','verified_ghost_account_sales'/)
})

test('Ghost is always ranked with real users using the no-tie velocity rule',()=>{
  assert.match(migration,/row_number\(\) over\(order by coalesce\(\(item->>'week_sales'\)::int,0\) desc/)
  assert.match(migration,/elapsed_seconds.*asc nulls last/)
  assert.match(migration,/reached_at.*desc nulls last/)
  assert.match(migration,/'placement_rule','verified_ghost_sales_ranked_with_real_users_ghost_always_visible'/)
  assert.match(rankingsUi,/ghostVisibleFor\(\)/)
})

test('Overtake visibility is automatic and can reset only through Ghost sales',()=>{
  assert.match(migration,/'number_visibility','public_only_while_real_user_ranks_ahead'/)
  assert.match(migration,/'disable_public_reveal_rule','record_verified_ghost_sales_until_ghost_retakes_rank_1'/)
  assert.match(migration,/'all_time_record',false/)
  assert.match(rankingsUi,/sign in to Ghost and record enough verified sales/)
})

test('Tester simulations are verified Ghost ranking and accounting records',()=>{
  assert.doesNotMatch(salesUi,/Tester PKB rankings/)
  assert.match(salesUi,/verified Ghost sale for rankings and accounting/)
  assert.match(originalGhost,/new\.rep_name := 'Ghost'/)
  assert.match(originalGhost,/Ghost recorded a verified %s benchmark simulation/)
})
