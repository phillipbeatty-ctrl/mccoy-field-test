import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const pageLayout=readFileSync(new URL('./app-page-layout.js',import.meta.url),'utf8')
const photo=readFileSync(new URL('./app-sale-photo-staging.js',import.meta.url),'utf8')
const closest=readFileSync(new URL('./app-closest-lead-autofill-v2.js',import.meta.url),'utf8')
const vercel=readFileSync(new URL('./vercel.json',import.meta.url),'utf8')

test('production loads the guarded PHOTO and closest-lead controls',()=>{
  assert.match(pageLayout,/app-sale-photo-staging\.js/)
  assert.match(pageLayout,/app-closest-lead-autofill-v2\.js/)
  assert.match(photo,/stageSalePhotoBtn/)
  assert.match(closest,/get_closest_mccoy_lead/)
})

test('PHOTO cannot open before a provider capture started in this Sales Hub attempt',()=>{
  assert.match(photo,/if\(!state\.captureStartedHere\|\|!state\.capture\?\.id\)/)
  assert.match(photo,/Press SALE first\. PHOTO cannot open until this Sales Hub attempt has a provider capture\./)
  assert.match(photo,/if\(!state\.captureValidated\)/)
  assert.match(photo,/input\.click\(\)/)
})

test('staged photo count, completion handoff, and abandoned deletion are present',()=>{
  assert.match(photo,/PHOTO \(\$\{state\.rows\.length\}\)/)
  assert.match(photo,/invoke\('finalize',\{capture_id:captureId,sale_id:saleId\}\)/)
  assert.match(photo,/mccoy-provider-sale-abandoned/)
  assert.match(photo,/invoke\('discard',\{capture_id:captureId\}\)/)
  assert.match(photo,/mccoy-sale-saved/)
})

test('closest-lead autofill preserves typed addresses and remains tenant-scoped server-side',()=>{
  assert.match(closest,/hasManualAddress\(\)/)
  assert.match(closest,/if\(!lead\?\.address\|\|hasManualAddress\(\)\)return false/)
  assert.match(closest,/get_closest_mccoy_lead/)
  assert.match(closest,/mccoy-closest-lead-autofilled/)
})

test('image compression and camera selection are allowed without widening general CSP access',()=>{
  assert.match(vercel,/img-src 'self' data: blob:/)
  assert.match(vercel,/camera=\(self\)/)
  assert.match(photo,/MAX_DIMENSION=2000/)
  assert.match(photo,/MAX_UPLOAD_BYTES=10\*1024\*1024/)
  assert.doesNotMatch(photo,/MutationObserver/)
  assert.doesNotMatch(closest,/MutationObserver/)
})
