export const REPORT_SCOPES = Object.freeze(['rep_account', 'dealer_account'])

export const normalizeEvidenceToken = value => String(value ?? '')
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '')

export function matchingEvidenceRows(rows, orderNumber, accountNumber) {
  const order = normalizeEvidenceToken(orderNumber)
  const account = normalizeEvidenceToken(accountNumber)
  if (!order && !account) return []
  return (rows || []).filter(row => (
    (order && normalizeEvidenceToken(row?.order_number) === order)
    || (account && normalizeEvidenceToken(row?.account_number) === account)
  ))
}

export function rowMatchesSeller(row, sellerIdentifiers) {
  const identifiers = sellerIdentifiers instanceof Set
    ? sellerIdentifiers
    : new Set((sellerIdentifiers || []).map(normalizeEvidenceToken).filter(Boolean))
  return [row?.seller_identifier, row?.seller_email, row?.seller_name]
    .some(value => identifiers.has(normalizeEvidenceToken(value)))
}

export function classifySaleEvidence({
  rows,
  repUserId,
  sellerIdentifiers,
  orderNumber,
  accountNumber
}) {
  const matches = matchingEvidenceRows(rows, orderNumber, accountNumber)
  if (!matches.length) {
    return { status: 'low_potential', reason: 'not_yet_in_provider_reports', row: null }
  }

  const dealerMatches = matches.filter(row => row?.evidence_scope !== 'rep_account')
  const ownRepMatches = matches.filter(row => (
    row?.evidence_scope === 'rep_account'
    && String(row?.source_rep_user_id || '') === String(repUserId || '')
  ))
  const otherRepMatch = matches.find(row => (
    row?.evidence_scope === 'rep_account'
    && String(row?.source_rep_user_id || '') !== String(repUserId || '')
  ))

  if (dealerMatches.length) {
    const identifiers = sellerIdentifiers instanceof Set
      ? sellerIdentifiers
      : new Set((sellerIdentifiers || []).map(normalizeEvidenceToken).filter(Boolean))
    if (!identifiers.size) {
      return {
        status: 'pending_verification',
        reason: 'seller_account_not_linked',
        row: dealerMatches[0]
      }
    }
    const dealerSellerMatch = dealerMatches.find(row => rowMatchesSeller(row, identifiers))
    if (dealerSellerMatch) {
      return {
        status: 'verified_processed',
        reason: ownRepMatches.length
          ? 'rep_and_dealer_reports_match'
          : 'dealer_report_and_seller_match',
        row: dealerSellerMatch
      }
    }
    return {
      status: 'mismatch',
      reason: 'dealer_order_found_but_seller_does_not_match_linked_mccoy_user',
      row: dealerMatches[0]
    }
  }

  if (ownRepMatches.length) {
    return {
      status: 'pending_verification',
      reason: 'rep_report_match_awaiting_dealer_cross_check',
      row: ownRepMatches[0]
    }
  }

  if (otherRepMatch) {
    return {
      status: 'mismatch',
      reason: 'order_appears_in_another_reps_account_report',
      row: otherRepMatch
    }
  }

  return { status: 'low_potential', reason: 'not_yet_in_provider_reports', row: null }
}

function comparableSellerConflict(repRow, dealerRow) {
  let compared = false
  for (const key of ['seller_identifier', 'seller_email', 'seller_name']) {
    const repValue = normalizeEvidenceToken(repRow?.[key])
    const dealerValue = normalizeEvidenceToken(dealerRow?.[key])
    if (!repValue || !dealerValue) continue
    compared = true
    if (repValue === dealerValue) return false
  }
  return compared
}

function dateOnly(value) {
  const text = String(value ?? '').trim()
  if (!text) return null
  const parsed = new Date(text)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10)
}

export function crossReferenceRepRow(repRow, dealerRows, periodStart, periodEnd) {
  const matches = matchingEvidenceRows(dealerRows, repRow?.order_number, repRow?.account_number)
  if (matches.length) {
    const compatible = matches.find(row => !comparableSellerConflict(repRow, row))
    if (compatible) {
      return { status: 'matched_dealer', dealerRowId: compatible.id || null }
    }
    return { status: 'conflict', dealerRowId: matches[0]?.id || null }
  }

  if (!periodStart || !periodEnd) {
    return { status: 'period_unknown', dealerRowId: null }
  }
  const saleDate = dateOnly(repRow?.sale_date)
  if (!saleDate) return { status: 'period_unknown', dealerRowId: null }
  if (saleDate < periodStart || saleDate > periodEnd) {
    return { status: 'pending_dealer', dealerRowId: null }
  }
  return { status: 'missing_from_dealer', dealerRowId: null }
}

export function safeReportPayload(record) {
  const blocked = /(password|passcode|secret|token|social.?security|\bssn\b|routing|bank.?account|credit.?card|\bcvv\b|security.?code|\bpin\b)/i
  return Object.fromEntries(Object.entries(record || {}).filter(([key]) => !blocked.test(key)))
}
