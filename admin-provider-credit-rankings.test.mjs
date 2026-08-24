import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { isImmediateProcessedSaleRankingEligible } from './supabase/functions/_shared/sale-ranking-policy.mjs'

const migration = fs.readFileSync(
  new URL('./supabase/migrations/20260824193000_restore_admin_approved_provider_rankings.sql', import.meta.url),
  'utf8'
)

const completedCapture = {
  rep_reported_outcome: 'completed',
  required_metrics_complete: false,
  provider_capture_id: '89d5d41a-d452-46d5-a701-47a2390f0f30',
  provider_sale_row_id: null,
  verification_status: 'pending_verification',
  sale_status: 'reported',
  admin_review_disposition: null,
  ranking_credit_excluded: false,
  compensation_snapshot: {
    sale_origin: 'mccoy_app',
    capture_only_completion: { enabled: true }
  }
}

const approvedProviderCredit = {
  rep_reported_outcome: null,
  required_metrics_complete: true,
  provider_capture_id: null,
  provider_sale_row_id: '513c3af9-9c3d-427d-ba32-698d7964e2a5',
  verification_status: 'verified_processed',
  credit_assigned_by: 'f9053207-1af1-4ed1-be43-28f4bf5d7732',
  credit_assigned_at: '2026-08-24T19:18:51.377167Z',
  sale_status: 'reported',
  admin_review_disposition: null,
  ranking_credit_excluded: false,
  compensation_snapshot: {
    sale_origin: 'authoritative_provider_ranking_materialization',
    admin_approval: { status: 'approved' }
  }
}

test('Admin-approved provider credit ranks without fabricating a two-button outcome', () => {
  assert.equal(isImmediateProcessedSaleRankingEligible(approvedProviderCredit), true)
  assert.equal(approvedProviderCredit.rep_reported_outcome, null)
})

test('provider evidence alone cannot bypass Admin credit safeguards', () => {
  assert.equal(isImmediateProcessedSaleRankingEligible({
    ...approvedProviderCredit,
    compensation_snapshot: { ...approvedProviderCredit.compensation_snapshot, admin_approval: { status: 'pending' } }
  }), false)
  assert.equal(isImmediateProcessedSaleRankingEligible({ ...approvedProviderCredit, provider_sale_row_id: null }), false)
  assert.equal(isImmediateProcessedSaleRankingEligible({ ...approvedProviderCredit, verification_status: 'low_potential' }), false)
  assert.equal(isImmediateProcessedSaleRankingEligible({ ...approvedProviderCredit, required_metrics_complete: false }), false)
  assert.equal(isImmediateProcessedSaleRankingEligible({ ...approvedProviderCredit, credit_assigned_by: null }), false)
  assert.equal(isImmediateProcessedSaleRankingEligible({ ...approvedProviderCredit, credit_assigned_at: null }), false)
})

test('shared disqualifiers override both eligibility paths', () => {
  for (const eligibleSale of [completedCapture, approvedProviderCredit]) {
    assert.equal(isImmediateProcessedSaleRankingEligible({ ...eligibleSale, sale_status: 'not_a_sale' }), false)
    assert.equal(isImmediateProcessedSaleRankingEligible({ ...eligibleSale, admin_review_disposition: 'not_a_sale' }), false)
    assert.equal(isImmediateProcessedSaleRankingEligible({ ...eligibleSale, ranking_credit_excluded: true }), false)
  }
  assert.equal(isImmediateProcessedSaleRankingEligible({ ...completedCapture, rep_reported_outcome: 'abandoned' }), false)
})

test('migration separates provider Admin credit from the two-button rule', () => {
  assert.match(migration, /v_completed_outcome boolean:=new\.rep_reported_outcome='completed'/)
  assert.match(migration, /v_admin_approved_provider_credit boolean:=new\.provider_sale_row_id is not null/)
  assert.match(migration, /v_admin_decision='approved'/)
  assert.match(migration, /new\.credit_assigned_by is not null/)
  assert.match(migration, /new\.credit_assigned_at is not null/)
  assert.match(migration, /v_completed_outcome or v_admin_approved_provider_credit/)
  assert.match(migration, /provider_sale_row_id,verification_status/)
  assert.match(migration, /credit_assigned_by,credit_assigned_at/)
})

test('backfill is narrow, audited, and never invents a rep outcome', () => {
  assert.match(migration, /sale_origin',''\)='authoritative_provider_ranking_materialization'/)
  assert.match(migration, /insert into public\.sale_ranking_credit_history/)
  assert.match(migration, /'restore'/)
  assert.match(migration, /previous_ranking_eligible,new_ranking_eligible/)
  assert.match(migration, /raise exception 'Admin-approved provider credit backfill did not produce ranking eligibility'/)
  assert.doesNotMatch(migration, /set\s+rep_reported_outcome\s*=/i)
})
