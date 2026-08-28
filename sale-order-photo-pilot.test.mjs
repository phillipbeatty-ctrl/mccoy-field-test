import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const pilot=fs.readFileSync(new URL('./app-sale-order-photo-pilot.js',import.meta.url),'utf8')
const reviewEvents=fs.readFileSync(new URL('./app-sale-review-events.js',import.meta.url),'utf8')
const adminPhoto=fs.readFileSync(new URL('./app-sale-order-photo-admin.js',import.meta.url),'utf8')
const fn=fs.readFileSync(new URL('./supabase/functions/sale-order-photo-pilot/index.ts',import.meta.url),'utf8')
const migration=fs.readFileSync(new URL('./supabase/migrations/20260827200000_sale_order_photo_extraction_pilot.sql',import.meta.url),'utf8')

const fields=['customer_name','service_address','provider_order_number','provider_account_number','order_date','install_date','internet_speed_mbps','isp']

test('pilot is Admin-only, private, redaction-gated, and capped at 50 samples',()=>{
  assert.match(fn,/admin_access_required/)
  assert.match(fn,/redaction_confirmation_required/)
  assert.match(fn,/maximumSamples=50/)
  assert.match(fn,/minimumSamples=30/)
  assert.match(fn,/pilot_limit_reached/)
  assert.match(migration,/sale-order-photo-pilot/)
  assert.match(migration,/values\([\s\S]*false/)
  assert.match(migration,/redaction_confirmed boolean not null check \(redaction_confirmed is true\)/)
  assert.match(migration,/interval '45 days'/)
})

test('pilot measures every requested field with server-computed ground truth scoring',()=>{
  for(const field of fields){assert.match(fn,new RegExp(field));assert.match(pilot,new RegExp(field))}
  assert.match(fn,/scoreFields/)
  assert.match(fn,/correct\/metric\.scored/)
  assert.match(fn,/ready_for_decision/)
  assert.match(pilot,/SAVE GROUND TRUTH & SCORE/)
  assert.match(pilot,/Field accuracy/)
  assert.match(pilot,/Provider coverage/)
})

test('sensitive screenshots are blocked rather than scored',()=>{
  assert.match(fn,/sensitive_data_detected/)
  assert.match(fn,/sensitive_sample_must_be_deleted/)
  assert.match(fn,/Never return Social Security numbers/)
  assert.match(pilot,/Sensitive data detected/)
  assert.match(pilot,/properly redacted replacement/)
})

test('Admin photo review uses explicit SALE REVIEW events without a MutationObserver',()=>{
  assert.match(reviewEvents,/mccoy-sale-review-rendered/)
  assert.match(adminPhoto,/mccoy-sale-review-rendered/)
  assert.match(adminPhoto,/ORDER PHOTO EVIDENCE/)
  assert.doesNotMatch(reviewEvents,/MutationObserver/)
  assert.doesNotMatch(adminPhoto,/MutationObserver/)
})

test('pilot samples cannot change production sales or rankings',()=>{
  assert.doesNotMatch(fn,/from\('sales_records'\).*update/)
  assert.doesNotMatch(fn,/ranking_eligible/)
  assert.doesNotMatch(fn,/admin_approve_sale/)
  assert.match(pilot,/never modify sales, rankings, Customer List, or Admin approval/i)
})
