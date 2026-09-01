import { serveWithOrganizationAccess } from '../_shared/organization-paywall.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.95.0'
import { corsHeaders } from 'npm:@supabase/supabase-js@2.95.0/cors'
import { Client as GoogleMapsClient } from 'npm:@googlemaps/google-maps-services-js@3.4.2'

const maps = new GoogleMapsClient({})
const json = (body: unknown, status = 200) => Response.json(body, {
  status,
  headers: { ...corsHeaders, 'Cache-Control': 'no-store' },
})
const clean = (value: unknown) => String(value ?? '').trim().replace(/\s+/g, ' ')
const has = (value: any, key: string) => Object.prototype.hasOwnProperty.call(value || {}, key)
const FIELD_ROLES = new Set(['admin', 'manager', 'trainer', 'rep', 'tester'])

function limited(value: unknown, max: number, field: string) {
  const result = clean(value)
  if (result.length > max) throw new Error(`${field}_too_long`)
  return result
}

function fullAddress(value: any) {
  return [
    [value.address1, value.address2].filter(Boolean).join(' '),
    value.city,
    [value.state, value.zip].filter(Boolean).join(' '),
  ].filter(Boolean).join(', ')
}

function point(value: any) {
  const latitude = Number(value?.lat ?? value?.latitude)
  const longitude = Number(value?.lng ?? value?.longitude)
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) return null
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) return null
  return { latitude, longitude }
}

