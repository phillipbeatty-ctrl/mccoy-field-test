import assert from 'node:assert/strict'
import test from 'node:test'
import { metersBetweenPoints, saleDistanceAudit } from './sale-location-core.mjs'

test('records an approximate map distance without requiring arrival verification', () => {
  const now = new Date('2026-08-22T20:00:00.000Z')
  const result = saleDistanceAudit(
    { latitude: 45.638, longitude: -122.661, accuracy_meters: 18.4, captured_at: now.toISOString() },
    { latitude: 45.639, longitude: -122.661 },
    now
  )
  assert.equal(result.status, 'recorded')
  assert.ok(result.distance_meters > 100 && result.distance_meters < 120)
  assert.equal(result.accuracy_meters, 18.4)
})

test('does not block a sale when either mapping point is unavailable', () => {
  const now = new Date('2026-08-22T20:00:00.000Z')
  assert.equal(saleDistanceAudit(null, { latitude: 45, longitude: -122 }, now).status, 'rep_location_unavailable')
  assert.equal(saleDistanceAudit({ latitude: 45, longitude: -122, captured_at: now.toISOString() }, null, now).status, 'customer_map_location_unavailable')
  assert.equal(metersBetweenPoints(null, null), null)
})
