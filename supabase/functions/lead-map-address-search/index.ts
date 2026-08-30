import { createClient } from 'npm:@supabase/supabase-js@2.95.0'
import { corsHeaders } from 'npm:@supabase/supabase-js@2.95.0/cors'
import { Client as GoogleMapsClient } from 'npm:@googlemaps/google-maps-services-js@3.4.2'

const maps = new GoogleMapsClient({})
const json = (body: unknown, status = 200) => Response.json(body, {
  status,
  headers: { ...corsHeaders, 'Cache-Control': 'no-store' },
})

const clean = (value: unknown) => String(value || '').trim().replace(/\s+/g, ' ')
const compact = (value: unknown) => clean(value).toLowerCase().replace(/[^a-z0-9]/g, '')
const normalizeEmail = (value: unknown) => clean(value).toLowerCase()
const isManagerRole = (role: unknown) => role === 'manager' || role === 'trainer'
const isRepresentativeRole = (role: unknown) => role === 'rep' || role === 'tester'
const fullAddress = (lead: any) => [
  [lead?.address1, lead?.address2].filter(Boolean).join(' '),
  lead?.city,
  [lead?.state, lead?.zip].filter(Boolean).join(' '),
].filter(Boolean).join(', ')

function point(value: any) {
  const latitude = Number(value?.latitude ?? value?.lat)
  const longitude = Number(value?.longitude ?? value?.lng)
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) return null
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) return null
  return { latitude, longitude }
}

function metersBetween(left: any, right: any) {
  const a = point(left), b = point(right)
  if (!a || !b) return null
  const radians = (value: number) => value * Math.PI / 180
  const radius = 6_371_000
  const dLat = radians(b.latitude - a.latitude)
  const dLng = radians(b.longitude - a.longitude)
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(dLng / 2) ** 2
  return 2 * radius * Math.asin(Math.sqrt(h))
}

function streetNumber(value: unknown) {
  return clean(value).match(/^\s*(\d+[a-z]?)/i)?.[1]?.toLowerCase() || ''
}

