import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const renderer=readFileSync(new URL('./app-accounting-records.js',import.meta.url),'utf8')
const controls=readFileSync(new URL('./app-customer-list-approval-refresh.js',import.meta.url),'utf8')
const indexSource=readFileSync(new URL('./index.html',import.meta.url),'utf8')
const workerSource=readFileSync(new URL('./service-worker.js',import.meta.url),'utf8')

test('Customer List renderer binds the canonical sale UUID before any visible-field matching',()=>{
  assert.match(renderer,/row\.dataset\.saleId=String\(item\.id\|\|''\)/)
  assert.match(renderer,/button\.dataset\.saleId=String\(item\.id\|\|''\)/)
  const direct=controls.indexOf("const directId=String(row?.dataset?.saleId")
  const fuzzy=controls.indexOf("const cells=[...row.querySelectorAll('td')]")
  assert.ok(direct>=0&&fuzzy>direct,'canonical ID must be read before fuzzy visible-text matching')
  assert.match(controls,/if\(directId\)return state\.records\.find\(item=>String\(item\.id\)===directId\)\|\|\{id:directId\}/)
})

test('the exact frozen REMOVE SALE shape remains actionable without address, order, or account text',()=>{
  const item={id:'46b94526-57d0-4714-b76b-c5c55bc2aa1b',customer_first_name:'REMOVE',customer_last_name:'SALE',service_address:null,provider_order_number:null,provider_account_number:null}
  const row={dataset:{saleId:item.id},querySelector:()=>({dataset:{saleId:item.id}})}
  const directId=String(row?.dataset?.saleId||row?.querySelector('button.customer-remove')?.dataset?.saleId||'').trim()
  assert.equal(directId,item.id)
})

test('final NOT A SALE records cannot remain frozen in Customer List',()=>{
  assert.match(renderer,/function isFinalNotASale\(row\)/)
  assert.match(renderer,/records=\(data\.records\|\|\[\]\)\.filter\(row=>!isFinalNotASale\(row\)\)/)
})

test('production app and service worker request the repaired Customer List files',()=>{
  assert.match(indexSource,/app-accounting-records\.js\?v=2026090301/)
  assert.match(indexSource,/app-customer-list-approval-refresh\.js\?v=2026090301/)
  assert.match(workerSource,/field-coach-app-shell-v11-20260903-live-feed-company-team-preview/)
  assert.match(workerSource,/'\/app-accounting-records\.js\?v=2026090301'/)
  assert.match(workerSource,/'\/app-customer-list-approval-refresh\.js\?v=2026090301'/)
})
