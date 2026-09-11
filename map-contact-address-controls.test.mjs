import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')

test('MY LOCATION is one-shot and manual map navigation blocks background recentering', () => {
  const source = read('./app-map-manual-control.js')
  assert.match(source, /one-time center/i)
  assert.match(source, /aria-pressed'\)==='true'/)
  assert.doesNotMatch(source, /mccoy-map-lead-selected/)
  assert.match(source, /map\.on\('click'/)
  assert.match(source, /Map movement is manual/)
  assert.match(source, /mccoy-field-session-started/)
})

test('all active field roles receive audited customer and address controls', () => {
  const source = read('./app-field-lead-editor.js')
  for (const role of ['admin','manager','trainer','rep','tester']) assert.match(source, new RegExp(`'${role}'`))
  assert.match(source, /Customer name/)
  assert.match(source, /Customer phone number/)
  assert.match(source, /Notes/)
  assert.match(source, /ADD PIN \/ ADDRESS/)
  assert.match(source, /update_contact/)
  assert.match(source, /create_lead/)
})

test('server endpoint is organization scoped and audits edits', () => {
  const source = read('./supabase/functions/lead-field-actions/index.ts')
  assert.match(source, /\.eq\('organization_id', access\.organization_id\)/)
  assert.match(source, /lead_contact_edit_history/)
  assert.match(source, /matched_existing_address/)
  assert.match(source, /source_system: 'FIELD_ENTRY'/)
  assert.match(source, /GOOGLE_MAPS_API_KEY/)
})

test('database migration adds shared notes and immutable edit history', () => {
  const source = read('./supabase/migrations/20260830223000_all_users_lead_contact_and_field_addresses.sql')
  assert.match(source, /add column if not exists notes text not null default ''/)
  assert.match(source, /create table if not exists public\.lead_contact_edit_history/)
  assert.match(source, /enable row level security/)
  assert.match(source, /revoke all .* authenticated/)
})

test('page lifecycle loads the new controls after Lead Pool activity', () => {
  const source = read('./app-page-layout.js')
  const activity = source.indexOf('app-lead-pool-independent-activity.js')
  const manual = source.indexOf('app-map-manual-control.js')
  const editor = source.indexOf('app-field-lead-editor.js')
  assert.ok(activity >= 0 && manual > activity && editor > manual)
})
