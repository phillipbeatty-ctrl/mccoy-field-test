import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const migration = readFileSync(
  new URL('./supabase/migrations/20260830070000_spotio_permanent_lead_identity.sql', import.meta.url),
  'utf8',
)
const importer = readFileSync(
  new URL('./supabase/functions/spotio-import/index.ts', import.meta.url),
  'utf8',
)
const leadAdmin = readFileSync(
  new URL('./supabase/functions/lead-admin/index.ts', import.meta.url),
  'utf8',
)
const importUi = readFileSync(new URL('./spotio-import.js', import.meta.url), 'utf8')

const normalizePart = value => String(value || '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim()

const normalizeStreet = value => normalizePart(value)
  .replace(/\bstreet\b/g, 'st')
  .replace(/\bavenue\b/g, 'ave')
  .replace(/\broad\b/g, 'rd')
  .replace(/\bboulevard\b/g, 'blvd')
  .replace(/\bcircle\b/g, 'cir')
  .replace(/\bcourt\b/g, 'ct')
  .replace(/\bdrive\b/g, 'dr')
  .replace(/\blane\b/g, 'ln')
  .replace(/\bhighway\b/g, 'hwy')
  .replace(/\bplace\b/g, 'pl')
  .replace(/\bparkway\b/g, 'pkwy')
  .replace(/\bterrace\b/g, 'ter')
  .replace(/\btrail\b/g, 'trl')

const normalizeUnit = value => normalizePart(value)
  .replace(/\b(apartment|apt|unit|suite|ste)\b/g, 'unit')

const canonicalIdentity = (organizationId, lead) => {
  const providerId = normalizePart(lead.provider_lead_id).replace(/ /g, '')
  if (providerId) return `${organizationId}|provider:${providerId}`
  const provider = normalizePart(lead.provider || 'SPOTIO')
  const street = normalizeStreet(lead.address1)
  const unit = normalizeUnit(lead.address2)
  const zip = String(lead.zip || '').replace(/\D/g, '').slice(0, 5)
  return `${organizationId}|address:${provider}|${street}|${unit}|${zip}`
}

const materialFields = [
  'provider', 'provider_lead_id', 'address1', 'address2', 'city', 'state', 'zip',
  'latitude', 'longitude', 'customer_name', 'phone', 'source_stage_id',
]

function runUpload(state, organizationId, records) {
  const classifications = {
    created: 0,
    updated: 0,
    unchanged: 0,
    collision: 0,
    missing_retained: 0,
    archived: 0,
  }
  const seen = new Set()

  for (const record of records) {
    const key = canonicalIdentity(organizationId, record)
    const providerKey = normalizePart(record.provider_lead_id).replace(/ /g, '')
    const providerMatch = providerKey
      ? [...state.values()].find(lead =>
        lead.organization_id === organizationId
        && normalizePart(lead.provider_lead_id).replace(/ /g, '') === providerKey
      )
      : null
    const fallbackKey = canonicalIdentity(organizationId, { ...record, provider_lead_id: null })
    const fallbackMatches = [...state.values()].filter(lead =>
      lead.organization_id === organizationId
      && canonicalIdentity(organizationId, { ...lead, provider_lead_id: null }) === fallbackKey
    )

    if (providerMatch && fallbackMatches.some(match => match.id !== providerMatch.id)) {
      classifications.collision++
      continue
    }
    if (!providerMatch && fallbackMatches.length > 1) {
      classifications.collision++
      continue
    }

    const existing = providerMatch || fallbackMatches[0] || state.get(key)
    if (!existing) {
      const created = {
        ...record,
        id: `lead-${state.size + 1}`,
        organization_id: organizationId,
        import_batch_id: 'latest-provenance-only',
        assigned_rep_id: null,
        current_disposition: 'Uncontacted',
      }
      state.set(key, created)
      seen.add(created.id)
      classifications.created++
      continue
    }

    if (existing.deleted_at && existing.deletion_reason === 'manual') {
      seen.add(existing.id)
      classifications.archived++
      continue
    }

    const changed = materialFields.some(field => {
      if (record[field] === null || record[field] === undefined || record[field] === '') return false
      return existing[field] !== record[field]
    })
    const priorKey = canonicalIdentity(organizationId, existing)
    Object.assign(existing, Object.fromEntries(
      Object.entries(record).filter(([, value]) => value !== null && value !== undefined && value !== ''),
    ))
    existing.import_batch_id = 'latest-provenance-only'
    const nextKey = canonicalIdentity(organizationId, existing)
    if (nextKey !== priorKey) {
      state.delete(priorKey)
      state.set(nextKey, existing)
    }
    seen.add(existing.id)
    classifications[changed ? 'updated' : 'unchanged']++
  }

  for (const lead of state.values()) {
    if (lead.organization_id === organizationId && !lead.deleted_at && !seen.has(lead.id)) {
      classifications.missing_retained++
    }
  }
  return classifications
}

test('sequential uploads remain additive and preserve field state', () => {
  const state = new Map()
  const organizationId = 'org-1'
  const uploadA = [
    { provider: 'Brightspeed', provider_lead_id: 'A-1', address1: '101 Main Street', city: 'Town', state: 'OR', zip: '97001', phone: '111' },
    { provider: 'Brightspeed', provider_lead_id: 'A-2', address1: '102 Main Street', city: 'Town', state: 'OR', zip: '97001' },
    { provider: 'Brightspeed', provider_lead_id: 'A-3', address1: '103 Main Street', city: 'Town', state: 'OR', zip: '97001' },
    { provider: 'Brightspeed', address1: '104 Main Street', address2: 'Apt 2', city: 'Town', state: 'OR', zip: '97001' },
    { provider: 'Brightspeed', address1: '105 Main Street', city: 'Town', state: 'OR', zip: '97001' },
  ]
  assert.deepEqual(runUpload(state, organizationId, uploadA), {
    created: 5,
    updated: 0,
    unchanged: 0,
    collision: 0,
    missing_retained: 0,
    archived: 0,
  })
  assert.equal(state.size, 5)

  const assigned = [...state.values()].find(lead => lead.provider_lead_id === 'A-1')
  assigned.assigned_rep_id = 'rep-7'
  assigned.current_disposition = 'Follow Up'
  const omitted = [...state.values()].find(lead => lead.address1 === '104 Main Street')
  omitted.current_disposition = 'Interested'

  const uploadB = [
    { provider: 'Brightspeed', provider_lead_id: 'A-1', address1: '101 Main Street', city: 'Town', state: 'OR', zip: '97001', phone: '999' },
    { provider: 'Brightspeed', provider_lead_id: 'A-2', address1: '102 Main Street', city: 'Town', state: 'OR', zip: '97001' },
    { provider: 'Brightspeed', provider_lead_id: 'A-3', address1: '103 Main Street', city: 'Town', state: 'OR', zip: '97001' },
    { provider: 'Brightspeed', provider_lead_id: 'A-6', address1: '106 Main Street', city: 'Town', state: 'OR', zip: '97001' },
    { provider: 'Brightspeed', provider_lead_id: 'A-7', address1: '107 Main Street', city: 'Town', state: 'OR', zip: '97001' },
  ]
  assert.deepEqual(runUpload(state, organizationId, uploadB), {
    created: 2,
    updated: 1,
    unchanged: 2,
    collision: 0,
    missing_retained: 2,
    archived: 0,
  })
  assert.equal(state.size, 7)
  assert.equal(assigned.assigned_rep_id, 'rep-7')
  assert.equal(assigned.current_disposition, 'Follow Up')
  assert.equal(omitted.current_disposition, 'Interested')

  assert.deepEqual(runUpload(state, organizationId, uploadB), {
    created: 0,
    updated: 0,
    unchanged: 5,
    collision: 0,
    missing_retained: 2,
    archived: 0,
  })
  assert.equal(state.size, 7)
})

test('provider ID wins when an address changes', () => {
  const state = new Map()
  const organizationId = 'org-1'
  runUpload(state, organizationId, [{
    provider: 'Brightspeed', provider_lead_id: 'stable-44',
    address1: '1 Old Road', city: 'Town', state: 'OR', zip: '97001',
  }])
  const result = runUpload(state, organizationId, [{
    provider: 'Brightspeed', provider_lead_id: 'stable-44',
    address1: '2 New Road', city: 'Town', state: 'OR', zip: '97002',
  }])
  assert.equal(result.updated, 1)
  assert.equal(state.size, 1)
  assert.equal([...state.values()][0].address1, '2 New Road')
})

test('provider-ID and fallback disagreement is classified for review without mutation', () => {
  const state = new Map()
  const organizationId = 'org-1'
  runUpload(state, organizationId, [
    { provider: 'Brightspeed', provider_lead_id: 'P-1', address1: '10 First Street', city: 'Town', state: 'OR', zip: '97001' },
    { provider: 'Brightspeed', provider_lead_id: 'P-2', address1: '20 Second Street', city: 'Town', state: 'OR', zip: '97001' },
  ])
  const before = structuredClone([...state.values()])
  const result = runUpload(state, organizationId, [{
    provider: 'Brightspeed', provider_lead_id: 'P-1',
    address1: '20 Second Street', city: 'Town', state: 'OR', zip: '97001',
  }])
  assert.equal(result.collision, 1)
  assert.deepEqual([...state.values()], before)
})

test('an authorized manual archive is not revived by a later upload', () => {
  const state = new Map()
  const organizationId = 'org-1'
  runUpload(state, organizationId, [{
    provider: 'Brightspeed', provider_lead_id: 'ARCH-1',
    address1: '88 Archive Road', city: 'Town', state: 'OR', zip: '97001',
  }])
  const lead = [...state.values()][0]
  lead.deleted_at = '2026-08-29T00:00:00Z'
  lead.deletion_reason = 'manual'
  const result = runUpload(state, organizationId, [{
    provider: 'Brightspeed', provider_lead_id: 'ARCH-1',
    address1: '88 Archive Road', city: 'Town', state: 'OR', zip: '97001',
  }])
  assert.equal(result.archived, 1)
  assert.equal(lead.deleted_at, '2026-08-29T00:00:00Z')
})

test('fallback identity includes organization, provider, normalized street, unit, and ZIP', () => {
  const first = canonicalIdentity('org-1', {
    provider: 'Brightspeed Fiber', address1: '55 Cedar Avenue', address2: 'Apartment 4', zip: '97206-1234',
  })
  const same = canonicalIdentity('org-1', {
    provider: 'BRIGHTSPEED FIBER', address1: '55 Cedar Ave.', address2: 'Unit 4', zip: '97206',
  })
  const otherProvider = canonicalIdentity('org-1', {
    provider: 'Quantum', address1: '55 Cedar Ave', address2: 'Unit 4', zip: '97206',
  })
  const otherOrganization = canonicalIdentity('org-2', {
    provider: 'Brightspeed Fiber', address1: '55 Cedar Ave', address2: 'Unit 4', zip: '97206',
  })
  assert.equal(first, same)
  assert.notEqual(first, otherProvider)
  assert.notEqual(first, otherOrganization)
})


test('missing provider metadata uses the durable SPOTIO provider namespace', () => {
  const implicit = canonicalIdentity('org-1', {
    address1: '77 Default Road', address2: '', zip: '97206',
  })
  const explicit = canonicalIdentity('org-1', {
    provider: 'SPOTIO', address1: '77 Default Rd', address2: '', zip: '97206-0001',
  })
  assert.equal(implicit, explicit)
})

test('migration encodes required durable classifications and no omission archive', () => {
  for (const action of ['created', 'updated', 'unchanged', 'collision', 'missing_retained', 'archived']) {
    assert.match(migration, new RegExp(`'${action}'`))
  }
  assert.match(migration, /fallback_identity_key/)
  assert.match(migration, /mccoy_spotio_canonical_identity_v2/)
  assert.match(migration, /provider, provider_lead_id/)
  assert.match(migration, /import_batch_is_provenance_only/)
  assert.match(migration, /spotio_identity_migration_blocked/)
  assert.doesNotMatch(migration, /set\s+deleted_at\s*=/i)
})

test('importer records missing-retained separately from capture failures', () => {
  assert.match(importer, /mccoy_classify_spotio_missing_retained_v1/)
  assert.match(importer, /missing_retained: missingRetained/)
  assert.match(importer, /capture_missing: captureMissing/)
  assert.match(importer, /identity_precedence/)
  assert.match(importer, /organization_provider_street_unit_zip/)
  assert.match(importer, /record\.provider, record\.address1, record\.address2/)
})

test('live Lead Pool and Manager assignment are no longer limited by import batch', () => {
  assert.match(leadAdmin, /\.eq\('organization_id', organizationId\)/)
  assert.match(leadAdmin, /\.is\('deleted_at', null\)/)
  assert.match(leadAdmin, /import_batch_is_provenance_only: true/)
  assert.doesNotMatch(leadAdmin, /import_batch_id\.in\./)
  assert.doesNotMatch(leadAdmin, /selectedIds/)
  assert.doesNotMatch(leadAdmin, /batchIds/)
})

test('Admin upload result surfaces every required classification', () => {
  assert.match(importUi, /new`/)
  assert.match(importUi, /updated`/)
  assert.match(importUi, /unchanged`/)
  assert.match(importUi, /missing but retained`/)
  assert.match(importUi, /explicitly archived`/)
  assert.match(importUi, /collisions`/)
  assert.match(importUi, /No omitted live leads were removed/)
})
