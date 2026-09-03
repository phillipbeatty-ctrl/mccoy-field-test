import { createClient } from 'npm:@supabase/supabase-js@2.95.0'
import { corsHeaders } from 'npm:@supabase/supabase-js@2.95.0/cors'

const json = (body: unknown, status = 200) => Response.json(body, {
  status,
  headers: { ...corsHeaders, 'Cache-Control': 'no-store' },
})

const cleanAddress = (value: unknown) => String(value || '')
  .replace(/[\u0000-\u001f\u007f]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, 240)

Deno.serve(async request => {
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
      .select('role,active,organization_id')
      .eq('email', user.email.toLowerCase())
      .maybeSingle()
    if (accessError) throw accessError
    if (!access?.active || !access.organization_id) return json({ error: 'forbidden' }, 403)
    if (!['admin', 'manager', 'trainer', 'rep', 'tester'].includes(String(access.role || ''))) {
      return json({ error: 'field_role_required' }, 403)
    }

    const body = await request.json().catch(() => ({}))
    const address = cleanAddress(body?.address)
    if (address.length < 5) return json({ error: 'valid_address_required' }, 400)

    const apiKey = Deno.env.get('GOOGLE_MAPS_API_KEY')
      || Deno.env.get('GOOGLE_MAPS_SERVER_API_KEY')
      || Deno.env.get('GOOGLE_GEOCODING_API_KEY')
    if (!apiKey) return json({ error: 'google_maps_key_not_configured' }, 503)

    const endpoint = new URL('https://maps.googleapis.com/maps/api/geocode/json')
    endpoint.searchParams.set('address', address)
    endpoint.searchParams.set('key', apiKey)
    endpoint.searchParams.set('region', 'us')

    const response = await fetch(endpoint, {
      headers: { 'User-Agent': 'McCoy-Platform-Lead-Address-Lookup/1.0' },
    })
    if (!response.ok) return json({ error: 'google_geocode_http_error' }, 502)
    const result = await response.json()
    if (result?.status === 'ZERO_RESULTS') return json({ error: 'address_not_found' }, 404)
    if (result?.status !== 'OK' || !Array.isArray(result?.results) || !result.results.length) {
      console.error('lead-address-lookup Google status', result?.status, result?.error_message)
      return json({ error: 'google_geocode_failed' }, 502)
    }

    const top = result.results[0]
    const latitude = Number(top?.geometry?.location?.lat)
    const longitude = Number(top?.geometry?.location?.lng)
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90
      || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      return json({ error: 'invalid_google_coordinates' }, 502)
    }

    return json({
      ok: true,
      address,
      formatted_address: cleanAddress(top.formatted_address) || address,
      latitude,
      longitude,
      place_id: String(top.place_id || '').slice(0, 200) || null,
      location_type: String(top?.geometry?.location_type || '').slice(0, 40) || null,
      partial_match: top.partial_match === true,
      source: 'google_geocoding',
      organization_id: access.organization_id,
    })
  } catch (error) {
    console.error('lead-address-lookup', error)
    return json({ error: 'lead_address_lookup_failed' }, 500)
  }
})
