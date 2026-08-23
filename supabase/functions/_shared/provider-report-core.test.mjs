import test from 'node:test'
import assert from 'node:assert/strict'
import {
  classifySaleEvidence,
  crossReferenceRepRow,
  isAbandonedProviderStatus,
  isBassReportDefinitionXml,
  mapReportEvidence,
  parseDelimitedReport,
  parseHtmlTableReport,
  safeReportPayload
} from './provider-report-core.mjs'

test('ABANDONED status matching is exact and case-insensitive', () => {
  assert.equal(isAbandonedProviderStatus('ABANDONED'), true)
  assert.equal(isAbandonedProviderStatus(' abandoned '), true)
  assert.equal(isAbandonedProviderStatus('ABANDONED - duplicate'), true)
  assert.equal(isAbandonedProviderStatus('CANCELLED'), false)
  assert.equal(isAbandonedProviderStatus('Not abandoned'), true)
})

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

test('real BASS column labels map order, seller, address, date, and status evidence', () => {
  assert.deepEqual(mapReportEvidence({
    'Order #': 'CTL-101',
    'Account Number': 'ACCT-9',
    'Sales Person ID': 'agent-7',
    'Sales Person Name': 'Test Rep',
    'Customer Name': 'Test Customer',
    'Street Address': '10 Test St',
    Unit: '2A',
    City: 'Testville',
    State: 'TX',
    'Zip Code': '75001',
    'Create Time': '2026-08-20',
    'Order Status': 'Complete'
  }), {
    orderNumber: 'CTL-101',
    accountNumber: 'ACCT-9',
    sellerIdentifier: 'agent-7',
    sellerName: 'Test Rep',
    sellerEmail: null,
    customerName: 'Test Customer',
    serviceAddress: '10 Test St, 2A, Testville, TX 75001',
    saleDate: '2026-08-20',
    providerStatus: 'Complete'
  })
})

test('DIRECTV and Vivint-style report labels map into the shared evidence contract', () => {
  assert.deepEqual(mapReportEvidence({
    'Agreement Number': 'DTV-1001',
    'Customer Account Number': 'DTV-A-9',
    'Dealer ID': 'dealer-42',
    'Sales Rep Name': 'Example Rep',
    Customer: 'DIRECTV Customer',
    'Installation Address': '100 Satellite Way',
    'Order Entry Date': '2026-08-22',
    'Activation Status': 'Active'
  }), {
    orderNumber: 'DTV-1001', accountNumber: 'DTV-A-9', sellerIdentifier: 'dealer-42',
    sellerName: 'Example Rep', sellerEmail: null, customerName: 'DIRECTV Customer',
    serviceAddress: '100 Satellite Way', saleDate: '2026-08-22', providerStatus: 'Active'
  })
  assert.deepEqual(mapReportEvidence({
    'Service Agreement Number': 'VIV-2002',
    'Subscriber Account Number': 'VIV-A-7',
    'Consultant ID': 'consultant-8',
    Consultant: 'Vivint Rep',
    Subscriber: 'Vivint Customer',
    'Service Location': '200 Security Ln',
    'Contract Date': '2026-08-23',
    'Install Status': 'Scheduled'
  }), {
    orderNumber: 'VIV-2002', accountNumber: 'VIV-A-7', sellerIdentifier: 'consultant-8',
    sellerName: 'Vivint Rep', sellerEmail: null, customerName: 'Vivint Customer',
    serviceAddress: '200 Security Ln', saleDate: '2026-08-23', providerStatus: 'Scheduled'
  })
})

test('shared report parser accepts CSV and tab-delimited provider exports', () => {
  assert.deepEqual(parseDelimitedReport('Order Number,Sales Rep Name\nDTV-1,"Rep, One"'), [
    ['Order Number', 'Sales Rep Name'], ['DTV-1', 'Rep, One']
  ])
  assert.deepEqual(parseDelimitedReport('Service Agreement Number\tConsultant\nVIV-1\tRep Two'), [
    ['Service Agreement Number', 'Consultant'], ['VIV-1', 'Rep Two']
  ])
})

test('BASS report-definition XML is distinguished from order-result data', () => {
  const definition = `<?xml version="1.0"?><Report><Fields><SalesAgentID>Sales Person ID</SalesAgentID><CustomerName>Customer Name</CustomerName><StreetAddress>Street Address</StreetAddress><AccountNumber>Account Number</AccountNumber></Fields><Search><SalesAgentName1>Example Rep</SalesAgentName1></Search></Report>`
  assert.equal(isBassReportDefinitionXml(definition), true)
  assert.equal(isBassReportDefinitionXml('Order #,Account Number\nCTL-1,A-1'), false)
})

test('BASS HTML-table XLS rows parse without retaining markup', () => {
  const rows = parseHtmlTableReport('<table><tr><td><b>Order #</b></td><td>Sales Person ID</td><td>Street</td><td>City</td><td>State</td><td>Zip</td><td>Create Date</td></tr><tr style="x"><td>CTL-1</td><td>A&amp;7</td><td>10 Test St</td><td>Austin</td><td>TX</td><td>78701</td><td>08/20/2026 12:00 PM</td></tr></table>')
  assert.deepEqual(rows, [
    ['Order #', 'Sales Person ID', 'Street', 'City', 'State', 'Zip', 'Create Date'],
    ['CTL-1', 'A&7', '10 Test St', 'Austin', 'TX', '78701', '08/20/2026 12:00 PM']
  ])
  assert.equal(mapReportEvidence(Object.fromEntries(rows[0].map((header, index) => [header, rows[1][index]]))).serviceAddress, '10 Test St, Austin, TX 78701')
})
