import { serveWithOrganizationAccess } from '../_shared/organization-paywall.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.95.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) => Response.json(body, {
  status,
  headers: { ...corsHeaders, 'Cache-Control': 'no-store' },
})

const norm = (value: unknown) => String(value || '').trim().toLowerCase()

serveWithOrganizationAccess('lead_management', async request => {
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

    const email = norm(user.email)
    const { data: access, error: accessError } = await db
      .from('app_user_access')
      .select('email,role,active,organization_id')
      .eq('email', email)
      .eq('active', true)
      .maybeSingle()
    if (accessError) throw accessError
    if (!access?.organization_id) return json({ error: 'inactive_account' }, 403)

    const role = norm(access.role)
    if (!['admin', 'manager', 'trainer', 'rep', 'tester'].includes(role)) {
      return json({ error: 'field_role_required' }, 403)
    }

    const { data: profile, error: profileError } = await db
      .from('users')
      .select('id')
      .eq('organization_id', access.organization_id)
      .ilike('email', email)
      .eq('active', true)
      .maybeSingle()
    if (profileError) throw profileError
    if (!profile?.id) return json({ error: 'active_user_profile_required' }, 403)

    const body = await request.json().catch(() => ({}))
    const leadId = String(body.lead_id || '')
    if (!leadId) return json({ error: 'lead_id_required' }, 400)

    const { data: lead, error: leadError } = await db
      .from('leads')
      .select('id,latitude,longitude,pin_location_updated_at,assigned_rep_id,assigned_manager_id,organization_id,deleted_at')
      .eq('id', leadId)
      .eq('organization_id', access.organization_id)
      .is('deleted_at', null)
      .maybeSingle()
    if (leadError) throw leadError
    if (!lead) return json({ error: 'lead_not_found' }, 404)

    const authorized = role === 'admin'
      || ((role === 'rep' || role === 'tester') && String(lead.assigned_rep_id || '') === String(profile.id))
      || ((role === 'manager' || role === 'trainer') && String(lead.assigned_manager_id || '') === String(profile.id))
    if (!authorized) return json({ error: 'unauthorized_lead' }, 403)

    return json({
      ok: true,
      lead: {
        id: lead.id,
        latitude: lead.latitude,
        longitude: lead.longitude,
        pin_location_updated_at: lead.pin_location_updated_at,
      },
    })
  } catch (error) {
    console.error('lead-pin-snapshot', error)
    return json({ error: 'lead_pin_snapshot_failed' }, 500)
  }
})
