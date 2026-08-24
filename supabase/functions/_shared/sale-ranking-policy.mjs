export function isImmediateProcessedSaleRankingEligible(sale = {}) {
  const snapshot = sale.compensation_snapshot && typeof sale.compensation_snapshot === 'object'
    ? sale.compensation_snapshot
    : {}
  const origin = String(snapshot.sale_origin || '').trim().toLowerCase()
  const outsideDecision = String(snapshot?.admin_approval?.status || '').trim().toLowerCase()

  return sale.rep_reported_outcome === 'completed'
    && sale.required_metrics_complete === true
    && String(sale.sale_status || '').trim().toLowerCase() !== 'not_a_sale'
    && String(sale.admin_review_disposition || '').trim().toLowerCase() !== 'not_a_sale'
    && sale.ranking_credit_excluded !== true
    && !(origin === 'outside_system' && outsideDecision === 'rejected')
}
