import { serveWithOrganizationAccess } from '../_shared/organization-paywall.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.95.0'
import { corsHeaders } from 'npm:@supabase/supabase-js@2.95.0/cors'
import { Client as GoogleMapsClient } from 'npm:@googlemaps/google-maps-services-js@3.4.2'

const maps = new GoogleMapsClient({})
const json = (body: unknown, status = 200) => Response.json(body, {
  status,
  headers: { ...corsHeaders, 'Cache-Control': 'no-store' },
})
const clean = (value: unknown) => String(value || '').trim().replace(/\s+/g, ' ')
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function validTimeZone(value: string) {
  if (!value || value.length > 80) return false
  try { new Intl.DateTimeFormat('en-US', { timeZone: value }).format(); return true } catch { return false }
}

serveWithOrganizationAccess('analytics', async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  try {
    const jwt = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/, '')
    if (!jwt) return json({ error: 'unauthorized' }, 401)
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    )
    const { data: { user }, error: userError } = await admin.auth.getUser(jwt)
    if (userError || !user?.id || !user.email) return json({ error: 'unauthorized' }, 401)
    const email = user.email.toLowerCase()
    const { data: access, error: accessError } = await admin.from('app_user_access')
      .select('active,role,organization_id').eq('email', email).maybeSingle()
    if (accessError) throw accessError
    if (!access?.active || access.role !== 'admin' || !access.organization_id) {
      return json({ error: 'admin_required' }, 403)
    }

    const body = await request.json().catch(() => ({}))
    const action = clean(body.action)

    if (action === 'list_home_settings') {
      const [{ data: accounts, error: accountError }, { data: profiles, error: profileError }] = await Promise.all([
        admin.from('app_user_access').select('email,display_name,role,team_name')
          .eq('organization_id', access.organization_id).eq('active', true).order('display_name'),
        admin.from('users').select('auth_user_id,email').eq('organization_id', access.organization_id).eq('active', true),
      ])
      if (accountError) throw accountError
      if (profileError) throw profileError
      const profileByEmail = new Map((profiles || []).map((row: any) => [String(row.email || '').toLowerCase(), row]))
      const userIds = (profiles || []).map((row: any) => row.auth_user_id).filter(Boolean)
      let settings: any[] = []
      if (userIds.length) {
        const { data, error } = await admin.from('sph_rep_settings')
          .select('user_id,home_label,home_accuracy_meters,workday_timezone,home_geocode_provider,updated_at')
          .in('user_id', userIds)
        if (error) throw error
        settings = data || []
      }
      const settingByUser = new Map(settings.map((row: any) => [String(row.user_id), row]))
      const users = (accounts || []).map((account: any) => {
        const profile: any = profileByEmail.get(String(account.email || '').toLowerCase())
        const setting: any = profile?.auth_user_id ? settingByUser.get(String(profile.auth_user_id)) : null
        return {
          user_id: profile?.auth_user_id || null,
          email: account.email,
          display_name: account.display_name || account.email,
          role: account.role,
          team_name: account.team_name || null,
          home_configured: Boolean(setting?.home_label),
          home_label: setting?.home_label || null,
          home_accuracy_meters: setting?.home_accuracy_meters ?? null,
          workday_timezone: setting?.workday_timezone || 'America/Los_Angeles',
          home_geocode_provider: setting?.home_geocode_provider || null,
          updated_at: setting?.updated_at || null,
        }
      })
      return json({ ok: true, users })
    }

    if (action === 'set_home') {
      const targetUserId = clean(body.target_user_id)
      const requestedAddress = clean(body.home_address)
      const workdayTimezone = clean(body.workday_timezone) || 'America/Los_Angeles'
      if (!uuid.test(targetUserId)) return json({ error: 'valid_target_user_required' }, 400)
      if (requestedAddress.length < 8 || requestedAddress.length > 240) {
        return json({ error: 'complete_home_address_required' }, 400)
      }
      if (!validTimeZone(workdayTimezone)) return json({ error: 'valid_workday_timezone_required' }, 400)

      const { data: target, error: targetError } = await admin.from('users')
        .select('auth_user_id,email,active').eq('auth_user_id', targetUserId)
        .eq('organization_id', access.organization_id).eq('active', true).maybeSingle()
      if (targetError) throw targetError
      if (!target) return json({ error: 'target_user_not_in_organization' }, 404)

      const googleKey = Deno.env.get('GOOGLE_MAPS_API_KEY') || ''
      if (!googleKey) return json({ error: 'google_maps_key_not_configured' }, 503)
      const response = await maps.geocode({
        params: { address: requestedAddress, region: 'us', key: googleKey }, timeout: 10_000,
      })
      const result = response.data?.results?.[0]
      const location = result?.geometry?.location
      const components = result?.address_components || []
      const has = (type: string) => components.some((item: any) => item.types?.includes(type))
      const country = components.find((item: any) => item.types?.includes('country'))?.short_name
      const locationType = String(result?.geometry?.location_type || '')
      const exactType = result?.types?.some((type: string) => ['street_address', 'premise', 'subpremise'].includes(type))
      const precise = ['ROOFTOP', 'RANGE_INTERPOLATED'].includes(locationType)
      if (!result || !Number.isFinite(location?.lat) || !Number.isFinite(location?.lng)
          || country !== 'US' || !has('street_number') || !has('route') || !exactType || !precise) {
        return json({
          error: 'exact_residential_address_required',
          detail: 'Google must resolve a complete U.S. street address before Home can be saved.',
        }, 422)
      }
      const accuracyMeters = locationType === 'ROOFTOP' ? 20 : 50
      const { data: saved, error: saveError } = await admin.rpc('admin_set_sph_home_location', {
        p_actor_user_id: user.id,
        p_target_user_id: targetUserId,
        p_organization_id: access.organization_id,
        p_home_label: clean(result.formatted_address) || requestedAddress,
        p_latitude: location.lat,
        p_longitude: location.lng,
        p_accuracy_meters: accuracyMeters,
        p_workday_timezone: workdayTimezone,
        p_geocode_provider: 'google_geocoding',
        p_place_id: result.place_id || null,
      })
      if (saveError) throw saveError
      return json({ ok: true, ...saved, target_user_id: targetUserId, display_name: target.email })
    }

    return json({ error: 'unknown_action' }, 400)
  } catch (error) {
    console.error('admin-workday', error)
    return json({ error: 'admin_workday_failed', detail: String((error as Error)?.message || error).slice(0, 240) }, 500)
  }
})
