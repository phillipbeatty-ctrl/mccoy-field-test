const EARTH_RADIUS_METERS = 6371000

export const GOOGLE_PRECISE_STATUS = 'google_rooftop'
export const GOOGLE_PROVIDER = 'google_maps_geocoding'

export const TRUSTED_LOCATION_STATUSES = new Set([
  'google_rooftop',
  'google_address_validation',
  'google_mymaps',
  'manual',
  'field_verified',
  'spotio_verified',
  'rooftop',
  'parcel'
])

export const LOW_PRECISION_STATUSES = new Set([
  'approx_city',
  'approx_zip',
  'approx_street',
  'unmatched',
  'pending_google',
  'google_low_precision',
  'google_no_match',
  'google_address_mismatch'
])

export function normalizedStatus(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_')
}

export function finiteCoordinate(value, min, max) {
  const number = Number(value)
  return Number.isFinite(number) && number >= min && number <= max ? number : null
}

export function metersBetween(left, right) {
  const lat1 = finiteCoordinate(left?.latitude ?? left?.lat, -90, 90)
  const lng1 = finiteCoordinate(left?.longitude ?? left?.lng, -180, 180)
  const lat2 = finiteCoordinate(right?.latitude ?? right?.lat, -90, 90)
  const lng2 = finiteCoordinate(right?.longitude ?? right?.lng, -180, 180)
  if (lat1 === null || lng1 === null || lat2 === null || lng2 === null) return null
  const radians = value => value * Math.PI / 180
  const dLat = radians(lat2 - lat1), dLng = radians(lng2 - lng1)
  const haversine = Math.sin(dLat / 2) ** 2
    + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(haversine))
}

function normalizeToken(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
}

function zip5(value) {
  return String(value || '').match(/\d{5}/)?.[0] || ''
}

function streetNumber(value) {
  return String(value || '').trim().match(/^\s*(\d+[A-Z]?)/i)?.[1]?.toUpperCase() || ''
}

function streetNameOnly(value) {
  return String(value || '').trim().replace(/^\s*\d+[A-Z]?\s*/i, '')
}

// USPS Publication 28 style suffix/directional abbreviations. Both the typed
// lead data and Google's own long_name/short_name can arrive in either full
// or abbreviated form, so both sides get mapped through this same table to a
// single canonical short form before comparing -- an equality check on raw
// text would otherwise reject "123 Main Street" against Google's own
// "123 Main St" as a false mismatch.
const STREET_SUFFIX_MAP = {
  STREET: 'ST', AVENUE: 'AVE', BOULEVARD: 'BLVD', DRIVE: 'DR', COURT: 'CT',
  LANE: 'LN', ROAD: 'RD', CIRCLE: 'CIR', PLACE: 'PL', WAY: 'WY', HIGHWAY: 'HWY',
  TRAIL: 'TRL', TERRACE: 'TER', PARKWAY: 'PKWY', SQUARE: 'SQ', CROSSING: 'XING',
  POINT: 'PT', RIDGE: 'RDG', ALLEY: 'ALY', EXTENSION: 'EXT'
}
const DIRECTION_MAP = {
  NORTH: 'N', SOUTH: 'S', EAST: 'E', WEST: 'W',
  NORTHEAST: 'NE', NORTHWEST: 'NW', SOUTHEAST: 'SE', SOUTHWEST: 'SW'
}
function normalizeStreetName(value) {
  const words = String(value || '').trim().toUpperCase().replace(/[^A-Z0-9\s]/g, '').split(/\s+/).filter(Boolean)
  return words.map(word => STREET_SUFFIX_MAP[word] || DIRECTION_MAP[word] || word).join(' ')
}

// City comparison is intentionally limited to case/punctuation/whitespace
// normalization, not fuzzy matching -- genuinely different city names (a real
// pattern in this data: the same zip code legitimately serves both "Spring
// Lake" and "Anderson Creek", NC) should still surface as a mismatch for a
// human to look at, not be silently smoothed over.
function normalizeCityName(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9\s]/g, '').replace(/\s+/g, ' ')
}

