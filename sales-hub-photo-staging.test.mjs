import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const layout=readFileSync(new URL('./app-sales-hub-layout.js',import.meta.url),'utf8')
const staging=readFileSync(new URL('./app-sale-photo-staging.js',import.meta.url),'utf8')
const presence=readFileSync(new URL('./app-sph-presence.js',import.meta.url),'utf8')
const migration=readFileSync(new URL('./supabase/migrations/20260828043000_provider_sale_photo_staging.sql',import.meta.url),'utf8')
const edge=readFileSync(new URL('./supabase/functions/provider-sale-photo-stage/index.ts',import.meta.url),'utf8')
const pageLayout=readFileSync(new URL('./app-page-layout.js',import.meta.url),'utf8')
const vercel=readFileSync(new URL('./vercel.json',import.meta.url),'utf8')

test('approved Sales Hub layout is compact and responsive',()=>{
  assert.match(layout,/grid-template-columns:minmax\(250px,\.94fr\) minmax\(230px,\.78fr\) minmax\(390px,1\.28fr\)/)
  assert.match(layout,/grid-template-areas:"field middle door" "workday workday door"/)
  assert.match(layout,/#salesHubMiddleStack/)
  assert.match(layout,/middle\.replaceChildren\(liveStats,pay\)/)
  assert.match(layout,/top\.replaceChildren\(fieldSession,middle,door,\.\.\.\(workday\?\[workday\]:\[\]\)\)/)
  assert.match(layout,/gap:8px/)
  assert.match(layout,/save\.textContent='SAVE'/)
  assert.match(layout,/@media\(max-width:900px\)/)
  assert.match(layout,/grid-template-areas:"field" "workday" "door" "middle"/)
  assert.match(layout,/mccoy-sph-workday-ready/)
})

test('Sales per Hour Workday is an address-only summary until EDIT is opened',()=>{
  assert.match(presence,/sphHomeAddressDisplay/)
  assert.match(presence,/sphEditHome/)
  assert.match(presence,/sphHomeEditor/)
  assert.match(presence,/SAVE HOME AT CURRENT LOCATION/)
  assert.match(presence,/mccoy-sph-workday-ready/)
  const panelStart=presence.indexOf("panel.innerHTML='")
  const panelEnd=presence.indexOf("field.insertBefore(panel",panelStart)
  assert.ok(panelStart>0&&panelEnd>panelStart)
  assert.doesNotMatch(presence.slice(panelStart,panelEnd),/<input/i)
  assert.doesNotMatch(presence,/MutationObserver/)
})

test('PHOTO is beside SAVE and SALE and remains mobile-picker compatible',()=>{
  assert.match(staging,/stageSalePhotoBtn/)
  assert.match(staging,/button\.textContent='PHOTO'/)
  assert.match(staging,/input\.accept='image\/\*'/)
  assert.match(staging,/input\.click\(\)/)
  assert.match(staging,/Keep file-input activation inside the original tap/)
  assert.match(staging,/Press SALE first/)
  assert.match(staging,/MAX_DIMENSION=2000/)
  assert.match(staging,/canvas\.toBlob/)
  assert.match(staging,/three_photo_limit_reached|3-photo maximum/)
})

test('PHOTO cannot be unlocked by a stale local or restored capture',()=>{
  assert.match(staging,/captureStartedHere:false/)
  assert.match(staging,/if\(!state\.captureStartedHere\|\|!state\.capture\?\.id\)/)
  assert.match(staging,/A server-restored capture from an earlier page\/session never unlocks PHOTO/)
  assert.match(staging,/mccoy-provider-sale-capture-started/)
  assert.match(staging,/mccoy-provider-sale-capture-ready/)
  assert.doesNotMatch(staging,/function localCapture\(/)
  assert.doesNotMatch(staging,/localStorage\.getItem\('mccoy_active_provider_sale_capture_v1'\)/)
})

test('staged photos attach only after a matching completed sale',()=>{
  assert.match(staging,/provider-sale-photo-stage/)
  assert.match(staging,/mccoy-sale-saved/)
  assert.match(staging,/mccoy-provider-sale-abandoned/)
  assert.match(staging,/invoke\('finalize'/)
  assert.match(staging,/invoke\('discard'/)
  assert.match(edge,/eq\('rep_user_id', user\.id\)/)
  assert.match(edge,/eq\('provider_capture_id', captureId\)/)
  assert.match(edge,/completed_sale_not_found_for_provider_capture/)
  assert.match(edge,/sale-order-photos/)
  assert.match(edge,/provider-sale-staged-photos/)
  assert.match(edge,/abort_upload/)
  assert.match(edge,/three_photo_limit_reached/)
})

test('staging is private, temporary, and isolated from rankings',()=>{
  assert.match(migration,/enable row level security/)
  assert.match(migration,/revoke all on table public\.provider_sale_capture_photos from public, anon, authenticated/)
  assert.match(migration,/public=false/)
  assert.match(migration,/interval '2 days'/)
  assert.doesNotMatch(edge,/ranking_eligible|competition_eligible|commission_/)
  assert.doesNotMatch(staging,/ranking_eligible|competition_eligible|commission_/)
})

test('new modules are preview-loaded without a DOM observer and CSP supports private image evidence',()=>{
  assert.match(pageLayout,/app-sales-hub-layout\.js\?v=2026082802/)
  assert.match(pageLayout,/app-sale-photo-staging\.js\?v=2026082802/)
  assert.doesNotMatch(layout,/new\s+MutationObserver|MutationObserver\s*\(/)
  assert.doesNotMatch(staging,/new\s+MutationObserver|MutationObserver\s*\(/)
  assert.doesNotMatch(presence,/new\s+MutationObserver|MutationObserver\s*\(/)
  assert.match(vercel,/img-src[^\n]*athxxrfqxwlfnuvbqadp\.supabase\.co/)
  assert.match(vercel,/camera=\(self\)/)
})
