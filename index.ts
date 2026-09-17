import { serveWithOrganizationAccess } from '../_shared/organization-paywall.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.95.0'
import { corsHeaders } from 'npm:@supabase/supabase-js@2.95.0/cors'
import { Client as GoogleMapsClient } from 'npm:@googlemaps/google-maps-services-js@3.4.2'

const maps = new GoogleMapsClient({})
const json = (body: unknown, status = 200) => Response.json(body, {
  status,
  headers: { ...corsHeaders, 'Cache-Control': 'no-store' },
})

function validLatLng(lat: unknown, lng: unknown) {
  const latitude = Number(lat)
  const longitude = Number(lng)
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) return null
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) return null
  return { latitude, longitude }
}

serveWithOrganizationAccess('lead_management', async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  try {
    const jwt = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/, '')
    if (!jwt) return json({ error: 'unauthorized' }, 401)

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    )
    const { data: { user }, error: userError } = await admin.auth.getUser(jwt)
    if (userError || !user?.email) return json({ error: 'unauthorized' }, 401)

    const { data: access, error: accessError } = await admin
      .from('app_user_access')
      .select('active,role,organization_id')
      .eq('email', user.email.toLowerCase())
      .maybeSingle()
    if (accessError) throw accessError
    if (!access?.active) return json({ error: 'active_access_required' }, 403)

    const body = await request.json().catch(() => ({}))
    const point = validLatLng(body?.lat, body?.lng)
    if (!point) return json({ error: 'valid_location_required' }, 422)

    const googleKey = Deno.env.get('GOOGLE_MAPS_API_KEY') || ''
    if (!googleKey) return json({ error: 'google_maps_key_not_configured' }, 503)

    // Switched back from Nominatim after confirmed evidence of wrong results
    // for accurate coordinates in this area (sparse OpenStreetMap coverage
    // outside dense urban cores). Google's commercially-maintained dataset is
    // already-working, already-credentialed infrastructure elsewhere in this
    // codebase (lead-geocode, lead-map-address-search).
    const response = await maps.reverseGeocode({
      params: { latlng: { lat: point.latitude, lng: point.longitude }, key: googleKey },
      timeout: 10_000,
    })
    const result = response.data?.results?.[0]
    if (!result?.formatted_address) return json({ error: 'address_not_found' }, 404)

    const location = result.geometry?.location
    return json({
      ok: true,
      address: result.formatted_address,
      latitude: location?.lat ?? point.latitude,
      longitude: location?.lng ?? point.longitude,
      google_place_id: result.place_id || null,
      requested_latitude: point.latitude,
      requested_longitude: point.longitude,
    })
  } catch (error) {
    console.error('reverse-geocode-nearest-address', error)
    return json({ error: 'reverse_geocode_failed', detail: String((error as Error)?.message || error).slice(0, 240) }, 500)
  }
})


