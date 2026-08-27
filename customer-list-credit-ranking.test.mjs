import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const migration = readFileSync(
  new URL('./supabase/migrations/20260827183000_customer_list_credit_reassignment_rankings.sql', import.meta.url),
  'utf8'
)
const refresh = readFileSync(new URL('./app-customer-list-credit-ranking-refresh.js', import.meta.url), 'utf8')
const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8')

test('approved Customer List credit uses the Admin-selected user as ranking owner', () => {
  assert.match(migration, /v_admin_approved_customer_list_credit/)
  assert.match(migration, /rep_user_id=v_target_id/)
  assert.match(migration, /rep_email=v_target_email/)
  assert.match(migration, /rep_name=v_target_name/)
  assert.match(migration, /ranking_eligible=case when v_customer_list_approved then true/)
  assert.match(migration, /credit_assignment_reason=v_reason/)
  assert.match(migration, /Admin reassigned in CUSTOMER LIST/)
})

test('credit reassignment preserves original/provider identity and creates audit history', () => {
  assert.match(migration, /provider_reported_rep_user_id=coalesce/)
  assert.match(migration, /provider_reported_rep_email=coalesce/)
  assert.match(migration, /provider_reported_rep_name=coalesce/)
  assert.match(migration, /insert into public\.sale_credit_assignment_history/)
  assert.match(migration, /insert into public\.sale_admin_edit_history/)
  assert.match(migration, /insert into public\.sale_ranking_credit_history/)
})

test('Live Wins ownership follows the ranking owner without replaying animation', () => {
  assert.match(migration, /update public\.sales_feed set/)
  assert.match(migration, /rep_user_id=v_after\.rep_user_id/)
  assert.match(migration, /rep_name=v_after\.rep_name/)
  assert.match(migration, /animation_enabled=false/)
  assert.match(migration, /sale_credit_updated/)
})

test('Customer List save refreshes both Admin and rep ranking dashboards immediately', () => {
  assert.match(refresh, /admin_edit_customer_list_sale/)
  assert.match(refresh, /mccoy-live-sales-changed/)
  assert.match(refresh, /mccoy-sale-credit-changed/)
  assert.match(refresh, /mccoy-rankings-changed/)
  assert.match(refresh, /MCCOY_REFRESH_RANKINGS/)
  assert.doesNotMatch(refresh, /MutationObserver/)
  assert.match(html, /app-customer-list-credit-ranking-refresh\.js\?v=2026082701/)
})

test('the post-deployment inconsistent reassignment is repaired by a narrow predicate', () => {
  assert.match(migration, /credit_assigned_at>=timestamptz '2026-08-27 17:25:00\+00'/)
  assert.match(migration, /credit_assignment_reason='Admin reassigned in CUSTOMER LIST'/)
  assert.match(migration, /Repair Customer List credited-user ranking transfer/)
})
