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

function component(result, type, short = false) {
  const entry = (result?.address_components || result?.addressComponents || []).find(item =>
    (item?.types || []).includes(type)
  )
  return entry ? String(short ? (entry.short_name ?? entry.shortText ?? entry.long_name ?? entry.longText) : (entry.long_name ?? entry.longText ?? entry.short_name ?? entry.shortText) || '') : ''
}

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
  const requestedState = normalizeToken(lead?.state || lead?.stateCode)
  const returnedState = normalizeToken(component(result, 'administrative_area_level_1', true))
  const requestedZip = zip5(lead?.zip)
  const returnedZip = zip5(component(result, 'postal_code', true))
  const returnedCountry = normalizeToken(component(result, 'country', true))
  const resultTypes = new Set((result?.types || []).map(normalizedStatus))
  const streetResult = ['street_address', 'premise', 'subpremise'].some(type => resultTypes.has(type))
  const partial = result?.partial_match === true || result?.partialMatch === true
  const houseMatches = Boolean(requestedStreetNumber && returnedStreetNumber && normalizeToken(requestedStreetNumber) === returnedStreetNumber)
  const stateMatches = !requestedState || requestedState === returnedState
  const zipMatches = !requestedZip || requestedZip === returnedZip
  const countryMatches = !returnedCountry || returnedCountry === 'US'
  const addressMatch = !partial && streetResult && houseMatches && stateMatches && zipMatches && countryMatches
  const precise = latitude !== null && longitude !== null && precision === 'ROOFTOP' && addressMatch
  const current = { latitude: lead?.latitude ?? lead?.lat, longitude: lead?.longitude ?? lead?.lng }
  const distanceMeters = latitude === null || longitude === null ? null : metersBetween(current, { latitude, longitude })
  const trusted = TRUSTED_LOCATION_STATUSES.has(normalizedStatus(lead?.geocode_status || lead?.geocodeStatus))

  let decision = 'google_low_precision'
  let reason = precision ? `precision_${precision.toLowerCase()}` : 'missing_precision'
  if (latitude === null || longitude === null) {
    decision = 'google_invalid_location'
    reason = 'invalid_location'
  } else if (!addressMatch) {
    decision = 'google_address_mismatch'
    reason = partial ? 'partial_match' : !streetResult ? 'not_a_street_result' : !houseMatches ? 'house_number_mismatch' : !stateMatches ? 'state_mismatch' : !zipMatches ? 'zip_mismatch' : 'country_mismatch'
  } else if (precise && trusted) {
    decision = distanceMeters !== null && distanceMeters > 50 ? 'google_conflict_preserved' : 'google_verified_preserved'
    reason = distanceMeters !== null && distanceMeters > 50 ? 'trusted_location_disagrees_over_50m' : 'trusted_location_agrees'
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
      requestedState,
      returnedState,
      requestedZip,
      returnedZip,
      countryMatches
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
