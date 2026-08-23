import assert from 'node:assert/strict';
import { adminApprovalAllows, pacificWeekWindow } from './pay-progress-core.mjs';

assert.deepEqual(pacificWeekWindow('2026-08-23T12:00:00Z'), {
  startDate: '2026-08-17', endDateExclusive: '2026-08-24'
});
assert.deepEqual(pacificWeekWindow('2026-08-24T06:59:59Z'), {
  startDate: '2026-08-17', endDateExclusive: '2026-08-24'
});
assert.deepEqual(pacificWeekWindow('2026-08-24T07:00:00Z'), {
  startDate: '2026-08-24', endDateExclusive: '2026-08-31'
});
assert.deepEqual(pacificWeekWindow('2026-01-05T07:59:59Z'), {
  startDate: '2025-12-29', endDateExclusive: '2026-01-05'
});
assert.deepEqual(pacificWeekWindow('2026-01-05T08:00:00Z'), {
  startDate: '2026-01-05', endDateExclusive: '2026-01-12'
});
assert.equal(adminApprovalAllows({ sale_origin: 'provider_import' }), true);
assert.equal(adminApprovalAllows({ sale_origin: 'outside_system' }), false);
assert.equal(adminApprovalAllows({ sale_origin: 'outside_system', admin_approval: { status: 'APPROVED' } }), true);

console.log('Pay Progress order-date week tests passed.');
