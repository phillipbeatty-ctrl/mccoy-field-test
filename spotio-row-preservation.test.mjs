import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8')
const edge = read('./supabase/functions/spotio-import/index.ts')
const browser = read('./spotio-import.js')
const html = read('./spotio-import.html')
const migration = read('./supabase/migrations/20260830234000_spotio_row_preserving_import.sql')
const guard = read('./supabase/migrations/20260830234100_spotio_row_coordinate_guard.sql')

const clean = value => String(value ?? '').trim().replace(/\s+/g, ' ')
const norm = value => clean(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const keyFor = row => {
  const fingerprint = [
    row.sourceOrigin,
    row.startedAt,
    String(row.rowIndex),
    norm(row.address1),
    norm(row.address2),
    norm(row.city),
    row.state,
    row.zip,
    norm(row.name),
  ].join('|')
  const hash = crypto.createHash('sha256').update(fingerprint).digest('hex')
  return { sourceKey: `spotiolist:${hash}`, providerId: `LISTROW:${hash.slice(0, 32)}` }
}

test('source-row identity is repeat-safe but never address-only', () => {
  const base = {
    sourceOrigin: 'https://app.spotio2.com',
    startedAt: '2026-08-30T04:40:56.852Z',
    address1: '3430 DORADO CIR',
    address2: 'APT 305',
    city: 'FAYETTEVILLE',
    state: 'NC',
    zip: '28304',
    name: '',
  }
  const first = keyFor({ ...base, rowIndex: 62 })
  const repeat = keyFor({ ...base, rowIndex: 62 })
  const separateListRow = keyFor({ ...base, rowIndex: 63 })
  assert.deepEqual(first, repeat)
  assert.notEqual(first.providerId, separateListRow.providerId)
})

test('production browser accepts multiple files and uploads every DOM row', () => {
  assert.match(html, /type="file" multiple/)
  assert.match(browser, /for\(const row of domLeads\)/)
  assert.match(browser, /prepare_normalization/)
  assert.match(browser, /normalize_chunk/)
  assert.match(browser, /complete_normalization/)
  assert.doesNotMatch(browser, /if\(domLeads\.length\)\{records=domLeads/)
})

test('server makes every accepted row map-visible without requiring source coordinates', () => {
  assert.match(edge, /zip_centroid_review/)
  assert.match(edge, /national_review_fallback/)
  assert.match(edge, /approximate_address_review/)
  assert.match(edge, /provider_id_required: false/)
  assert.match(edge, /source_coordinates_required: false/)
  assert.match(edge, /mccoy_upsert_spotio_batch_v2/)
})

test('database preserves permanent row identity and stronger coordinates', () => {
  assert.match(migration, /LISTROW:/)
  assert.match(migration, /spotiolist:/)
  assert.match(migration, /mccoy_spotio_map_centroids_v1/)
  assert.match(guard, /preserve_stronger_lead_coordinates_v1/)
  assert.match(guard, /approximate_address_review/)
})
