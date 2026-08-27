import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const ui = readFileSync(new URL('./app-customer-list-approval-refresh.js', import.meta.url), 'utf8')
const migration = readFileSync(
  new URL('./supabase/migrations/20260827173000_admin_customer_list_sale_edit.sql', import.meta.url),
  'utf8'
)
const typeFixMigration = readFileSync(
  new URL('./supabase/migrations/20260827175500_fix_admin_sale_edit_chargeback_type.sql', import.meta.url),
  'utf8'
)

test('approved Customer List sales are editable without losing approval', () => {
  assert.match(ui, /admin_edit_customer_list_sale/)
  assert.match(ui, /This sale remains approved and stays in Customer List/)
  assert.match(ui, /It remains approved in Customer List/)
  assert.match(migration, /admin_edit_any_sale/)
  assert.match(migration, /admin_assign_any_sale_user/)
  assert.doesNotMatch(migration, /verification_status\s*=/)
  assert.doesNotMatch(migration, /admin_approval\s*-/)
})

test('NOT A SALE immediately returns Customer List row to SALE REVIEW', () => {
  assert.match(ui, /admin_return_sale_to_review/)
  assert.match(ui, /row\?\.remove\(\)/)
  assert.match(ui, /mccoy-sale-review-changed/)
  assert.match(ui, /original processed timestamp and customer information were preserved/)
  assert.doesNotMatch(ui, /admin_set_sale_review_disposition/)
})

test('Admin Review ISP is a dropdown sourced from the Sales Hub provider list', () => {
  assert.match(ui, /document\.getElementById\('sessionIsp'\)/)
  assert.match(ui, /select\.dataset\.adminReviewProvider='1'/)
  assert.match(ui, /input\[data-field="isp"\]/)
  assert.match(ui, /new Option\('Choose provider…',''\)/)
  assert.match(ui, /admin_edit_any_sale/)
})

test('Customer List patch avoids the runaway observer pattern', () => {
  assert.doesNotMatch(ui, /new\s+MutationObserver|MutationObserver\s*\(/)
  assert.match(ui, /bounded timers and event delegation/)
  assert.match(ui, /scheduleRowPatch/)
})

test('Admin sale edit keeps commission_chargeback_applied numeric', () => {
  assert.match(typeFixMigration, /commission_chargeback_applied\s*=\s*case[\s\S]*::numeric/)
  assert.doesNotMatch(
    typeFixMigration,
    /commission_chargeback_applied\s*=\s*case[\s\S]*::boolean[\s\S]*else\s+s\.commission_chargeback_applied/
  )
  assert.match(typeFixMigration, /match sales_records/)
})
