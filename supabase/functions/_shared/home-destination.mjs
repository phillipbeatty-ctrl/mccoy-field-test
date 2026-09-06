// Validation shared by the Edge handler and its behavior tests.
export const normalize = value => String(value ?? '').trim().replace(/\s+/g, ' ')
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export const canManageHomes = access => access?.active === true
  && ['admin', 'manager', 'trainer'].includes(access.role) && Boolean(access.organization_id)

export function destinationRequest(body) {
  const ids = body.action === 'set_home' ? [body.target_user_id] : body.target_user_ids
  if (!Array.isArray(ids) || !ids.length || ids.length > 50 || ids.some(id => typeof id !== 'string' || !uuid.test(id))) {
    throw new Error('Select between 1 and 50 users.')
  }
  const address = normalize(body.home_address), timezone = normalize(body.workday_timezone)
  if (address.length < 8 || address.length > 200) throw new Error('Enter a complete street address, city, state and ZIP (up to 200 characters).')
  try {
    if (!timezone || timezone.length > 80) throw new Error()
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format()
  } catch { throw new Error('Select the local timezone for this destination.') }
  return { ids: [...new Set(ids)], address, timezone }
}

export function verifiedDestination(data) {
  // Never silently pick the first of several matches or accept a partial address.
  if (data?.status !== 'OK' || data.results?.length !== 1) return null
  const result = data.results[0], location = result.geometry?.location
  const components = result.address_components || []
  const has = type => components.some(item => item.types?.includes(type))
  const country = components.find(item => item.types?.includes('country'))?.short_name
  const type = result.geometry?.location_type, types = result.types || []
  const lodging = types.includes('lodging')
  const address = types.some(value => ['street_address', 'premise', 'subpremise'].includes(value))
  const precise = ['ROOFTOP', 'RANGE_INTERPOLATED'].includes(type)
  if (result.partial_match || country !== 'US' || !has('street_number') || !has('route')
      || !has('administrative_area_level_1') || !has('postal_code') || !(address || lodging) || !precise
      || !Number.isFinite(location?.lat) || !Number.isFinite(location?.lng)
      || Math.abs(location.lat) > 90 || Math.abs(location.lng) > 180) return null
  const label = normalize(result.formatted_address)
  if (!label || label.length > 200 || !result.place_id) return null
  return { label, latitude: location.lat, longitude: location.lng,
    accuracy: type === 'ROOFTOP' ? 20 : 50,
    placeId: result.place_id }
}
