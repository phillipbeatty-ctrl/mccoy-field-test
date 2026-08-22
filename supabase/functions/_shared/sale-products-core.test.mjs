import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeVoipHomePhoneAddOn } from './sale-products-core.mjs'

test('stores VoIP home phone as one ISP add-on instead of a provider or line selection', () => {
  assert.equal(normalizeVoipHomePhoneAddOn(true, 'Fiber'), 1)
  assert.equal(normalizeVoipHomePhoneAddOn('on', 'Internet'), 1)
  assert.equal(normalizeVoipHomePhoneAddOn(4, 'Internet'), 1)
  assert.equal(normalizeVoipHomePhoneAddOn(false, 'Fiber'), 0)
  assert.equal(normalizeVoipHomePhoneAddOn('false', 'Fiber'), 0)
  assert.equal(normalizeVoipHomePhoneAddOn(true, 'None'), 0)
})
