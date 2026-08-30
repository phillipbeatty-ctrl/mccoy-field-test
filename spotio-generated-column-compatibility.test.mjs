import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const permanentIdentity = readFileSync(
  new URL('./supabase/migrations/20260830070000_spotio_permanent_lead_identity.sql', import.meta.url),
  'utf8',
)
const providerNamespace = readFileSync(
  new URL('./supabase/migrations/20260830070001_spotio_default_provider_namespace.sql', import.meta.url),
  'utf8',
)

for (const [name, migration] of [
  ['permanent identity migration', permanentIdentity],
  ['provider namespace migration', providerNamespace],
]) {
  test(`${name} never writes the generated normalized-address column`, () => {
    assert.doesNotMatch(migration, /new\.normalized_address_key\s*:=/i)
    assert.doesNotMatch(migration, /set[\s\S]{0,120}normalized_address_key\s*=/i)
    assert.doesNotMatch(migration, /insert\s+into\s+public\.leads\s*\([^)]*normalized_address_key/i)
  })
}

test('fresh schemas define normalized_address_key as a stored generated column', () => {
  assert.match(
    permanentIdentity,
    /add column normalized_address_key text generated always as[\s\S]*stored/i,
  )
})

test('production backfills only writable identity columns', () => {
  assert.match(permanentIdentity, /set fallback_identity_key\s*=/i)
  assert.match(permanentIdentity, /canonical_identity_key\s*=/i)
  assert.match(providerNamespace, /fallback_identity_key\s*=/i)
  assert.match(providerNamespace, /canonical_identity_key\s*=/i)
})
