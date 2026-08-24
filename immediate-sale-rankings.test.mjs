import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { isImmediateProcessedSaleRankingEligible } from './supabase/functions/_shared/sale-ranking-policy.mjs'

const migration = fs.readFileSync(new URL('./supabase/migrations/20260824173000_immediate_completed_sale_rankings.sql', import.meta.url), 'utf8')
const submit = fs.readFileSync(new URL('./supabase/functions/sale-submit/index.ts', import.meta.url), 'utf8')
const reconcile = fs.readFileSync(new URL('./supabase/functions/provider-reconcile/index.ts', import.meta.url), 'utf8')
const capture = fs.readFileSync(new URL('./supabase/functions/provider-sale-capture/index.ts', import.meta.url), 'utf8')
const router = fs.readFileSync(new URL('./app-provider-sale-router.js', import.meta.url), 'utf8')
const sales = fs.readFileSync(new URL('./app-sales.js', import.meta.url), 'utf8')

const valid = {
  rep_reported_outcome: 'completed',
  required_metrics_complete: true,
  sale_status: 'reported',
  admin_review_disposition: null,
  ranking_credit_excluded: false,
  compensation_snapshot: { sale_origin: 'mccoy_app' }
}

test('complete McCoy sales rank immediately independent of provider status', () => {
  assert.equal(isImmediateProcessedSaleRankingEligible(valid), true)
  assert.equal(isImmediateProcessedSaleRankingEligible({ ...valid, verification_status: 'low_potential' }), true)
  assert.equal(isImmediateProcessedSaleRankingEligible({ ...valid, verification_status: 'mismatch' }), true)
  assert.equal(isImmediateProcessedSaleRankingEligible({ ...valid, sale_status: 'cancelled' }), true)
})

test('unfinished and disqualified records never become ranking sales', () => {
  assert.equal(isImmediateProcessedSaleRankingEligible({ ...valid, rep_reported_outcome: 'abandoned' }), false)
  assert.equal(isImmediateProcessedSaleRankingEligible({ ...valid, required_metrics_complete: false }), false)
  assert.equal(isImmediateProcessedSaleRankingEligible({ ...valid, sale_status: 'not_a_sale' }), false)
  assert.equal(isImmediateProcessedSaleRankingEligible({ ...valid, admin_review_disposition: 'not_a_sale' }), false)
  assert.equal(isImmediateProcessedSaleRankingEligible({ ...valid, ranking_credit_excluded: true }), false)
  assert.equal(isImmediateProcessedSaleRankingEligible({ ...valid, compensation_snapshot: { sale_origin: 'outside_system', admin_approval: { status: 'rejected' } } }), false)
})

test('owned capture-only completions rank without customer or order metrics', () => {
  const captureOnly = {
    ...valid,
    provider_capture_id: '89d5d41a-d452-46d5-a701-47a2390f0f30',
    required_metrics_complete: false,
    compensation_snapshot: {
      sale_origin: 'mccoy_app',
      capture_only_completion: { enabled: true }
    }
  }
  assert.equal(isImmediateProcessedSaleRankingEligible(captureOnly), true)
  assert.equal(isImmediateProcessedSaleRankingEligible({ ...captureOnly, provider_capture_id: null }), false)
  assert.equal(isImmediateProcessedSaleRankingEligible({ ...captureOnly, rep_reported_outcome: 'abandoned' }), false)
})

test('sale commit, reconciliation, and SQL share the immediate ranking policy', () => {
  assert.match(submit, /ranking_eligible: true/)
  assert.match(reconcile, /isImmediateProcessedSaleRankingEligible/)
  assert.match(migration, /sales_records_zz_processed_ranking_policy/)
  assert.match(migration, /new\.rep_reported_outcome='completed'/)
  assert.match(migration, /new\.required_metrics_complete is true/)
  assert.match(migration, /new\.ranking_credit_excluded is not true/)
  assert.match(migration, /if new\.ranking_eligible is not true then/)
})

test('unfinished provider captures recover from Supabase after local state loss', () => {
  assert.match(capture, /client_request_id,created_at/)
  assert.match(router, /captureCall\('list',\{open_only:true\}\)/)
  assert.match(router, /recovered_from_server:true/)
  assert.match(router, /mccoy-provider-sale-capture-restored/)
})

test('successful save refreshes local and cross-device ranking surfaces immediately', () => {
  assert.match(sales, /mccoy-sale-saved/)
  assert.match(sales, /Promise\.allSettled\(\[loadFeed\(\),window\.MCCOY_REFRESH_RANKINGS\?\.\(\)\]\)/)
  assert.match(sales, /Ranking live/)
})
