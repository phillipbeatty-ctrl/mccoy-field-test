import test from 'node:test'
import assert from 'node:assert/strict'
import {
  classifySaleEvidence,
  crossReferenceRepRow,
  safeReportPayload
} from './provider-report-core.mjs'

const dealer = {
  id: 'dealer-row', evidence_scope: 'dealer_account', order_number: 'BASS-101',
  seller_identifier: 'agent-7', sale_date: '2026-08-10'
}
const rep = {
  id: 'rep-row', evidence_scope: 'rep_account', source_rep_user_id: 'rep-1',
  order_number: 'BASS-101', seller_identifier: 'agent-7', sale_date: '2026-08-10'
}

test('rep-account evidence remains preliminary until dealer evidence arrives', () => {
  assert.deepEqual(classifySaleEvidence({
    rows: [rep], repUserId: 'rep-1', sellerIdentifiers: ['agent-7'], orderNumber: 'BASS-101'
  }), {
    status: 'pending_verification',
    reason: 'rep_report_match_awaiting_dealer_cross_check',
    row: rep
  })
})

test('dealer evidence plus linked seller verifies and recognizes rep corroboration', () => {
  const result = classifySaleEvidence({
    rows: [rep, dealer], repUserId: 'rep-1', sellerIdentifiers: ['agent-7'], orderNumber: 'BASS-101'
  })
  assert.equal(result.status, 'verified_processed')
  assert.equal(result.reason, 'rep_and_dealer_reports_match')
  assert.equal(result.row.id, 'dealer-row')
})

test('evidence uploaded by another rep is a mismatch', () => {
  const result = classifySaleEvidence({
    rows: [{ ...rep, source_rep_user_id: 'rep-2' }], repUserId: 'rep-1',
    sellerIdentifiers: ['agent-7'], orderNumber: 'BASS-101'
  })
  assert.equal(result.status, 'mismatch')
  assert.equal(result.reason, 'order_appears_in_another_reps_account_report')
})

test('dealer cross-reference distinguishes matches, conflicts, and covered-period omissions', () => {
  assert.deepEqual(crossReferenceRepRow(rep, [dealer], '2026-08-01', '2026-08-31'), {
    status: 'matched_dealer', dealerRowId: 'dealer-row'
  })
  assert.equal(crossReferenceRepRow(rep, [{ ...dealer, seller_identifier: 'agent-9' }], '2026-08-01', '2026-08-31').status, 'conflict')
  assert.equal(crossReferenceRepRow(
    { ...rep, seller_email: 'rep@example.com' },
    [{ ...dealer, seller_identifier: 'agent-9', seller_email: 'rep@example.com' }],
    '2026-08-01',
    '2026-08-31'
  ).status, 'matched_dealer')
  assert.equal(crossReferenceRepRow(rep, [], '2026-08-01', '2026-08-31').status, 'missing_from_dealer')
  assert.equal(crossReferenceRepRow({ ...rep, sale_date: null }, [], '2026-08-01', '2026-08-31').status, 'period_unknown')
})

test('arbitrary report payloads exclude credential and financial-secret columns', () => {
  assert.deepEqual(safeReportPayload({ Order: '101', Password: 'nope', SSN: 'nope', Address: '1 Main' }), {
    Order: '101', Address: '1 Main'
  })
})
