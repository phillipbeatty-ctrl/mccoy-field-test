import { serveWithOrganizationAccess } from '../_shared/organization-paywall.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.95.0'
import { corsHeaders } from 'npm:@supabase/supabase-js@2.95.0/cors'
import { Client as GoogleMapsClient } from 'npm:@googlemaps/google-maps-services-js@3.4.2'
import { canManageHomes, destinationRequest, verifiedDestination } from '../_shared/home-destination.mjs'

const maps = new GoogleMapsClient({})
const json = (body: unknown, status = 200) => Response.json(body, {
  status, headers: { ...corsHeaders, 'Cache-Control': 'no-store' },
})

serveWithOrganizationAccess('analytics', async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  try {
    const jwt = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
    if (!jwt) return json({ error: 'unauthorized' }, 401)
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false, autoRefreshToken: false } })
    const { data: { user }, error: userError } = await admin.auth.getUser(jwt)
    if (userError || !user?.id || !user.email) return json({ error: 'unauthorized' }, 401)
    const { data: access, error: accessError } = await admin.from('app_user_access')
      .select('active,role,organization_id').eq('email', user.email.toLowerCase()).maybeSingle()
    if (accessError) throw accessError
    if (!canManageHomes(access)) return json({ error: 'manager_or_admin_required', detail: 'A manager, trainer or Admin must update this address.' }, 403)
    const body = await request.json().catch(() => ({}))
    if (!['list_home_settings', 'set_home', 'set_homes'].includes(body.action)) return json({ error: 'unknown_action' }, 400)

    // The database supplies only the actor's authorized roster; names are not an authorization key.
    const { data: roster, error: rosterError } = await admin.rpc('get_managed_sph_home_settings', {
      p_actor_user_id: user.id, p_organization_id: access!.organization_id,
    })
    if (rosterError) throw rosterError
    if (body.action === 'list_home_settings') return json(roster)
    let change
    try { change = destinationRequest(body) } catch (error) {
      return json({ error: 'invalid_destination', detail: (error as Error).message }, 400)
    }
    const allowed = new Set((roster?.users || []).map((account: {user_id: string}) => account.user_id))
    if (change.ids.some((id: string) => !allowed.has(id))) {
      return json({ error: 'assigned_users_only', detail: 'You can update only active users assigned to you. Refresh the list and try again.' }, 403)
    }
    const key = Deno.env.get('GOOGLE_MAPS_API_KEY') || ''
    if (!key) return json({ error: 'address_verification_unavailable', detail: 'Address verification is unavailable. Please try again later.' }, 503)
    const response = await maps.geocode({ params: { address: change.address, region: 'us', key }, timeout: 10_000 })
    const destination = verifiedDestination(response.data)
    if (!destination) return json({ error: 'complete_destination_required',
      detail: 'Enter the full U.S. street address, city, state and ZIP for the home, hotel or Blitz lodging. The address must resolve to one precise location.' }, 422)

    // One transaction rechecks current assignments and saves every selected user or none.
    const { data: saved, error: saveError } = await admin.rpc('set_managed_sph_home_locations', {
      p_actor_user_id: user.id, p_target_user_ids: change.ids, p_organization_id: access!.organization_id,
      p_home_label: destination.label, p_latitude: destination.latitude, p_longitude: destination.longitude,
      p_accuracy_meters: destination.accuracy, p_workday_timezone: change.timezone,
      p_geocode_provider: 'google_geocoding', p_place_id: destination.placeId,
    })
    if (saveError?.code === '42501') return json({ error: 'assigned_users_only', detail: 'An assignment changed. Refresh the list and try again; no addresses were saved.' }, 403)
    if (saveError) throw saveError
    return json(saved)
  } catch (error) {
    // Do not log provider request objects: they can contain keys and private addresses.
    console.error('admin-workday: Home operation failed', (error as {code?: string})?.code || 'request_failed')
    return json({ error: 'home_update_failed', detail: 'Unable to verify or confirm the save. Refresh the addresses before retrying.' }, 500)
  }
})
