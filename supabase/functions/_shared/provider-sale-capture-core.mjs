export const SALE_PROVIDERS = Object.freeze([
  'Quantum',
  'Brightspeed',
  'AT&T',
  'T-Mobile / T-Fiber',
  'Kinetic',
  'Fidium',
  'Ascend Fiber',
  'Lightcurve',
  'Ripple Fiber',
  'Starlink',
  'DIRECTV',
  'Vivint',
  'Other'
])

export const SALE_OUTCOMES = Object.freeze(['completed', 'abandoned'])
export const TESTER_PKB_EMAIL = 'phillipkbeatty@gmail.com'

const normalized = value => String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '')

export function normalizeSaleProvider(value) {
  const input = normalized(value)
  if (input.includes('brightspeed') || input === 'bass') return 'Brightspeed'
  if (input.includes('quantum') || input === 'asap' || input === 'quantumasap') return 'Quantum'
  if (input === 'att' || input.includes('atandt')) return 'AT&T'
  if (input.includes('tmobile') || input.includes('tfiber')) return 'T-Mobile / T-Fiber'
  if (input.includes('kinetic') || input.includes('windstream')) return 'Kinetic'
  if (input.includes('fidium')) return 'Fidium'
  if (input.includes('ascend')) return 'Ascend Fiber'
  if (input.includes('lightcurve')) return 'Lightcurve'
  if (input.includes('ripple')) return 'Ripple Fiber'
  if (input.includes('starlink')) return 'Starlink'
  if (input.includes('directv')) return 'DIRECTV'
  if (input.includes('vivint') || input.includes('vivant')) return 'Vivint'
  if (input === 'other') return 'Other'
  return null
}

export function normalizeSaleOutcome(value) {
  const input = normalized(value)
  if (input === 'completed' || input === 'completedsale') return 'completed'
  if (input === 'abandoned' || input === 'abandonedorder' || input === 'abandonedsale') return 'abandoned'
  return null
}

export function isTesterPkbIdentity(email, displayName) {
  return String(email ?? '').trim().toLowerCase() === TESTER_PKB_EMAIL &&
    String(displayName ?? '').trim().toLowerCase() === 'ghost'
}

export function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value ?? ''))
}

export function captureStartStatus(portalOpened) {
  return portalOpened ? 'dashboard_opened' : 'details_required'
}

export function boundedText(value, maxLength) {
  const text = String(value ?? '').trim()
  return text ? text.slice(0, maxLength) : null
}
