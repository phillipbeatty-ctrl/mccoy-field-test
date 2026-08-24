import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const migration = readFileSync(
  new URL('./supabase/migrations/20260824221500_remove_admin_deleted_sales_from_bank.sql', import.meta.url),
  'utf8'
)
const bankMigration = readFileSync(
  new URL('./supabase/migrations/20260823063000_admin_provider_evidence_resolution.sql', import.meta.url),
  'utf8'
)
const adminUi = readFileSync(new URL('./app-admin-sale-credit.js', import.meta.url), 'utf8')
const customerUi = readFileSync(new URL('./app-accounting-records.js', import.meta.url), 'utf8')
const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8')

test('Admin NOT A SALE synchronizes the linked ISP evidence out of the active bank', () => {
  assert.match(migration, /p\.id=v_before\.provider_sale_row_id or p\.materialized_sale_id=p_sale_id/)
  assert.match(migration, /admin_evidence_disposition='not_a_sale'/)
  assert.match(migration, /admin_evidence_reason='admin_sale_removed: '\|\|trim\(p_reason\)/)
  assert.match(migration, /ranking_eligible=false/)
  assert.match(migration, /competition_eligible=false/)
  assert.match(migration, /sale_status='not_a_sale'/)
})

test('active bank queries exclude removed provider and McCoy sale rows', () => {
  assert.match(bankMigration, /p\.admin_evidence_disposition is distinct from 'not_a_sale'/)
  assert.match(bankMigration, /s\.sale_status<>'not_a_sale'/)
  assert.match(bankMigration, /lower\(coalesce\(p\.provider_status,''\)\) !~ '\(abandon\|cancel\)'/)
})

test('removal remains audited instead of deleting sale or provider rows', () => {
  assert.match(migration, /insert into public\.provider_sale_evidence_review_history/)
  assert.match(migration, /insert into public\.sale_review_disposition_history/)
  assert.doesNotMatch(migration, /delete\s+from\s+public\.(sales_records|provider_sales_rows)/i)
})

test('restore reverses only the linked removal and preserves an earlier provider decision', () => {
  assert.match(migration, /admin_evidence_reason,''\) like 'admin_sale_removed:%'/)
  assert.match(migration, /select h\.previous_disposition into v_previous_provider_disposition/)
  assert.match(migration, /admin_evidence_disposition=v_previous_provider_disposition/)
  assert.match(migration, /v_effective_provider_disposition is null/)
  assert.match(migration, /'admin_sale_restored: '\|\|trim\(p_reason\)/)
})

test('existing linked Admin removals are synchronized during migration', () => {
  assert.match(migration, /where s\.sale_status='not_a_sale'/)
  assert.match(migration, /s\.admin_review_disposition='not_a_sale'/)
  assert.match(migration, /join auth\.users u on u\.id=s\.admin_reviewed_by/)
  assert.match(migration, /Historical Admin sale removal/)
})

test('removed evidence is outside the Sales Bank and remains restorable in its own audit area', () => {
  assert.match(adminUi, /<h2>Removed Sales Audit<\/h2>/)
  assert.match(adminUi, /They are not part of the Sales Bank, rankings, or earned-sale accounting/)
  const bankRenderStart = adminUi.indexOf('root.innerHTML=`<p><strong>')
  const removedRenderStart = adminUi.indexOf("const removedRoot=document.getElementById('saleRemovedRows')")
  assert.ok(bankRenderStart >= 0 && removedRenderStart > bankRenderStart)
  assert.doesNotMatch(adminUi.slice(bankRenderStart, removedRenderStart), /Denied provider evidence/)
  assert.match(adminUi, /RESTORE TO SALES BANK/)
})

test('every Admin removal entry point explains the Sales Bank effect', () => {
  assert.match(adminUi, /NOT A SALE · REMOVE FROM BANK/)
  assert.match(adminUi, /removed from the Sales Bank, rankings, Customer List, and earned-sale accounting/)
  assert.match(customerUi, /linked ISP evidence from the Sales Bank, Customer List, rankings, and earned-sale accounting/)
  assert.match(html, /app-admin-sale-credit\.js\?v=2026082422/)
  assert.match(html, /app-accounting-records\.js\?v=2026082422/)
})
