import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const activity = read('./app-lead-pool-independent-activity.js')
const isolation = read('./app-sale-visit-isolation.js')
const refresh = read('./app-lead-pool-independent-refresh.js')
const router = read('./app-provider-sale-router.js')
const capture = read('./supabase/functions/provider-sale-capture/index.ts')
const submit = read('./supabase/functions/sale-submit/index.ts')
const addressSearch = read('./supabase/functions/lead-map-address-search/index.ts')
const migration = read('./supabase/migrations/20260829223000_lead_pool_independent_dispositions_phone_sales.sql')
const loader = read('./app-page-layout.js')

test('Lead Pool save is independent, completed, and idempotent', () => {
  assert.match(activity, /record_lead_pool_pin_disposition/)
  assert.match(migration, /create or replace function public\.record_lead_pool_pin_disposition/)
  assert.match(migration, /'lead_pool_map','completed'/)
  assert.match(migration, /door_visits_rep_client_request_unique/)
  assert.match(migration, /on conflict\(rep_id,client_request_id\)/)
  assert.match(migration, /active_sales_hub_visit_preserved/)
  assert.doesNotMatch(activity, /FINISH ACTIVE ACTIVITY FIRST/)
})

test('map activities retain occurred-at and optional Visit dwell time', () => {
  assert.match(migration, /add column if not exists occurred_at timestamptz/)
  assert.match(migration, /p_occurred_at timestamptz/)
  assert.match(migration, /p_dwell_seconds integer/)
  assert.match(migration, /if v_activity<>'Visit' then v_dwell:=0/)
  assert.match(activity, /START VISIT TIMER/)
  assert.match(activity, /p_occurred_at:new Date\(occurredAt\)\.toISOString\(\)/)
  assert.match(activity, /p_dwell_seconds:dwellSeconds/)
})

test('Lead Pool retains the nearest algorithm for later reactivation', () => {
  assert.match(activity, /function autoSelectNearest\(/)
  assert.match(activity, /manualSelectedLeadId/)
  assert.match(activity, /if\(manualViewportHold\|\|!mapVisible\(\)\|\|manualSelectedLeadId\|\|phoneContext\)return/)
  assert.match(activity, /mccoy-gps-update/)
  assert.match(activity, /source:'auto_nearest'/)
})

test('physical knocking from the map retains the quarter-mile rule', () => {
  assert.match(activity, /QUARTER_MILE_METERS=402\.336/)
  assert.match(activity, /distance>QUARTER_MILE_METERS/)
  assert.match(activity, /KNOCK THIS LEAD/)
  assert.match(activity, /MCCOY_START_DOOR_VISIT/)
  assert.match(activity, /remote disposition and phone-sale controls remain available/)
})

test('phone-sale address search centers the map and selects a matching lead', () => {
  assert.match(activity, /leadPoolPhoneAddress/)
  assert.match(activity, /CENTER MAP \(OPTIONAL\)/)
  assert.match(activity, /lead-map-address-search/)
  assert.match(activity, /PROCESS PHONE SALE/)
  assert.match(activity, /preserve_active_visit:true/)
  assert.match(addressSearch, /exact_organization_address/)
  assert.match(addressSearch, /google_place_id/)
  assert.match(addressSearch, /google_nearby_same_address_number/)
})

test('provider capture and sale submission retain authoritative lead and explicit visit context', () => {
  assert.match(capture, /lead_id,source_door_visit_id/)
  assert.match(capture, /saleContext === 'out_of_area_phone'/)
  assert.match(capture, /sourceDoorVisitId = null/)
  assert.match(submit, /capture\.lead_id/)
  assert.match(submit, /match_lead_by_service_address/)
  assert.match(submit, /source_door_visit_id: sourceDoorVisitId/)
  assert.match(router, /MCCOY_START_EXPLICIT_SALE/)
})

test('completed sale closes only the exact explicitly linked active visit', () => {
  assert.match(migration, /if new\.source_door_visit_id is not null then/)
  assert.match(migration, /where id=new\.source_door_visit_id/)
  assert.match(migration, /completed_sale_recorded_unlinked_visit_preserved/)
  assert.match(migration, /unrelated_active_visit_preserved/)
  assert.match(isolation, /linkedId&&activeId&&String\(linkedId\)===String\(activeId\)/)
  assert.match(isolation, /unrelated physical-door activity remains active/)
})

test('deleted pins refresh safely and reassignment does not become disposition authorization', () => {
  assert.match(activity, /This pin was deleted while it was open/)
  assert.match(activity, /window\.loadMcCoyLeads/)
  assert.match(migration, /organization_id=v_access\.organization_id[\s\S]+deleted_at is null/)
  assert.doesNotMatch(migration, /assigned_rep_id=v_profile\.id/)
  assert.match(migration, /lead_assignment_changed',false/)
  assert.match(refresh, /mccoy-lead-owners-updated/)
})

test('new controls load in order without a new document-wide MutationObserver', () => {
  assert.match(loader, /app-lead-pool-independent-activity\.js/)
  assert.match(loader, /app-sale-visit-isolation\.js/)
  assert.match(loader, /app-lead-pool-independent-refresh\.js/)
  assert.match(loader, /script\.async=false/)
  assert.doesNotMatch(activity + isolation + refresh, /MutationObserver/)
})
