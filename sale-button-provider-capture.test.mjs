import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const lifecycle=readFileSync(new URL('./app-sale-lifecycle.js',import.meta.url),'utf8')
const sales=readFileSync(new URL('./app-sales.js',import.meta.url),'utf8')
const captureFunction=readFileSync(new URL('./supabase/functions/provider-sale-capture/index.ts',import.meta.url),'utf8')
const saleSubmit=readFileSync(new URL('./supabase/functions/sale-submit/index.ts',import.meta.url),'utf8')
const index=readFileSync(new URL('./index.html',import.meta.url),'utf8')

test('the visible SALE button starts the standard provider dashboard flow',()=>{
  assert.match(lifecycle,/button\.id='processSaleBtn'/)
  assert.match(lifecycle,/button\.dataset\.disp='Sale'/)
  assert.match(lifecycle,/button\.textContent='SALE'/)
  assert.match(lifecycle,/button\.hidden=false/)
  assert.doesNotMatch(lifecycle,/button\.remove\(\)/)
  assert.doesNotMatch(lifecycle,/new\s+MutationObserver|MutationObserver\s*\(/)
  assert.match(index,/app-sale-lifecycle\.js\?v=2026090201/)
  assert.match(index,/app-sale-photo-staging\.js\?v=2026091403/)
})

test('COMPLETE SALE is submitted once to the server without a synthetic validation click',()=>{
  assert.doesNotMatch(lifecycle,/#completeSaleBtn,#abandonedSaleBtn/)
  assert.doesNotMatch(lifecycle,/mccoyCaptureValidated|CHECKING CAPTURE/)
  assert.match(sales,/sb\.functions\.invoke\('sale-submit',\{body\}\)/)
  assert.match(sales,/byId\('completeSaleBtn'\)\?\.addEventListener\('click',completeSale\)/)
  assert.match(sales,/setSaleMsg\(error\?\.message\|\|'Sale could not be completed/)
})

test('open-capture recovery remains current-user scoped even for Admin',()=>{
  assert.match(captureFunction,/const mineOnly = body\.mine_only === true \|\| body\.open_only === true/)
  assert.match(captureFunction,/if \(!isAdmin \|\| mineOnly\) query = query\.eq\('rep_user_id', user\.id\)/)
  assert.match(captureFunction,/scope: mineOnly \? 'current_user'/)
})

test('sale-submit is the atomic authority for owner and open-status validation',()=>{
  assert.match(saleSubmit,/\.eq\('rep_user_id', user\.id\)/)
  assert.match(saleSubmit,/provider_capture_not_found/)
  assert.match(saleSubmit,/provider_capture_abandoned/)
  assert.match(saleSubmit,/provider_capture_not_open/)
  assert.match(saleSubmit,/\.from\('sales_records'\)[\s\S]*\.insert\(saleRow\)/)
  assert.match(saleSubmit,/status: 'recorded', rep_outcome: 'completed'/)
})
