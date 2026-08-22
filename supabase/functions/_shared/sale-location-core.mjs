const point = value => {
  const latitude = Number(value?.latitude)
  const longitude = Number(value?.longitude)
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) return null
  return { latitude, longitude }
}

export function metersBetweenPoints(left, right) {
  const a = point(left), b = point(right)
  if (!a || !b) return null
  const radians = value => value * Math.PI / 180
  const radius = 6371000
  const latitudeDelta = radians(b.latitude - a.latitude)
  const longitudeDelta = radians(b.longitude - a.longitude)
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(longitudeDelta / 2) ** 2
  return 2 * radius * Math.asin(Math.sqrt(haversine))
}

export function saleDistanceAudit(repLocation, customerMapLocation, now = new Date()) {
  const rep = point(repLocation)
  const customer = point(customerMapLocation)
  const capturedAt = new Date(repLocation?.captured_at || '')
  const accuracy = Number(repLocation?.accuracy_meters)
  if (!rep || Number.isNaN(capturedAt.getTime()) || Math.abs(now.getTime() - capturedAt.getTime()) > 60 * 60 * 1000) {
    return { status: 'rep_location_unavailable', distance_meters: null, accuracy_meters: null, recorded_at: null }
  }
  if (!customer) return { status: 'customer_map_location_unavailable', distance_meters: null, accuracy_meters: Number.isFinite(accuracy) && accuracy >= 0 ? accuracy : null, recorded_at: capturedAt.toISOString() }
  const distance = metersBetweenPoints(rep, customer)
  return {
    status: 'recorded',
    distance_meters: Math.round(Number(distance) * 100) / 100,
    accuracy_meters: Number.isFinite(accuracy) && accuracy >= 0 ? Math.round(accuracy * 100) / 100 : null,
    recorded_at: capturedAt.toISOString()
  }
}