serveWithOrganizationAccess('lead_management',async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  try {
    const jwt = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/, '')
    if (!jwt) return json({ error: 'unauthorized' }, 401)

    const db = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    )
    const { data: { user }, error: userError } = await db.auth.getUser(jwt)
    if (userError || !user?.email) return json({ error: 'unauthorized' }, 401)

    const email = user.email.toLowerCase()
    const { data: access, error: accessError } = await db
      .from('app_user_access')
      .select('email,active,role,organization_id,assigned_manager_email,assigned_admin_email')
      .eq('email', email)
      .maybeSingle()
    if (accessError) throw accessError
    const role = String(access?.role || '').toLowerCase()
    if (!access?.active || !access.organization_id || !FIELD_ROLES.has(role)) {
      return json({ error: 'active_field_role_required' }, 403)
    }

    let profile: any = null
    const byAuth = await db.from('users')
      .select('id,email,role,organization_id,auth_user_id')
      .eq('organization_id', access.organization_id)
      .eq('auth_user_id', user.id)
      .eq('active', true)
      .maybeSingle()
    if (byAuth.error) throw byAuth.error
    profile = byAuth.data
    if (!profile) {
      const byEmail = await db.from('users')
        .select('id,email,role,organization_id,auth_user_id')
        .eq('organization_id', access.organization_id)
        .ilike('email', email)
        .eq('active', true)
        .maybeSingle()
      if (byEmail.error) throw byEmail.error
      profile = byEmail.data
    }
    if (!profile?.id) return json({ error: 'active_user_profile_required' }, 403)

    const body = await request.json().catch(() => ({}))
    const action = String(body.action || '')

    const getLead = async (leadId: string) => {
      const { data, error } = await db.from('leads')
        .select('id,organization_id,source_system,address1,address2,city,state,zip,latitude,longitude,customer_name,phone,notes,current_disposition,stage,assigned_rep_id,assigned_manager_id,assigned_admin_email,created_by_user_id,created_by_email,contact_updated_at,contact_updated_by,contact_updated_by_email')
        .eq('id', leadId)
        .eq('organization_id', access.organization_id)
        .is('deleted_at', null)
        .not('source_system', 'ilike', '%demo%')
        .maybeSingle()
      if (error) throw error
      return data
    }

    const audit = async (leadId: string, auditAction: string, previous: any, incoming: any) => {
      const { error } = await db.from('lead_contact_edit_history').insert({
        organization_id: access.organization_id,
        lead_id: leadId,
        actor_user_id: user.id,
        actor_email: email,
        actor_role: role,
        action: auditAction,
        previous_values: previous || {},
        incoming_values: incoming || {},
      })
      if (error) throw error
    }

    const updateContact = async (lead: any, input: any, auditAction = 'update_contact') => {
      const patch: any = {
        contact_updated_at: new Date().toISOString(),
        contact_updated_by: user.id,
        contact_updated_by_email: email,
      }
      if (has(input, 'customer_name')) patch.customer_name = limited(input.customer_name, 160, 'customer_name') || null
      if (has(input, 'phone')) patch.phone = limited(input.phone, 40, 'phone') || null
      if (has(input, 'notes')) patch.notes = String(input.notes ?? '').trim().slice(0, 5000)

      const previous = {
        customer_name: lead.customer_name || null,
        phone: lead.phone || null,
        notes: lead.notes || '',
      }
      const { data: updated, error } = await db.from('leads')
        .update(patch)
        .eq('id', lead.id)
        .eq('organization_id', access.organization_id)
        .is('deleted_at', null)
        .select('id,address1,address2,city,state,zip,latitude,longitude,customer_name,phone,notes,current_disposition,stage,assigned_rep_id,assigned_manager_id,assigned_admin_email,contact_updated_at,contact_updated_by_email')
        .single()
      if (error) throw error
      await audit(lead.id, auditAction, previous, {
        customer_name: updated.customer_name || null,
        phone: updated.phone || null,
        notes: updated.notes || '',
      })
      return updated
    }

    if (action === 'get_lead') {
      const leadId = String(body.lead_id || '')
      if (!leadId) return json({ error: 'lead_id_required' }, 400)
      const lead = await getLead(leadId)
      if (!lead) return json({ error: 'lead_not_available' }, 404)
      return json({ ok: true, lead })
    }

    if (action === 'update_contact') {
      const leadId = String(body.lead_id || '')
      if (!leadId) return json({ error: 'lead_id_required' }, 400)
      const lead = await getLead(leadId)
      if (!lead) return json({ error: 'lead_not_available' }, 404)
      const updated = await updateContact(lead, body)
      return json({ ok: true, created: false, matched_existing: true, lead: updated })
    }

    if (action !== 'create_lead') return json({ error: 'unsupported_action' }, 400)

    const address = {
      address1: limited(body.address1, 180, 'address1'),
      address2: limited(body.address2, 80, 'address2'),
      city: limited(body.city, 100, 'city'),
      state: limited(body.state, 2, 'state').toUpperCase(),
      zip: limited(body.zip, 10, 'zip'),
    }
    if (!address.address1 || !address.city || !/^[A-Z]{2}$/.test(address.state) || !/^\d{5}(?:-\d{4})?$/.test(address.zip)) {
      return json({ error: 'complete_valid_address_required' }, 400)
    }
    const serviceAddress = fullAddress(address)

    const { data: exactLeadId, error: exactError } = await db.rpc('match_lead_by_service_address', {
      p_organization_id: access.organization_id,
      p_service_address: serviceAddress,
    })
    if (exactError) throw exactError
    if (exactLeadId) {
      const existing = await getLead(String(exactLeadId))
      if (existing) {
        const updated = await updateContact(existing, body, 'matched_existing_address')
        return json({
          ok: true,
          created: false,
          matched_existing: true,
          match_source: 'organization_address',
          lead: updated,
        })
      }
    }

    const googleKey = Deno.env.get('GOOGLE_MAPS_API_KEY') || ''
    if (!googleKey) return json({ error: 'google_maps_key_not_configured' }, 503)
    const geocode = await maps.geocode({
      params: { address: serviceAddress, region: 'us', key: googleKey },
      timeout: 10_000,
    })
    const result = geocode.data?.results?.[0]
    const location = point(result?.geometry?.location)
    if (!result || !location) return json({ error: 'address_not_found' }, 404)
    const precision = String(result.geometry?.location_type || '').toUpperCase() || null

    let assignedRepId: string | null = null
    let assignedManagerId: string | null = null
    let assignedAdminEmail: string | null = null
    if (role === 'admin') assignedAdminEmail = email
    if (role === 'manager' || role === 'trainer') {
      assignedManagerId = profile.id
      assignedAdminEmail = clean(access.assigned_admin_email || access.assigned_manager_email).toLowerCase() || null
    }
    if (role === 'rep' || role === 'tester') {
      assignedRepId = profile.id
      assignedAdminEmail = clean(access.assigned_admin_email).toLowerCase() || null
      const managerEmail = clean(access.assigned_manager_email).toLowerCase()
      if (managerEmail) {
        const { data: manager, error: managerError } = await db.from('users')
          .select('id')
          .eq('organization_id', access.organization_id)
          .ilike('email', managerEmail)
          .eq('active', true)
          .maybeSingle()
        if (managerError) throw managerError
        assignedManagerId = manager?.id || null
      }
    }

    const now = new Date().toISOString()
    const customerName = limited(body.customer_name, 160, 'customer_name') || null
    const phone = limited(body.phone, 40, 'phone') || null
    const notes = String(body.notes ?? '').trim().slice(0, 5000)
    const sourceId = `FIELD_ENTRY:${access.organization_id}:${crypto.randomUUID()}`
    const rooftop = precision === 'ROOFTOP'
    const { data: created, error: createError } = await db.from('leads').insert({
      organization_id: access.organization_id,
      source_system: 'FIELD_ENTRY',
      source_id: sourceId,
      address1: address.address1,
      address2: address.address2 || null,
      city: address.city,
      state: address.state,
      zip: address.zip,
      latitude: location.latitude,
      longitude: location.longitude,
      google_place_id: result.place_id || null,
      geocode_status: rooftop ? 'google_rooftop' : 'google_geocoded_review',
      geocode_provider: 'google',
      geocode_precision: precision,
      geocode_formatted_address: clean(result.formatted_address) || serviceAddress,
      geocode_place_id: result.place_id || null,
      geocode_verified_at: now,
      geocode_verification_status: rooftop ? 'google_rooftop_applied' : 'google_low_precision',
      customer_name: customerName,
      phone,
      notes,
      current_disposition: 'uncontacted',
      stage: 'Prospecting',
      pin_color: '#fbbf24',
      pin_color_source: 'stage',
      assigned_rep_id: assignedRepId,
      assigned_manager_id: assignedManagerId,
      assigned_admin_email: assignedAdminEmail,
      created_by_user_id: user.id,
      created_by_email: email,
      contact_updated_at: now,
      contact_updated_by: user.id,
      contact_updated_by_email: email,
      source_payload: {
        source: 'field_user_created_address',
        actor_email: email,
        actor_role: role,
        requested_address: serviceAddress,
        google_formatted_address: clean(result.formatted_address) || null,
      },
      source_first_seen_at: now,
      source_last_seen_at: now,
      source_seen_count: 1,
    }).select('id,address1,address2,city,state,zip,latitude,longitude,customer_name,phone,notes,current_disposition,stage,assigned_rep_id,assigned_manager_id,assigned_admin_email,geocode_status,geocode_provider,geocode_precision,geocode_verification_status').single()
    if (createError) throw createError

    await audit(created.id, 'create_field_lead', {}, {
      address1: created.address1,
      address2: created.address2,
      city: created.city,
      state: created.state,
      zip: created.zip,
      customer_name: created.customer_name,
      phone: created.phone,
      notes: created.notes,
    })

    return json({
      ok: true,
      created: true,
      matched_existing: false,
      match_source: 'new_field_address',
      location_precision: precision,
      lead: created,
    })
  } catch (error) {
    console.error('lead-field-actions', error)
    return json({
      error: 'lead_field_action_failed',
      detail: String((error as Error)?.message || error).slice(0, 300),
    }, 500)
  }
})
