export const REPORT_SCOPES = Object.freeze(['rep_account', 'dealer_account'])

export const BASS_REPORT_FIELDS = Object.freeze({
  orderNumber: ['Order #', 'CTLOrderID', 'BASS Order ID', 'ASAPOrderID', 'PRID', 'order number', 'order id', 'order', 'confirmation number', 'confirmation #', 'service order number', 'customer order number', 'work order number', 'job number', 'agreement number', 'service agreement number'],
  accountNumber: ['Account Number', 'AccountNumber', 'account #', 'account id', 'customer account', 'customer account number', 'subscriber account number', 'ban'],
  sellerIdentifier: ['Sales Person ID', 'SalesAgentID', 'Sales Person Username', 'SalesAgentUserName', 'SubAgent Username', 'SubAgentUserName', 'seller id', 'agent id', 'rep id', 'sales rep id', 'employee id', 'salesperson id', 'dealer id', 'dealer number', 'dealer code', 'agent number', 'consultant id', 'representative id', 'employee number'],
  sellerName: ['Sales Person Name', 'SalesAgentName', 'seller name', 'agent name', 'rep name', 'sales rep', 'sales rep name', 'salesperson name', 'salesperson', 'agent', 'representative', 'consultant', 'dealer rep', 'submitted by', 'created by'],
  sellerEmail: ['seller email', 'agent email', 'rep email', 'sales rep email'],
  customerName: ['Customer Name', 'CustomerName', 'subscriber name', 'account name', 'customer', 'subscriber', 'name'],
  serviceAddress: ['service address', 'address', 'install address', 'installation address', 'service location', 'customer address', 'property address'],
  streetAddress: ['Street Address', 'StreetAddress', 'street'],
  unit: ['Unit', 'unit number', 'apt', 'apartment'],
  city: ['City'],
  state: ['State'],
  zipCode: ['Zip Code', 'ZipCode', 'Zip', 'postal code'],
  saleDate: ['Create Date', 'Create Time', 'CreateTime', 'sale date', 'order date', 'order entry date', 'created date', 'created at', 'submitted date', 'submitted at', 'submission date', 'contract date', 'agreement date', 'date'],
  providerStatus: ['Order Status', 'OrderStatusCode', 'status', 'sale status', 'order state', 'activation status', 'install status', 'account status', 'disposition']
})

export function parseDelimitedReport(text) {
  const source = String(text ?? '')
  const firstLine = source.split(/\r?\n/, 1)[0] || ''
  const candidates = [',', '\t', ';']
  const delimiter = candidates
    .map(value => ({ value, count: firstLine.split(value).length - 1 }))
    .sort((left, right) => right.count - left.count)[0]
  if (!delimiter?.count) return source.trim() ? [[source.trim()]] : []
  const output = []
  let row = [], cell = '', quoted = false
  for (let index = 0; index < source.length; index++) {
    const current = source[index], next = source[index + 1]
    if (current === '"') {
      if (quoted && next === '"') { cell += '"'; index++ } else quoted = !quoted
    } else if (current === delimiter.value && !quoted) {
      row.push(cell); cell = ''
    } else if ((current === '\n' || current === '\r') && !quoted) {
      if (current === '\r' && next === '\n') index++
      row.push(cell); cell = ''
      if (row.some(value => value.trim())) output.push(row)
      row = []
    } else cell += current
  }
  row.push(cell)
  if (row.some(value => value.trim())) output.push(row)
  return output
}

export const normalizeEvidenceToken = value => String(value ?? '')
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '')

export const isAbandonedProviderStatus = value => /\babandoned\b/i.test(String(value ?? '').trim())

export const pickReportValue = (record, keys) => {
  for (const expected of keys || []) {
    const key = Object.keys(record || {}).find(candidate => normalizeEvidenceToken(candidate) === normalizeEvidenceToken(expected))
    if (key && String(record[key] ?? '').trim()) return String(record[key]).trim()
  }
  return null
}

export function mapReportEvidence(record) {
  const directAddress = pickReportValue(record, BASS_REPORT_FIELDS.serviceAddress)
  const street = pickReportValue(record, BASS_REPORT_FIELDS.streetAddress)
  const unit = pickReportValue(record, BASS_REPORT_FIELDS.unit)
  const locality = [
    pickReportValue(record, BASS_REPORT_FIELDS.city),
    [
      pickReportValue(record, BASS_REPORT_FIELDS.state),
      pickReportValue(record, BASS_REPORT_FIELDS.zipCode)
    ].filter(Boolean).join(' ')
  ].filter(Boolean).join(', ')
  const composedAddress = [street, unit, locality].filter(Boolean).join(', ')
  const sellerEmail = pickReportValue(record, BASS_REPORT_FIELDS.sellerEmail)
  const sellerName = pickReportValue(record, BASS_REPORT_FIELDS.sellerName)
  const sellerIdentifier = pickReportValue(record, BASS_REPORT_FIELDS.sellerIdentifier) || sellerEmail || sellerName
  return {
    orderNumber: pickReportValue(record, BASS_REPORT_FIELDS.orderNumber),
    accountNumber: pickReportValue(record, BASS_REPORT_FIELDS.accountNumber),
    sellerIdentifier,
    sellerName,
    sellerEmail,
    customerName: pickReportValue(record, BASS_REPORT_FIELDS.customerName),
    serviceAddress: directAddress || composedAddress || null,
    saleDate: pickReportValue(record, BASS_REPORT_FIELDS.saleDate),
    providerStatus: pickReportValue(record, BASS_REPORT_FIELDS.providerStatus)
  }
}

export function isBassReportDefinitionXml(text) {
  const source = String(text ?? '')
  if (!/^\s*(?:<\?xml[^>]*>\s*)?<Report(?:\s|>)/i.test(source)) return false
  if (!/<Fields(?:\s|>)/i.test(source) || !/<Search(?:\s|>)/i.test(source)) return false
  const labelPairs = [
    ['CustomerName', 'Customer Name'],
    ['StreetAddress', 'Street Address'],
    ['AccountNumber', 'Account Number'],
    ['SalesAgentID', 'Sales Person ID']
  ]
  const escaped = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return labelPairs.filter(([tag, label]) => new RegExp(`<${tag}>\\s*${escaped(label)}\\s*</${tag}>`, 'i').test(source)).length >= 2
}

function decodeHtmlEntities(value) {
  const named = { amp: '&', apos: "'", gt: '>', lt: '<', nbsp: ' ', quot: '"' }
  return String(value ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    const key = entity.toLowerCase()
    if (key[0] !== '#') return named[key] ?? match
    const codePoint = key[1] === 'x' ? Number.parseInt(key.slice(2), 16) : Number.parseInt(key.slice(1), 10)
    if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return match
    try { return String.fromCodePoint(codePoint) } catch { return match }
  })
}

export function parseHtmlTableReport(text) {
  const source = String(text ?? '')
  if (!/<table(?:\s|>)/i.test(source)) return []
  const rows = []
  for (const rowMatch of source.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = []
    for (const cellMatch of rowMatch[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)) {
      const withoutTags = cellMatch[1]
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]*>/g, '')
      cells.push(decodeHtmlEntities(withoutTags).replace(/\u00a0/g, ' ').trim())
    }
    if (cells.some(Boolean)) rows.push(cells)
  }
  return rows
}

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
