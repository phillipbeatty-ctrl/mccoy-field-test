import assert from 'node:assert/strict';
import {
  BASS_CONNECTION_STATUS,
  BASS_PROVIDER,
  normalizeBassBatch,
  normalizeBassRecord,
  validateBassFieldMap
} from './brightspeed-bass-adapter.mjs';

const fieldMap = {
  externalId: 'transaction.id',
  orderNumber: ['order.confirmation', 'order.number'],
  accountNumber: 'customer.account',
  sellerIdentifier: 'seller.id',
  sellerName: 'seller.name',
  sellerEmail: 'seller.email',
  customerName: 'customer.name',
  serviceAddress: 'service.address',
  saleDate: 'order.submittedAt',
  providerStatus: 'order.status'
};

const sample = {
  transaction: { id: 'tx-1001' },
  order: { confirmation: 'BASS-90001', submittedAt: '2026-08-19T18:30:00Z', status: 'submitted' },
  customer: { account: 'acct-2002', name: 'Example Customer' },
  seller: { id: 'agent-3003', name: 'Example Rep', email: 'REP@EXAMPLE.COM' },
  service: { address: '100 Example Ave' },
  authorization: 'must-not-be-retained',
  ssn: 'must-not-be-retained'
};

assert.equal(BASS_CONNECTION_STATUS, 'not_connected');
assert.equal(validateBassFieldMap(fieldMap).ok, true);

const result = normalizeBassRecord(sample, fieldMap);
assert.equal(result.ok, true);
assert.equal(result.row.provider, BASS_PROVIDER);
assert.equal(result.row.order_number, 'BASS-90001');
assert.equal(result.row.seller_identifier, 'agent-3003');
assert.equal(result.row.seller_email, 'rep@example.com');
assert.equal(result.row.sale_date, '2026-08-19T18:30:00.000Z');
assert.equal('authorization' in result.row.raw_payload, false);
assert.equal('ssn' in result.row.raw_payload, false);
assert.equal(JSON.stringify(result.row.raw_payload).includes('must-not-be-retained'), false);

const invalid = normalizeBassRecord({ seller: { id: 'agent-3003' } }, fieldMap);
assert.equal(invalid.ok, false);
assert.deepEqual(invalid.errors, ['order_number_or_account_number_missing']);

const batch = normalizeBassBatch([sample, { order: { confirmation: 'BASS-90002' } }], fieldMap);
assert.equal(batch.ok, false);
assert.equal(batch.accepted.length, 1);
assert.equal(batch.rejected.length, 1);
assert.deepEqual(batch.rejected[0].errors, ['seller_identity_missing']);

console.log('Brightspeed BASS adapter contract tests passed.');

