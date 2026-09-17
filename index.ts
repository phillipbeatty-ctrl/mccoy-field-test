import { createClient } from 'npm:@supabase/supabase-js@2.95.0'
import { Client as GoogleMapsClient } from 'npm:@googlemaps/google-maps-services-js@3.4.2'

// Internal maintenance endpoint only -- not part of the rep-facing app, never
// linked from client code, and not registered in the paywall classification
// (it is not a normal feature; it is a one-time-plus-recurring data-repair
// tool called only from a trusted server-side context: this session's own
// SQL-driven batches now, and a pg_cron job going forward).
const INTERNAL_TOKEN = '25cad34757d11a27490a224d0141b1c37654e05bcaf347cd9a532481555b9d8a'

const maps = new GoogleMapsClient({})
const ACCEPTABLE_LOCATION_TYPES = new Set(['ROOFTOP', 'RANGE_INTERPOLATED'])
const json = (body: unknown, status = 200) => Response.json(body, { status })

function fullAddress(lead: Record<string, unknown>) {
  const parts = [lead.address1, lead.address2, lead.city, [lead.state, lead.zip].filter(Boolean).join(' ')]
  return parts.filter(part => String(part || '').trim()).join(', ')
}

Deno.serve(async request => {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  if (request.headers.get('x-internal-token') !== INTERNAL_TOKEN) return json({ error: 'unauthorized' }, 401)

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
  const googleKey = Deno.env.get('GOOGLE_MAPS_API_KEY') || ''
  if (!googleKey) return json({ error: 'google_maps_key_not_configured' }, 503)

  const body = await request.json().catch(() => ({}))
  const batchSize = Math.min(Math.max(Number(body?.batch_size) || 25, 1), 100)

  const { data: rows, error: fetchError } = await admin
    .from('leads')
    .select('id,address1,address2,city,state,zip')
    .eq('geocode_status', 'zip_centroid_review')
    .limit(batchSize)
  if (fetchError) return json({ error: 'fetch_failed', detail: fetchError.message }, 500)
  if (!rows?.length) return json({ ok: true, processed: 0, upgraded: 0, still_approximate: 0, errors: 0, remaining: 0, done: true })

  let upgraded = 0, stillApproximate = 0, errors = 0

  for (const lead of rows) {
    const address = fullAddress(lead)
    try {
      const response = await maps.geocode({ params: { address, region: 'us', key: googleKey }, timeout: 10_000 })
      const result = response.data?.results?.[0]
      const locationType = result?.geometry?.location_type
      const location = result?.geometry?.location

      if (result && location && ACCEPTABLE_LOCATION_TYPES.has(locationType || '')) {
        const { error: updateError } = await admin.from('leads').update({
          latitude: location.lat,
          longitude: location.lng,
          geocode_status: 'matched',
          geocode_provider: 'google_maps_geocoding',
          geocode_precision: locationType === 'ROOFTOP' ? 'rooftop' : 'range_interpolated',
          geocode_verification_status: null,
          geocode_place_id: result.place_id || null,
        }).eq('id', lead.id)
        if (updateError) { errors++; console.error('update failed', lead.id, updateError.message) }
        else upgraded++
      } else {
        const { error: updateError } = await admin.from('leads').update({
          geocode_status: 'regeocode_attempted_still_approximate',
          geocode_verification_status: 'needs_manual_review',
        }).eq('id', lead.id)
        if (updateError) errors++
        else stillApproximate++
      }
    } catch (error) {
      errors++
      console.error('regeocode error', lead.id, String((error as Error)?.message || error))
    }
    // Conservative pacing: this key is shared with rep-facing features that
    // should never be starved by a background maintenance batch.
    await new Promise(resolve => setTimeout(resolve, 120))
  }

  const { count: remaining } = await admin
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .eq('geocode_status', 'zip_centroid_review')

  return json({
    ok: true,
    processed: rows.length,
    upgraded,
    still_approximate: stillApproximate,
    errors,
    remaining: remaining ?? null,
    done: (remaining ?? 1) === 0,
  })
})
