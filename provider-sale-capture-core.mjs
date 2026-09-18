export const SALE_PROVIDERS = Object.freeze([
  'Quantum',
  'Brightspeed',
  'AT&T',
  'T-Mobile / T-Fiber',
  'Kinetic',
  'Fidium',
  'Ziply',
  'Ascend Fiber',
  'Lightcurve',
  'Ripple Fiber',
  'Starlink',
  'DIRECTV',
  'Vivint',
  'EarthLink',
  'HawaiianTelecom',
  'WOW!',
  'Other'
])

export const SALE_OUTCOMES = Object.freeze(['completed', 'abandoned'])
export const TESTER_PKB_EMAIL = 'phillipkbeatty@gmail.com'

// Which broker(s) each provider is actually sold through. Brightspeed is the
// only provider confirmed to run through both -- RS&I ($550/2Gig, existing)
// and DSI ($600/2Gig, new as of 2026-09-16). The seven DSI-contracted
// providers (Vivint, DIRECTV, Ziply, Ripple Fiber, Fidium, EarthLink,
// HawaiianTelecom) have no confirmed RS&I relationship, so DSI is their only
// listed option -- this is deliberately not offered as a visible choice for
// them, since there is nothing to actually choose between. Everything else
// defaults to RS&I, matching every sale on file before broker existed as a
// concept at all. WOW! has no DSI indication in its rate card, so it stays RS&I.
export const SALE_BROKERS = Object.freeze(['RS&I', 'DSI'])
export const PROVIDER_BROKER_OPTIONS = Object.freeze({
  Quantum: Object.freeze(['RS&I']),
  Brightspeed: Object.freeze(['RS&I', 'DSI']),
  'AT&T': Object.freeze(['RS&I']),
  'T-Mobile / T-Fiber': Object.freeze(['RS&I']),
  Kinetic: Object.freeze(['RS&I']),
  Fidium: Object.freeze(['DSI']),
  Ziply: Object.freeze(['DSI']),
  'Ascend Fiber': Object.freeze(['RS&I']),
  Lightcurve: Object.freeze(['RS&I']),
  'Ripple Fiber': Object.freeze(['DSI']),
  Starlink: Object.freeze(['RS&I']),
  DIRECTV: Object.freeze(['DSI']),
  Vivint: Object.freeze(['DSI']),
  EarthLink: Object.freeze(['DSI']),
  HawaiianTelecom: Object.freeze(['DSI']),
  'WOW!': Object.freeze(['RS&I']),
  Other: Object.freeze(['RS&I'])
})

const normalized = value => String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '')

export function normalizeSaleProvider(value) {
  const input = normalized(value)
  if (input.includes('brightspeed') || input === 'bass') return 'Brightspeed'
  if (input.includes('quantum') || input === 'asap' || input === 'quantumasap') return 'Quantum'
  if (input === 'att' || input.includes('atandt')) return 'AT&T'
  if (input.includes('tmobile') || input.includes('tfiber')) return 'T-Mobile / T-Fiber'
  if (input.includes('kinetic') || input.includes('windstream')) return 'Kinetic'
  if (input.includes('fidium')) return 'Fidium'
  if (input === 'ziply' || input === 'ziplyfiber') return 'Ziply'
  if (input.includes('ascend')) return 'Ascend Fiber'
  if (input.includes('lightcurve')) return 'Lightcurve'
  if (input.includes('ripple')) return 'Ripple Fiber'
  if (input.includes('starlink')) return 'Starlink'
  if (input.includes('directv')) return 'DIRECTV'
  if (input.includes('vivint') || input.includes('vivant')) return 'Vivint'
  if (input.includes('earthlink')) return 'EarthLink'
  if (input.includes('hawaiiantelecom') || input.includes('hawaiitelecom')) return 'HawaiianTelecom'
  if (input === 'wow') return 'WOW!'
  if (input === 'other') return 'Other'
  return null
}

// Validates broker against the specific provider's allowed list, not just
// against SALE_BROKERS in general -- a syntactically valid broker value
// (e.g. "DSI" for Quantum, which has no DSI relationship) is still rejected,
// since accepting it would silently misapply a commission rate that doesn't
// correspond to any real business relationship. Falls back to the
// provider's sole option when only one exists, so callers that don't send
// broker at all (older clients) keep working exactly as before.
export function normalizeBroker(value, provider) {
  const options = PROVIDER_BROKER_OPTIONS[provider]
  if (!options || options.length === 0) return null
  const input = String(value ?? '').trim().toUpperCase()
  if (!input) return options[0]
  const match = options.find(option => option.toUpperCase() === input)
  return match || null
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
