const EARTH_RADIUS_METERS = 6371000

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

export function fullAddress(lead) {
  return [lead?.address1, lead?.address2, lead?.city, lead?.state, lead?.zip]
    .map(value => String(value || '').trim())
    .filter(Boolean)
    .join(', ')
}

function baseAddressKey(lead) {
  return [lead?.address1, lead?.city, lead?.state, lead?.zip]
    .map(value => String(value || '').trim().toUpperCase().replace(/\s+/g, ' '))
    .join('|')
}

function coordinateKey(lead) {
  const latitude = finiteCoordinate(lead?.latitude, -90, 90)
  const longitude = finiteCoordinate(lead?.longitude, -180, 180)
  return latitude === null || longitude === null ? null : `${latitude}|${longitude}`
}

function stableHash(value) {
  let hash = 2166136261
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

export function selectSuspiciousCohort(leads, limit = 100) {
  const groups = new Map()
  for (const lead of Array.isArray(leads) ? leads : []) {
    const key = coordinateKey(lead)
    if (!key) continue
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(lead)
  }

  const primaryCandidates = []
  const fallbackCandidates = []
  for (const [key, rows] of groups) {
    const distinctBaseAddresses = new Set(rows.map(baseAddressKey).filter(Boolean))
    if (distinctBaseAddresses.size < 2) continue
    const eligible = rows.filter(lead => {
      const verification = normalizedStatus(lead?.geocode_verification_status || 'pending_google')
      const status = normalizedStatus(lead?.geocode_status)
      return ['pending_google', 'trusted_pending_google_comparison'].includes(verification)
        && ['matched', 'google_mymaps'].includes(status)
    })
    if (!eligible.length) continue
    eligible.sort((left, right) =>
      (normalizedStatus(left?.geocode_status) === 'matched' ? 0 : 1)
      - (normalizedStatus(right?.geocode_status) === 'matched' ? 0 : 1)
      || fullAddress(left).localeCompare(fullAddress(right))
      || String(left.id).localeCompare(String(right.id))
    )
    const tier = normalizedStatus(eligible[0]?.geocode_status) === 'matched'
      ? 'census_matched_pending_google'
      : 'google_mymaps_pending_google'
    const candidate = {
      ...eligible[0],
      pilot_cohort_tier: tier,
      suspicious_coordinate_stack_size: rows.length,
      suspicious_distinct_base_addresses: distinctBaseAddresses.size,
      suspicious_coordinate_key: key,
      sample_hash: stableHash(key)
    }
    if (tier === 'census_matched_pending_google') primaryCandidates.push(candidate)
    else fallbackCandidates.push(candidate)
  }

  const stableSort = candidates => candidates.sort((left, right) =>
    left.sample_hash - right.sample_hash
    || String(left.suspicious_coordinate_key).localeCompare(String(right.suspicious_coordinate_key))
    || String(left.id).localeCompare(String(right.id))
  )
  stableSort(primaryCandidates)
  stableSort(fallbackCandidates)
  return [...primaryCandidates, ...fallbackCandidates]
    .slice(0, Math.max(0, Math.floor(Number(limit) || 0)))
}

export function countSuspiciousCoordinateStacks(leads) {
  const groups = new Map()
  for (const lead of Array.isArray(leads) ? leads : []) {
    const key = coordinateKey(lead)
    if (!key) continue
    if (!groups.has(key)) groups.set(key, new Set())
    groups.get(key).add(baseAddressKey(lead))
  }
  return [...groups.values()].filter(addresses => addresses.size >= 2).length
}

export function fieldPlacementForLead(lead, visits = []) {
  if (normalizedStatus(lead?.geocode_verification_status) === 'manual_door_verified') {
    const latitude = finiteCoordinate(lead?.latitude, -90, 90)
    const longitude = finiteCoordinate(lead?.longitude, -180, 180)
    if (latitude !== null && longitude !== null) {
      return { latitude, longitude, source: 'admin_manual_door_pin', accuracy_meters: null, observed_at: lead?.geocode_verified_at || null }
    }
  }

  const observations = []
  for (const visit of Array.isArray(visits) ? visits : []) {
    if (visit?.gps_verified_at_disposition === true
      && Number(visit?.disposition_accuracy_meters) >= 0
      && Number(visit?.disposition_accuracy_meters) <= 35) {
      const latitude = finiteCoordinate(visit?.disposition_latitude, -90, 90)
      const longitude = finiteCoordinate(visit?.disposition_longitude, -180, 180)
      if (latitude !== null && longitude !== null) observations.push({
        latitude, longitude, source: 'verified_disposition_gps',
        accuracy_meters: Number(visit.disposition_accuracy_meters),
        observed_at: visit.disposition_at || visit.updated_at || visit.created_at || null
      })
    }
    if (visit?.gps_verified_at_arrival === true
      && Number(visit?.arrival_accuracy_meters) >= 0
      && Number(visit?.arrival_accuracy_meters) <= 35) {
      const latitude = finiteCoordinate(visit?.arrival_latitude, -90, 90)
      const longitude = finiteCoordinate(visit?.arrival_longitude, -180, 180)
      if (latitude !== null && longitude !== null) observations.push({
        latitude, longitude, source: 'verified_arrival_gps',
        accuracy_meters: Number(visit.arrival_accuracy_meters),
        observed_at: visit.arrived_at || visit.updated_at || visit.created_at || null
      })
    }
  }
  observations.sort((left, right) => String(right.observed_at || '').localeCompare(String(left.observed_at || '')))
  return observations[0] || null
}

export function addressValidationRequest(lead) {
  return {
    address: {
      regionCode: 'US',
      addressLines: [lead?.address1, lead?.address2].map(value => String(value || '').trim()).filter(Boolean),
      locality: String(lead?.city || '').trim(),
      administrativeArea: String(lead?.state || '').trim().toUpperCase(),
      postalCode: String(lead?.zip || '').trim()
    },
    enableUspsCass: true
  }
}

export function comparisonRow(lead, response, fieldPlacement = null, error = null) {
  const result = response?.result || null
  const googleLatitude = finiteCoordinate(result?.geocode?.location?.latitude, -90, 90)
  const googleLongitude = finiteCoordinate(result?.geocode?.location?.longitude, -180, 180)
  const oldLocation = { latitude: lead?.latitude, longitude: lead?.longitude }
  const googleLocation = googleLatitude === null || googleLongitude === null
    ? null : { latitude: googleLatitude, longitude: googleLongitude }
  const oldToGoogle = googleLocation ? metersBetween(oldLocation, googleLocation) : null
  const googleToField = googleLocation && fieldPlacement ? metersBetween(googleLocation, fieldPlacement) : null
  const oldToField = fieldPlacement ? metersBetween(oldLocation, fieldPlacement) : null
  return {
    lead_id: lead.id,
    source_id: lead.source_id || null,
    pilot_cohort_tier: lead.pilot_cohort_tier || null,
    original_address: fullAddress(lead),
    standardized_address: result?.address?.formattedAddress || null,
    place_id: result?.geocode?.placeId || null,
    old_latitude: finiteCoordinate(lead?.latitude, -90, 90),
    old_longitude: finiteCoordinate(lead?.longitude, -180, 180),
    google_latitude: googleLatitude,
    google_longitude: googleLongitude,
    field_confirmed_latitude: fieldPlacement?.latitude ?? null,
    field_confirmed_longitude: fieldPlacement?.longitude ?? null,
    field_confirmation_source: fieldPlacement?.source || null,
    field_accuracy_meters: fieldPlacement?.accuracy_meters ?? null,
    field_observed_at: fieldPlacement?.observed_at || null,
    old_to_google_meters: oldToGoogle,
    google_to_field_meters: googleToField,
    old_to_field_meters: oldToField,
    possible_next_action: result?.verdict?.possibleNextAction || null,
    address_complete: result?.verdict?.addressComplete ?? null,
    validation_granularity: result?.verdict?.validationGranularity || null,
    geocode_granularity: result?.verdict?.geocodeGranularity || null,
    usps_dpv_confirmation: result?.uspsData?.dpvConfirmation || null,
    suspicious_coordinate_stack_size: lead.suspicious_coordinate_stack_size,
    suspicious_distinct_base_addresses: lead.suspicious_distinct_base_addresses,
    api_status: error ? 'error' : result ? 'validated' : 'no_result',
    api_error: error ? String(error) : null
  }
}
