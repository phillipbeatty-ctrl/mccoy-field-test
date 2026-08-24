import test from 'node:test'
import assert from 'node:assert/strict'
import {
  SALE_OUTCOMES,
  SALE_PROVIDERS,
  boundedText,
  captureStartStatus,
  isUuid,
  normalizeSaleOutcome,
  normalizeSaleProvider
} from './provider-sale-capture-core.mjs'

test('normalizes every configured provider dashboard', () => {
  const examples = {
    'Quantum ASAP': 'Quantum',
    BASS: 'Brightspeed',
    'AT&T': 'AT&T',
    'T-Fiber': 'T-Mobile / T-Fiber',
    Windstream: 'Kinetic',
    Fidium: 'Fidium',
    Ascend: 'Ascend Fiber',
    Lightcurve: 'Lightcurve',
    Ripple: 'Ripple Fiber',
    Starlink: 'Starlink',
    DIRECTV: 'DIRECTV',
    Vivant: 'Vivint',
    Other: 'Other'
  }
  for (const [input, expected] of Object.entries(examples)) {
    assert.equal(normalizeSaleProvider(input), expected)
    assert.ok(SALE_PROVIDERS.includes(expected))
  }
  assert.equal(normalizeSaleProvider('unknown provider'), null)
})

test('requires an explicit completed or abandoned outcome', () => {
  assert.deepEqual(SALE_OUTCOMES, ['completed', 'abandoned'])
  assert.equal(normalizeSaleOutcome('COMPLETED SALE'), 'completed')
  assert.equal(normalizeSaleOutcome('abandoned order'), 'abandoned')
  assert.equal(normalizeSaleOutcome('cancelled'), null)
  assert.equal(normalizeSaleOutcome(''), null)
})

test('validates request identifiers and capture lifecycle state', () => {
  assert.equal(isUuid('550e8400-e29b-41d4-a716-446655440000'), true)
  assert.equal(isUuid('not-a-uuid'), false)
  assert.equal(captureStartStatus(true), 'dashboard_opened')
  assert.equal(captureStartStatus(false), 'details_required')
})

test('bounds optional provider metadata', () => {
  assert.equal(boundedText('  BASS  ', 10), 'BASS')
  assert.equal(boundedText('', 10), null)
  assert.equal(boundedText('abcdefgh', 4), 'abcd')
})
