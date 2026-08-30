import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const importer = await readFile(new URL('./spotio-import.js', import.meta.url), 'utf8')
const page = await readFile(new URL('./spotio-import.html', import.meta.url), 'utf8')

test('Admin importer exposes permanent duplicate-enrichment controls', () => {
  assert.match(page, /id="policyEnrich"[^>]*checked[^>]*disabled/)
  assert.match(page, /id="policyDistinct"[^>]*checked[^>]*disabled/)
  assert.match(page, /id="policyUnits"[^>]*checked[^>]*disabled/)
  assert.match(page, /Enrich an existing durable lead/)
  assert.match(page, /Keep different stable provider IDs separate/)
  assert.match(page, /Keep apartments, suites, buildings, lots, and units separate/)
})

test('multiple capture parts are accepted and normalized independently', () => {
  assert.match(page, /id="file"[^>]*multiple/)
  assert.match(importer, /for\(let index=0;index<files\.length;index\+\+\)/)
  assert.match(importer, /uploadOne\(session,files\[index\],index\+1,files\.length\)/)
})

test('upload summary distinguishes enrichment, repeat rows, and retained omissions', () => {
  assert.match(importer, /enriched/)
  assert.match(importer, /repeat rows merged into durable leads/)
  assert.match(importer, /missing but retained/)
  assert.match(importer, /Different units and different provider lead IDs remain separate/)
})

test('unsafe policy toggles cannot be disabled for a live upload', () => {
  assert.match(importer, /All permanent identity and unit-preservation controls must remain enabled/)
})

test('successful imports force a fresh Lead Pool navigation', () => {
  assert.match(importer, /mccoy_lead_pool_refresh_required/)
  assert.match(importer, /OPEN THE REFRESHED LEAD POOL/)
  assert.match(page, /leadRefresh=1#leads/)
})
