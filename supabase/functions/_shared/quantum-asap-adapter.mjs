// Quantum ASAP payload adapter.
// This module performs no network or database operations. A transport and an
// approved field map must be supplied before an ASAP connection can be enabled.

export const ASAP_CONNECTION_STATUS = 'not_connected';
export const ASAP_PROVIDER = 'Quantum';

const FIELD_NAMES = Object.freeze([
  'externalId',
  'orderNumber',
  'accountNumber',
  'sellerIdentifier',
  'sellerName',
  'sellerEmail',
  'customerName',
  'serviceAddress',
  'saleDate',
  'providerStatus'
]);

const SENSITIVE_KEY = /(?:access.?token|refresh.?token|authorization|api.?key|client.?secret|password|passcode|security.?answer|social.?security|\bssn\b)/i;

function clean(value) {
  const result = String(value ?? '').trim();
  return result || null;
}

function normalizeKey(value) {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function readPath(record, path) {
  if (!path) return null;
  const segments = String(path).split('.').map(part => part.trim()).filter(Boolean);
  let value = record;
  for (const segment of segments) {
    if (!value || typeof value !== 'object' || !(segment in value)) return null;
    value = value[segment];
  }
  return clean(value);
}

function readMapped(record, selector) {
  const paths = Array.isArray(selector) ? selector : [selector];
  for (const path of paths) {
    const value = readPath(record, path);
    if (value) return value;
  }
  return null;
}

function normalizeSaleDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function sanitizedEvidence(record, fieldMap) {
  const evidence = {};
  for (const field of FIELD_NAMES) {
    const selector = fieldMap[field];
    if (!selector) continue;
    const value = readMapped(record, selector);
    if (value && !SENSITIVE_KEY.test(field)) evidence[field] = value;
  }
  return evidence;
}

export function validateAsapFieldMap(fieldMap) {
  const errors = [];
  if (!fieldMap || typeof fieldMap !== 'object' || Array.isArray(fieldMap)) {
    return { ok: false, errors: ['field_map_must_be_an_object'] };
  }
  for (const [field, selector] of Object.entries(fieldMap)) {
    if (!FIELD_NAMES.includes(field)) errors.push(`unsupported_field:${field}`);
    const paths = Array.isArray(selector) ? selector : [selector];
    if (!paths.length || paths.some(path => !clean(path))) errors.push(`invalid_selector:${field}`);
  }
  if (!fieldMap.orderNumber && !fieldMap.accountNumber) {
    errors.push('order_number_or_account_number_mapping_required');
  }
  if (!fieldMap.sellerIdentifier && !fieldMap.sellerEmail && !fieldMap.sellerName) {
    errors.push('seller_identity_mapping_required');
  }
  return { ok: errors.length === 0, errors };
}

export function normalizeAsapRecord(record, fieldMap) {
  const mapCheck = validateAsapFieldMap(fieldMap);
  if (!mapCheck.ok) return { ok: false, errors: mapCheck.errors, row: null };
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return { ok: false, errors: ['record_must_be_an_object'], row: null };
  }

  const orderNumber = readMapped(record, fieldMap.orderNumber);
  const accountNumber = readMapped(record, fieldMap.accountNumber);
  const sellerName = readMapped(record, fieldMap.sellerName);
  const sellerEmail = readMapped(record, fieldMap.sellerEmail)?.toLowerCase() || null;
  const sellerIdentifier = readMapped(record, fieldMap.sellerIdentifier) || sellerEmail || sellerName;
  const errors = [];
  if (!orderNumber && !accountNumber) errors.push('order_number_or_account_number_missing');
  if (!sellerIdentifier) errors.push('seller_identity_missing');

  const externalId = readMapped(record, fieldMap.externalId);
  const saleDateRaw = readMapped(record, fieldMap.saleDate);
  const saleDate = normalizeSaleDate(saleDateRaw);
  if (saleDateRaw && !saleDate) errors.push('sale_date_invalid');
  if (errors.length) return { ok: false, errors, row: null };

  const dedupeKey = [
    ASAP_PROVIDER,
    externalId || '',
    orderNumber || '',
    accountNumber || '',
    sellerIdentifier || ''
  ].map(normalizeKey).join(':');

  const row = {
    provider: ASAP_PROVIDER,
    order_number: orderNumber,
    account_number: accountNumber,
    seller_identifier: sellerIdentifier,
    seller_name: sellerName,
    seller_email: sellerEmail,
    customer_name: readMapped(record, fieldMap.customerName),
    service_address: readMapped(record, fieldMap.serviceAddress),
    sale_date: saleDate,
    provider_status: readMapped(record, fieldMap.providerStatus),
    raw_payload: {
      source: 'Quantum ASAP',
      external_id: externalId,
      dedupe_key: dedupeKey,
      mapped_evidence: sanitizedEvidence(record, fieldMap)
    }
  };

  return { ok: true, errors: [], externalId, dedupeKey, row };
}

export function normalizeAsapBatch(records, fieldMap) {
  if (!Array.isArray(records)) {
    return { ok: false, accepted: [], rejected: [{ index: null, errors: ['records_must_be_an_array'] }] };
  }
  const accepted = [];
  const rejected = [];
  records.forEach((record, index) => {
    const result = normalizeAsapRecord(record, fieldMap);
    if (result.ok) accepted.push({ index, ...result });
    else rejected.push({ index, errors: result.errors });
  });
  return { ok: rejected.length === 0, accepted, rejected };
}
