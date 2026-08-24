import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const migration = fs.readFileSync(
  new URL('./supabase/migrations/20260824200225_admin_verify_confirmed_sales_from_provider_exports.sql', import.meta.url),
  'utf8'
)
const adminUi = fs.readFileSync(new URL('./app-admin-sale-credit.js', import.meta.url), 'utf8')
const html = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8')

test('Admin reconciliation is limited to authenticated two-button completed sales', () => {
  assert.match(migration, /if v_actor is null then raise exception 'Authentication required'/)
  assert.match(migration, /lower\(a\.role\)='admin'/)
  assert.match(migration, /v_before\.rep_reported_outcome is distinct from 'completed'/)
  assert.match(migration, /v_before\.provider_capture_id is null/)
  assert.match(migration, /Only a two-button COMPLETE SALE record/)
})

test('ISP evidence fills blanks and preserves existing customer and accounting values', () => {
  assert.match(migration, /provider_order_number=coalesce\(nullif\(trim\(provider_order_number\),''\),nullif\(trim\(v_provider\.order_number\),''\)\)/)
  assert.match(migration, /customer_first_name=case when nullif\(trim\(coalesce\(customer_first_name,''\)\),''\) is null or lower\(trim\(customer_first_name\)\)='unknown' then v_first else customer_first_name end/)
  assert.match(migration, /service_address=coalesce\(nullif\(trim\(service_address\),''\),nullif\(trim\(v_provider\.service_address\),''\),nullif\(trim\(v_capture_address\),''\)\)/)
  assert.match(migration, /internet_speed_mbps=case when coalesce\(internet_speed_mbps,0\)<=0 then v_speed else internet_speed_mbps end/)
  assert.match(migration, /'filled_fields',to_jsonb\(v_filled\),'preserved_fields',to_jsonb\(v_preserved\)/)
})

test('provider mismatch, seller mismatch, denied evidence, and conflicting identifiers are blocked', () => {
  assert.match(migration, /ISP export provider does not match/)
  assert.match(migration, /selected ISP export row is not eligible sale evidence/)
  assert.match(migration, /existing order number conflicts/)
  assert.match(migration, /existing account number conflicts/)
  assert.match(migration, /provider seller identity belongs to a different McCoy user/)
  assert.match(migration, /Unmapped ISP evidence requires an exact service-address match/)
})

test('automatic provider-origin duplicates are retired atomically instead of double counting', () => {
  assert.match(migration, /authoritative_provider_ranking_materialization/)
  assert.match(migration, /rep_provider_history_ranking/)
  assert.match(migration, /v_linked\.rep_reported_outcome is not null or v_linked\.provider_capture_id is not null/)
  assert.match(migration, /sale_status='not_a_sale'/)
  assert.match(migration, /ranking_credit_excluded=true/)
  assert.match(migration, /ranking_eligible=false/)
  assert.match(migration, /competition_eligible=false/)
  assert.match(migration, /materialized_sale_id=p_sale_id/)
})

test('reconciliation is immutable, idempotent, and visible in Admin audit detail', () => {
  assert.match(migration, /create table if not exists public\.sale_provider_reconciliation_history/)
  assert.match(migration, /unique\(provider_sale_row_id\)/)
  assert.match(migration, /if v_provider\.materialized_sale_id=p_sale_id[\s\S]*'already_applied',true/)
  assert.match(migration, /provider_reconciliation_history/)
  assert.match(adminUi, /ISP reconciliation history/)
})

test('Admin UI previews and confirms ISP substitution before applying it', () => {
  assert.match(adminUi, /FILL FROM ISP EXPORT &amp; VERIFY/)
  assert.match(adminUi, /admin_confirmed_sale_provider_candidates/)
  assert.match(adminUi, /admin_verify_confirmed_sale_from_provider/)
  assert.match(adminUi, /window\.confirm/)
  assert.match(adminUi, /provider-origin duplicate will be removed from rankings and accounting/)
  assert.match(html, /app-admin-sale-credit\.js\?v=2026082422/)
})

test('normal two-button outcome remains unchanged for reps', () => {
  assert.doesNotMatch(adminUi, /customer information required for rep/i)
  assert.match(migration, /admin_apply_sale_credit/)
  assert.match(migration, /required_metrics_complete is not true/)
})
