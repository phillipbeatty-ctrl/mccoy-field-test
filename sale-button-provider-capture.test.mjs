import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const lifecycle=readFileSync(new URL('./app-sale-lifecycle.js',import.meta.url),'utf8')
const captureFunction=readFileSync(new URL('./supabase/functions/provider-sale-capture/index.ts',import.meta.url),'utf8')
const layout=readFileSync(new URL('./app-page-layout.js',import.meta.url),'utf8')

test('the visible SALE button starts the standard provider dashboard flow',()=>{
  assert.match(lifecycle,/button\.id='processSaleBtn'/)
  assert.match(lifecycle,/button\.dataset\.disp='Sale'/)
  assert.match(lifecycle,/button\.textContent='SALE'/)
  assert.match(lifecycle,/button\.hidden=false/)
  assert.match(lifecycle,/button\.click\(\)/)
  assert.doesNotMatch(lifecycle,/button\.remove\(\)/)
  assert.doesNotMatch(lifecycle,/new\s+MutationObserver|MutationObserver\s*\(/)
  assert.match(layout,/app-sale-lifecycle\.js\?v=2026082801/)
})

test('open-capture recovery is current-user scoped even for Admin',()=>{
  assert.match(captureFunction,/const mineOnly = body\.mine_only === true \|\| body\.open_only === true/)
  assert.match(captureFunction,/if \(!isAdmin \|\| mineOnly\) query = query\.eq\('rep_user_id', user\.id\)/)
  assert.match(captureFunction,/scope: mineOnly \? 'current_user'/)
})

test('COMPLETE SALE and ABANDONED validate the capture before legacy handlers run',()=>{
  assert.match(lifecycle,/#completeSaleBtn,#abandonedSaleBtn/)
  assert.match(lifecycle,/action:'list',open_only:true,mine_only:true/)
  assert.match(lifecycle,/mccoyCaptureValidated/)
  assert.match(lifecycle,/event\.stopImmediatePropagation\(\)/)
  assert.match(lifecycle,/capture_not_owned_or_no_longer_open/)
})

test('a stale capture cannot be silently reused after account switching',()=>{
  assert.match(lifecycle,/writeLocalCapture\(null\)/)
  assert.match(lifecycle,/MCCOY_PROVIDER_CAPTURE_READY=null/)
  assert.match(lifecycle,/mccoy-provider-sale-capture-invalidated/)
  assert.match(lifecycle,/Press SALE to start a fresh ISP dashboard sale/)
})
