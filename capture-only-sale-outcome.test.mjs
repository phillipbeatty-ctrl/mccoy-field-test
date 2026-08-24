import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const sales = fs.readFileSync(new URL('./app-sales.js', import.meta.url), 'utf8')
const submit = fs.readFileSync(new URL('./supabase/functions/sale-submit/index.ts', import.meta.url), 'utf8')
const capture = fs.readFileSync(new URL('./supabase/functions/provider-sale-capture/index.ts', import.meta.url), 'utf8')
const migration = fs.readFileSync(new URL('./supabase/migrations/20260824181500_capture_only_sale_completion.sql', import.meta.url), 'utf8')
const html = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8')

test('provider return shows exactly Complete Sale and Abandoned outcome actions', () => {
  assert.match(sales, /id="completeSaleBtn"[^>]*>COMPLETE SALE<\/button>/)
  assert.match(sales, /id="abandonedSaleBtn"[^>]*>ABANDONED<\/button>/)
  assert.equal((sales.match(/id="completeSaleBtn"/g) || []).length, 1)
  assert.equal((sales.match(/id="abandonedSaleBtn"/g) || []).length, 1)
  assert.doesNotMatch(sales, /SELECT OUTCOME|DECIDE LATER|SAVE COMPLETED SALE|RECORD ABANDONED ORDER/)
})

test('customer and provider-order entry controls are absent from the return flow', () => {
  for (const removedId of [
    'saleFirst', 'saleLast', 'salePhone', 'saleEmail', 'saleAddress', 'saleOrderDate',
    'saleInstallDate', 'saleOrderNumber', 'saleAccountNumber', 'saleConfirm'
  ]) assert.doesNotMatch(sales, new RegExp(`id=["']${removedId}["']`))
  assert.match(sales, /No customer or order details are required in McCoy/)
})

test('Complete Sale sends capture identity and outcome without customer or order fields', () => {
  assert.match(sales, /capture_only_completion:true/)
  assert.match(sales, /provider_capture_id:capture\.id/)
  for (const removedKey of ['customer_first_name', 'customer_last_name', 'provider_order_number', 'provider_account_number', 'install_date', 'order_date']) {
    assert.doesNotMatch(sales, new RegExp(`${removedKey}:`))
  }
})

test('sale-submit accepts only an authenticated capture owned by the signed-in rep', () => {
  assert.match(submit, /admin\.auth\.getUser\(jwt\)/)
  assert.match(submit, /\.eq\('id', captureId\)\s*\.eq\('rep_user_id', user\.id\)/)
  assert.match(submit, /valid_provider_capture_required/)
  assert.match(submit, /provider_capture_abandoned/)
  assert.match(submit, /provider_capture_not_open/)
  assert.match(submit, /\.eq\('provider_capture_id', capture\.id\)/)
  assert.match(submit, /saleError\?\.code === '23505'/)
})

test('capture-only sale stores null details and defers accounting evidence without fabrication', () => {
  assert.match(submit, /customer_first_name: null/)
  assert.match(submit, /customer_last_name: null/)
  assert.match(submit, /provider_order_number: null/)
  assert.match(submit, /provider_account_number: null/)
  assert.match(submit, /install_date: null/)
  assert.match(submit, /order_date: null/)
  assert.match(submit, /status: testerSimulation \? 'authorized_test' : 'pending_provider_evidence'/)
  assert.match(submit, /commission_calculation_status: 'pending_provider_evidence'/)
  assert.doesNotMatch(submit, /GHOST-TEST-|GHOST SIMULATION — NO CUSTOMER|customer_first_name: 'Ghost'/)
})

test('database policy ranks owned capture-only completions while preserving review gates', () => {
  assert.match(migration, /alter column customer_first_name drop not null/)
  assert.match(migration, /alter column customer_last_name drop not null/)
  assert.match(migration, /alter column service_address drop not null/)
  assert.match(migration, /v_capture_only boolean:=new\.provider_capture_id is not null/)
  assert.match(migration, /new\.required_metrics_complete is true or v_capture_only/)
  assert.match(migration, /new\.ranking_credit_excluded is not true/)
  assert.match(migration, /provider_capture_id,ranking_eligible/)
})

test('Abandoned closes the capture without calling sale-submit', () => {
  assert.match(sales, /action:'set_outcome',capture_id:capture\.id,outcome:'abandoned'/)
  assert.match(sales, /No sale or celebration was created/)
})

test('stale field session ids are discarded before a provider capture is inserted', () => {
  assert.match(capture, /\.from\('test_sessions'\)/)
  assert.match(capture, /\.eq\('tester_user_id', user\.id\)/)
  assert.match(capture, /if \(session\?\.id\) sessionId = session\.id/)
})

test('Sales Hub cache-busts the two-button outcome script', () => {
  assert.match(html, /app-sales\.js\?v=2026082417/)
  assert.match(html, /app-sales-products\.js\?v=2026082417/)
})
