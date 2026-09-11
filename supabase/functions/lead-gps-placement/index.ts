import { createClient } from 'npm:@supabase/supabase-js@2.95.0'
import { corsHeaders } from 'npm:@supabase/supabase-js@2.95.0/cors'
import { serveWithOrganizationAccess } from '../_shared/organization-paywall.ts'

const json = (body: unknown, status = 200) => Response.json(body, {
  status, headers: { ...corsHeaders, 'Cache-Control': 'no-store' },
})
const errors = new Set(['active_field_role_required', 'active_user_profile_required', 'admin_required',
  'enabled_required', 'gps_pilot_not_enabled', 'current_location_consent_required', 'unsupported_action',
  'request_id_required', 'request_payload_changed', 'valid_gps_required', 'fresh_gps_required',
  'complete_valid_address_required', 'address_group_not_authorized', 'stale_location', 'contact_too_long',
  'use_selected_door_contact_editor', 'saved_door_visit_required', 'lead_not_available', 'lead_not_authorized'])

serveWithOrganizationAccess('lead_management', async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  try {
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const jwt = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/, '')
    const { data: { user }, error: authError } = await db.auth.getUser(jwt)
    if (authError || !user?.email) return json({ error: 'unauthorized' }, 401)
    const raw = await request.text()
    if (raw.length > 16000) return json({ error: 'request_too_large' }, 413)
    let body
    try { body = JSON.parse(raw) } catch { return json({ error: 'invalid_json' }, 400) }
    if (!body || !['status', 'set_pilot', 'place_address', 'refine_disposition'].includes(body.action)) {
      return json({ error: 'unsupported_action' }, 400)
    }
    const { data, error } = await db.rpc('field_gps_placement', {
      p_actor_auth_id: user.id, p_actor_email: user.email.toLowerCase(),
      p_action: body.action, p_input: body.input || {},
    })
    if (error) {
      const reason = errors.has(error.message) ? error.message : 'gps_placement_failed'
      const status = error.code === '42501' ? 403 : error.code === '40001' ? 409 : error.code === 'P0002' ? 404 : 400
      // Diagnostics contain a stable error code, never an address, GPS, JWT or SQL.
      console.warn('lead-gps-placement rejected', { code: error.code, reason })
      return json({ ok: false, error: reason }, status)
    }
    return json(data)
  } catch {
    return json({ ok: false, error: 'gps_placement_unavailable' }, 503)
  }
})