function leadPayload(lead: any) {
  return {
    id: lead.id,
    address1: lead.address1 || '',
    address2: lead.address2 || '',
    city: lead.city || '',
    state: lead.state || '',
    zip: lead.zip || '',
    full_address: fullAddress(lead),
    latitude: lead.latitude == null ? null : Number(lead.latitude),
    longitude: lead.longitude == null ? null : Number(lead.longitude),
    current_disposition: lead.current_disposition || null,
    stage: lead.stage || null,
    assigned_rep_id: lead.assigned_rep_id || null,
    assigned_manager_id: lead.assigned_manager_id || null,
  }
}

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

    const email = normalizeEmail(user.email)
    const { data: access, error: accessError } = await admin
      .from('app_user_access')
      .select('active,role,organization_id,assigned_manager_email,assigned_admin_email')
      .eq('email', email)
      .maybeSingle()
    if (accessError) throw accessError
    if (!access?.active || !access.organization_id) return json({ error: 'active_access_required' }, 403)
    const role = String(access.role || '').toLowerCase()
    if (!['admin', 'manager', 'trainer', 'rep', 'tester'].includes(role)) return json({ error: 'field_role_required' }, 403)

    const { data: profile, error: profileError } = await admin
      .from('users')
      .select('id,email,active,organization_id')
      .eq('organization_id', access.organization_id)
      .eq('auth_user_id', user.id)
      .eq('active', true)
      .maybeSingle()
    if (profileError) throw profileError
    if (!profile?.id) return json({ error: 'active_user_profile_required' }, 403)

    let scope: any = { kind: 'organization_all' }
    if (isManagerRole(role)) {
      const adminEmail = normalizeEmail(access.assigned_manager_email)
      const validFields = adminEmail && adminEmail === normalizeEmail(access.assigned_admin_email)
      const { data: owner, error: ownerError } = validFields
        ? await admin
          .from('app_user_access')
          .select('email,active,role,organization_id')
          .eq('organization_id', access.organization_id)
          .eq('email', adminEmail)
          .eq('active', true)
          .eq('role', 'admin')
          .maybeSingle()
        : { data: null, error: null }
      if (ownerError) throw ownerError
      scope = owner ? { kind: 'manager_pool', manager_id: profile.id, admin_email: adminEmail } : { kind: 'none' }
    } else if (isRepresentativeRole(role)) {
      const managerEmail = normalizeEmail(access.assigned_manager_email)
      const { data: managerAccess, error: managerError } = managerEmail
        ? await admin
          .from('app_user_access')
          .select('email,active,role,assigned_manager_email,assigned_admin_email,organization_id')
          .eq('organization_id', access.organization_id)
          .eq('email', managerEmail)
          .eq('active', true)
          .maybeSingle()
        : { data: null, error: null }
      if (managerError) throw managerError
      const adminEmail = normalizeEmail(managerAccess?.assigned_manager_email)
      const managerFieldsValid = isManagerRole(managerAccess?.role)
        && adminEmail
        && adminEmail === normalizeEmail(managerAccess?.assigned_admin_email)
      const [{ data: managerProfile, error: managerProfileError }, { data: owner, error: ownerError }] = managerFieldsValid
        ? await Promise.all([
          admin
            .from('users')
            .select('id,email,active,organization_id')
            .eq('organization_id', access.organization_id)
            .ilike('email', managerEmail)
            .eq('active', true)
            .maybeSingle(),
          admin
            .from('app_user_access')
            .select('email,active,role,organization_id')
            .eq('organization_id', access.organization_id)
            .eq('email', adminEmail)
            .eq('active', true)
            .eq('role', 'admin')
            .maybeSingle(),
        ])
        : [{ data: null, error: null }, { data: null, error: null }]
      if (managerProfileError) throw managerProfileError
      if (ownerError) throw ownerError
      scope = managerProfile?.id && owner
        ? { kind: 'rep_assigned', rep_id: profile.id, manager_id: managerProfile.id, admin_email: adminEmail }
        : { kind: 'none' }
    }

    const applyScope = (query: any) => {
      query = query.eq('organization_id', access.organization_id).is('deleted_at', null)
      if (scope.kind === 'manager_pool') {
        return query.eq('assigned_manager_id', scope.manager_id).ilike('assigned_admin_email', scope.admin_email)
      }
      if (scope.kind === 'rep_assigned') {
        return query
          .eq('assigned_rep_id', scope.rep_id)
          .eq('assigned_manager_id', scope.manager_id)
          .ilike('assigned_admin_email', scope.admin_email)
      }
      if (scope.kind === 'none') return query.eq('id', '00000000-0000-0000-0000-000000000000')
      return query
    }

    const body = await request.json().catch(() => ({}))
    const address = clean(body?.address)
    if (address.length < 5 || address.length > 240) return json({ error: 'valid_address_required' }, 400)

    const selectColumns = 'id,address1,address2,city,state,zip,latitude,longitude,current_disposition,stage,assigned_rep_id,assigned_manager_id,assigned_admin_email,organization_id'
    if (scope.kind !== 'none') {
      const { data: exactLeadId, error: exactError } = await admin.rpc('match_lead_by_service_address', {
        p_organization_id: access.organization_id,
        p_service_address: address,
      })
      if (exactError) throw exactError
      if (exactLeadId) {
        const { data: lead, error: leadError } = await applyScope(
          admin.from('leads').select(selectColumns).eq('id', exactLeadId),
        ).maybeSingle()
        if (leadError) throw leadError
        if (lead) {
          return json({
            ok: true,
            matched: true,
            match_source: 'exact_authorized_address',
            requested_address: address,
            service_address: fullAddress(lead),
            center: point(lead),
            lead: leadPayload(lead),
            scope: scope.kind,
          })
        }
      }
    }

    const googleKey = Deno.env.get('GOOGLE_MAPS_API_KEY') || ''
    if (!googleKey) return json({ error: 'google_maps_key_not_configured' }, 503)
    const response = await maps.geocode({
      params: { address, region: 'us', key: googleKey },
      timeout: 10_000,
    })
    const result = response.data?.results?.[0]
    const center = point(result?.geometry?.location)
    if (!result || !center) return json({ error: 'address_not_found' }, 404)

    let matchedLead: any = null
    let matchSource = 'google_geocode'
    if (scope.kind !== 'none' && result.place_id) {
      const { data: placeLead, error: placeError } = await applyScope(
        admin.from('leads').select(selectColumns).eq('geocode_place_id', result.place_id).limit(1),
      ).maybeSingle()
      if (placeError) throw placeError
      if (placeLead) {
        matchedLead = placeLead
        matchSource = 'google_place_id_authorized'
      }
    }

    if (!matchedLead && scope.kind !== 'none') {
      const latPad = 0.0015
      const lngPad = 0.0025
      const { data: nearby, error: nearbyError } = await applyScope(
        admin
          .from('leads')
          .select(selectColumns)
          .gte('latitude', center.latitude - latPad)
          .lte('latitude', center.latitude + latPad)
          .gte('longitude', center.longitude - lngPad)
          .lte('longitude', center.longitude + lngPad)
          .limit(100),
      )
      if (nearbyError) throw nearbyError
      const requestedNumber = streetNumber(address)
      const candidates = (nearby || [])
        .map(lead => ({ lead, distance: metersBetween(center, lead) }))
        .filter(item => item.distance != null)
        .sort((left, right) => Number(left.distance) - Number(right.distance))
      const best = candidates.find(item =>
        Number(item.distance) <= 60
        && (!requestedNumber || streetNumber(item.lead.address1) === requestedNumber)
      )
      if (best) {
        matchedLead = best.lead
        matchSource = 'google_nearby_authorized_address_number'
      }
    }

    const formatted = clean(result.formatted_address) || address
    return json({
      ok: true,
      matched: Boolean(matchedLead),
      match_source: matchSource,
      requested_address: address,
      service_address: matchedLead ? fullAddress(matchedLead) : formatted,
      center: matchedLead && point(matchedLead) ? point(matchedLead) : center,
      geocoded_center: center,
      google_place_id: result.place_id || null,
      lead: matchedLead ? leadPayload(matchedLead) : null,
      normalized_query: compact(address),
      scope: scope.kind,
    })
  } catch (error) {
    console.error('lead-map-address-search', error)
    return json({ error: 'lead_map_address_search_failed', detail: String((error as Error)?.message || error).slice(0, 240) }, 500)
  }
})