function component(result, type, short = false) {
  const entry = (result?.address_components || result?.addressComponents || []).find(item =>
    (item?.types || []).includes(type)
  )
  return entry ? String(short ? (entry.short_name ?? entry.shortText ?? entry.long_name ?? entry.longText) : (entry.long_name ?? entry.longText ?? entry.short_name ?? entry.shortText) || '') : ''
}

// How far a rooftop-precise, address-matched result can land from whatever
// coordinate a lead already had -- trusted or not -- before treating it as a
// likely mismatch rather than a normal refinement. Zip-centroid and census
// estimates are routinely a mile or more off from the true address by
// design, so this has to be looser than the 50m threshold already used for
// disagreements with an already-trusted location; it exists to catch gross
// same-name-different-place errors, not to second-guess ordinary precision
// improvements.
const GROSS_RELOCATION_METERS = 5000

export function leadAddress(lead) {
  const street = String(lead?.address1 || lead?.address || '').trim()
  const city = String(lead?.city || '').trim()
  const state = String(lead?.state || lead?.stateCode || '').trim().toUpperCase()
  const zip = String(lead?.zip || '').trim()
  return [street, city, [state, zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')
}

export function googleResultAssessment(lead, result) {
  if (!result) {
    return {
      precise: false,
      addressMatch: false,
      decision: 'google_no_match',
      reason: 'no_result',
      precision: null,
      location: null,
      formattedAddress: null,
      placeId: null,
      distanceMeters: null
    }
  }

  const location = result?.geometry?.location || result?.location || null
  const latitude = finiteCoordinate(location?.lat ?? location?.latitude, -90, 90)
  const longitude = finiteCoordinate(location?.lng ?? location?.longitude, -180, 180)
  const precision = String(result?.geometry?.location_type || result?.granularity || '').trim().toUpperCase()
  const requestedStreetNumber = streetNumber(lead?.address1 || lead?.address)
  const returnedStreetNumber = normalizeToken(component(result, 'street_number', true))
  const requestedStreetName = normalizeStreetName(streetNameOnly(lead?.address1 || lead?.address))
  const returnedStreetName = normalizeStreetName(component(result, 'route', false) || component(result, 'route', true))
  const requestedCity = normalizeCityName(lead?.city)
  const returnedCity = normalizeCityName(
    component(result, 'locality', false) || component(result, 'sublocality', false) || component(result, 'postal_town', false)
  )
  const requestedState = normalizeToken(lead?.state || lead?.stateCode)
  const returnedState = normalizeToken(component(result, 'administrative_area_level_1', true))
  const requestedZip = zip5(lead?.zip)
  const returnedZip = zip5(component(result, 'postal_code', true))
  const returnedCountry = normalizeToken(component(result, 'country', true))
  const resultTypes = new Set((result?.types || []).map(normalizedStatus))
  const streetResult = ['street_address', 'premise', 'subpremise'].some(type => resultTypes.has(type))
  const partial = result?.partial_match === true || result?.partialMatch === true
  const houseMatches = Boolean(requestedStreetNumber && returnedStreetNumber && normalizeToken(requestedStreetNumber) === returnedStreetNumber)
  const streetMatches = Boolean(requestedStreetName && returnedStreetName && requestedStreetName === returnedStreetName)
  const cityMatches = !requestedCity || requestedCity === returnedCity
  const stateMatches = !requestedState || requestedState === returnedState
  const zipMatches = !requestedZip || requestedZip === returnedZip
  const countryMatches = !returnedCountry || returnedCountry === 'US'
  const addressMatch = !partial && streetResult && houseMatches && streetMatches && cityMatches && stateMatches && zipMatches && countryMatches
  const precise = latitude !== null && longitude !== null && precision === 'ROOFTOP' && addressMatch
  const current = { latitude: lead?.latitude ?? lead?.lat, longitude: lead?.longitude ?? lead?.lng }
  const hasPriorCoordinate = finiteCoordinate(current.latitude, -90, 90) !== null && finiteCoordinate(current.longitude, -180, 180) !== null
  const distanceMeters = latitude === null || longitude === null ? null : metersBetween(current, { latitude, longitude })
  const trusted = TRUSTED_LOCATION_STATUSES.has(normalizedStatus(lead?.geocode_status || lead?.geocodeStatus))
  // Free verification against whatever coordinate the lead already had, even
  // an untrusted one -- no additional API call, since this only compares
  // numbers already in hand from the existing record and this same request.
  const grossRelocation = hasPriorCoordinate && distanceMeters !== null && distanceMeters > GROSS_RELOCATION_METERS

  let decision = 'google_low_precision'
  let reason = precision ? `precision_${precision.toLowerCase()}` : 'missing_precision'
  if (latitude === null || longitude === null) {
    decision = 'google_invalid_location'
    reason = 'invalid_location'
  } else if (!addressMatch) {
    decision = 'google_address_mismatch'
    reason = partial ? 'partial_match' : !streetResult ? 'not_a_street_result' : !houseMatches ? 'house_number_mismatch' : !streetMatches ? 'street_name_mismatch' : !cityMatches ? 'city_mismatch' : !stateMatches ? 'state_mismatch' : !zipMatches ? 'zip_mismatch' : 'country_mismatch'
  } else if (precise && trusted) {
    decision = distanceMeters !== null && distanceMeters > 50 ? 'google_conflict_preserved' : 'google_verified_preserved'
    reason = distanceMeters !== null && distanceMeters > 50 ? 'trusted_location_disagrees_over_50m' : 'trusted_location_agrees'
  } else if (precise && grossRelocation) {
    decision = 'google_gross_relocation_flagged'
    reason = 'address_matched_but_far_from_prior_point'
  } else if (precise) {
    decision = 'google_rooftop_applied'
    reason = 'rooftop_address_match'
  } else if (trusted) {
    decision = 'google_low_precision_preserved'
    reason = `trusted_location_${reason}`
  }

  return {
    precise,
    trusted,
    addressMatch,
    decision,
    reason,
    precision: precision || null,
    location: latitude === null || longitude === null ? null : { latitude, longitude },
    formattedAddress: result?.formatted_address || result?.formattedAddress || null,
    placeId: result?.place_id || result?.placeId || null,
    distanceMeters,
    checks: {
      partial,
      streetResult,
      requestedStreetNumber,
      returnedStreetNumber,
      requestedStreetName,
      returnedStreetName,
      streetMatches,
      requestedCity,
      returnedCity,
      cityMatches,
      requestedState,
      returnedState,
      requestedZip,
      returnedZip,
      countryMatches,
      hasPriorCoordinate,
      grossRelocation,
      grossRelocationThresholdMeters: GROSS_RELOCATION_METERS
    }
  }
}

export function databasePatchForAssessment(lead, assessment, verifiedAt = new Date().toISOString()) {
  const patch = {
    geocode_provider: GOOGLE_PROVIDER,
    geocode_precision: assessment.precision,
    geocode_formatted_address: assessment.formattedAddress,
    geocode_place_id: assessment.placeId,
    geocode_verified_at: verifiedAt,
    geocode_verification_status: assessment.decision,
    geocode_comparison_distance_meters: assessment.distanceMeters,
    geocode_verification_details: {
      reason: assessment.reason,
      address_match: assessment.addressMatch,
      checks: assessment.checks || {}
    },
    geocode_attempted_at: verifiedAt
  }

  if (assessment.decision === 'google_rooftop_applied' && assessment.location) {
    patch.latitude = assessment.location.latitude
    patch.longitude = assessment.location.longitude
    patch.geocode_status = GOOGLE_PRECISE_STATUS
  } else if (!assessment.trusted && LOW_PRECISION_STATUSES.has(normalizedStatus(lead?.geocode_status)) && assessment.decision !== 'google_rooftop_applied') {
    patch.latitude = null
    patch.longitude = null
    patch.geocode_status = assessment.decision
  }
  return patch
}

export function isGoogleVerifiedLead(lead) {
  const status = normalizedStatus(lead?.geocode_status || lead?.geocodeStatus)
  const verification = normalizedStatus(lead?.geocode_verification_status || lead?.geocodeVerificationStatus)
  return (status === GOOGLE_PRECISE_STATUS && verification === 'google_rooftop_applied')
    || (status === 'google_address_validation' && verification === 'google_address_validation_applied')
}
