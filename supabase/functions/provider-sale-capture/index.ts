import { serveWithOrganizationAccess } from '../_shared/organization-paywall.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.95.0'
import { corsHeaders } from 'npm:@supabase/supabase-js@2.95.0/cors'
import {
  boundedText,
  captureStartStatus,
  isUuid,
  normalizeSaleOutcome,
  normalizeSaleProvider,
} from '../_shared/provider-sale-capture-core.mjs'

const captureFields = 'id,client_request_id,provider,sale_context,status,portal_opened,service_address,lead_label,session_id,lead_id,source_door_visit_id,metadata,created_at,updated_at'
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
})

function validPoint(value: any) {
  const latitude = Number(value?.latitude ?? value?.lat)
  const longitude = Number(value?.longitude ?? value?.lng)
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) return null
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) return null
  return { latitude, longitude }
}

serveWithOrganizationAccess('sales_tracking',async request => {
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

    const email = user.email.toLowerCase()
    const { data: access, error: accessError } = await admin
      .from('app_user_access')
      .select('role,active,display_name,organization_id')
      .eq('email', email)
      .maybeSingle()
    if (accessError) throw accessError
    if (!access?.active || !access.organization_id) return json({ error: 'forbidden' }, 403)

    const { data: profile, error: profileError } = await admin
      .from('users')
      .select('id')
      .eq('auth_user_id', user.id)
      .eq('organization_id', access.organization_id)
      .eq('active', true)
      .maybeSingle()
    if (profileError) throw profileError
    if (!profile?.id) return json({ error: 'active_user_profile_required' }, 403)

    const body = await request.json().catch(() => ({}))
    const action = String(body.action || 'start')

    if (action === 'start') {
      const clientRequestId = String(body.client_request_id || '')
      const selectedProvider = normalizeSaleProvider(body.provider)
      if (!isUuid(clientRequestId)) return json({ error: 'valid_client_request_id_required' }, 400)
      if (!selectedProvider) return json({ error: 'invalid_provider' }, 400)

      const { data: existing, error: existingError } = await admin
        .from('provider_sale_captures')
        .select(captureFields)
        .eq('organization_id', access.organization_id)
        .eq('rep_user_id', user.id)
        .eq('client_request_id', clientRequestId)
        .maybeSingle()
      if (existingError) throw existingError
      if (existing) return json({ ok: true, capture: existing, duplicate: true })

      const saleContext = body.sale_context === 'out_of_area_phone' ? 'out_of_area_phone' : 'field'
      const preserveActiveVisit = body.preserve_active_visit === true || saleContext === 'out_of_area_phone'

      let sessionId: string | null = null
      if (isUuid(body.session_id)) {
        const { data: session, error: sessionError } = await admin
          .from('test_sessions')
          .select('id,ended_at')
          .eq('id', String(body.session_id))
          .eq('tester_user_id', user.id)
          .eq('organization_id', access.organization_id)
          .maybeSingle()
        if (sessionError) throw sessionError
        if (session?.id && !session.ended_at) sessionId = session.id
      }

      let leadId: string | null = null
      if (isUuid(body.lead_id)) {
        const { data: lead, error: leadError } = await admin
          .from('leads')
          .select('id')
          .eq('id', String(body.lead_id))
          .eq('organization_id', access.organization_id)
          .is('deleted_at', null)
          .maybeSingle()
        if (leadError) throw leadError
        if (!lead?.id) return json({ error: 'lead_not_available' }, 404)
        leadId = lead.id
      }

      let sourceDoorVisitId: string | null = null
      if (!preserveActiveVisit && isUuid(body.source_door_visit_id)) {
        const { data: visit, error: visitError } = await admin
          .from('door_visits')
          .select('id,session_id,lead_id,status')
          .eq('id', String(body.source_door_visit_id))
          .eq('rep_id', profile.id)
          .eq('organization_id', access.organization_id)
          .maybeSingle()
        if (visitError) throw visitError
        if (!visit || visit.status !== 'active') return json({ error: 'source_door_visit_not_active' }, 409)
        if (sessionId && visit.session_id !== sessionId) return json({ error: 'source_visit_session_mismatch' }, 409)
        if (leadId && visit.lead_id && visit.lead_id !== leadId) return json({ error: 'source_visit_lead_mismatch' }, 409)
        sourceDoorVisitId = visit.id
        sessionId = visit.session_id
        if (!leadId && visit.lead_id) leadId = visit.lead_id
      }

      // Phone and Lead Pool remote sales are explicitly unlinked from the physical door timer.
      if (saleContext === 'out_of_area_phone') sourceDoorVisitId = null

      const customerMapLocation = validPoint(body.customer_map_location)
      const sourceName = boundedText(body.source || body.selection_source, 80) || (saleContext === 'out_of_area_phone' ? 'lead_pool_phone' : 'sales_hub')

      // SALE begins one authoritative provider attempt. Older unfinished attempts
      // for this user and organization are superseded so they cannot unlock PHOTO or COMPLETE SALE.
      const supersededAt = new Date().toISOString()
      const { error: supersedeError } = await admin
        .from('provider_sale_captures')
        .update({
          status: 'cancelled',
          rep_outcome: 'abandoned',
          rep_outcome_at: supersededAt,
          updated_at: supersededAt,
        })
        .eq('organization_id', access.organization_id)
        .eq('rep_user_id', user.id)
        .in('status', ['dashboard_opened', 'details_required'])
        .neq('client_request_id', clientRequestId)
      if (supersedeError) throw supersedeError

      const portalOpened = body.portal_opened === true
      const row = {
        organization_id: access.organization_id,
        client_request_id: clientRequestId,
        rep_user_id: user.id,
        rep_email: email,
        rep_name: boundedText(access.display_name, 160) || email,
        provider: selectedProvider,
        sale_context: saleContext,
        session_id: sessionId,
        lead_id: leadId,
        source_door_visit_id: sourceDoorVisitId,
        lead_label: boundedText(body.lead_label, 500),
        service_address: boundedText(body.service_address, 500),
        seller_portal_label: boundedText(body.seller_portal_label, 160),
        portal_opened: portalOpened,
        portal_open_reason: boundedText(body.portal_open_reason, 120),
        status: captureStartStatus(portalOpened),
        metadata: {
          capture_version: 2,
          source: sourceName,
          preserve_active_visit: preserveActiveVisit,
          customer_map_location: customerMapLocation,
        },
      }
      const { data: capture, error: insertError } = await admin
        .from('provider_sale_captures')
        .insert(row)
        .select(captureFields)
        .single()
      if (insertError) {
        if (insertError.code === '23505') {
          const { data: raced } = await admin
            .from('provider_sale_captures')
            .select(captureFields)
            .eq('organization_id', access.organization_id)
            .eq('rep_user_id', user.id)
            .eq('client_request_id', clientRequestId)
            .maybeSingle()
          if (raced) return json({ ok: true, capture: raced, duplicate: true })
        }
        throw insertError
      }
      return json({ ok: true, capture })
    }

    if (action === 'mark_returned') {
      const captureId = String(body.capture_id || '')
      if (!isUuid(captureId)) return json({ error: 'valid_capture_id_required' }, 400)
      const { data: capture, error: findError } = await admin
        .from('provider_sale_captures')
        .select('id,status,return_count')
        .eq('id', captureId)
        .eq('organization_id', access.organization_id)
        .eq('rep_user_id', user.id)
        .maybeSingle()
      if (findError) throw findError
      if (!capture) return json({ error: 'capture_not_found' }, 404)
      if (capture.status === 'recorded' || capture.status === 'cancelled') {
        return json({ ok: true, capture, unchanged: true })
      }
      const now = new Date().toISOString()
      const { data: updated, error: updateError } = await admin
        .from('provider_sale_captures')
        .update({
          status: 'details_required',
          return_count: Number(capture.return_count || 0) + 1,
          last_returned_at: now,
          updated_at: now,
        })
        .eq('id', captureId)
        .eq('organization_id', access.organization_id)
        .eq('rep_user_id', user.id)
        .select('id,status,return_count,last_returned_at,updated_at')
        .single()
      if (updateError) throw updateError
      return json({ ok: true, capture: updated })
    }

    if (action === 'set_outcome' || action === 'cancel') {
      const captureId = String(body.capture_id || '')
      if (!isUuid(captureId)) return json({ error: 'valid_capture_id_required' }, 400)
      const outcome = action === 'cancel' ? 'abandoned' : normalizeSaleOutcome(body.outcome)
      if (outcome !== 'abandoned') return json({ error: 'abandoned_outcome_required' }, 400)
      const now = new Date().toISOString()
      const { data: capture, error: updateError } = await admin
        .from('provider_sale_captures')
        .update({ status: 'cancelled', rep_outcome: 'abandoned', rep_outcome_at: now, updated_at: now })
        .eq('id', captureId)
        .eq('organization_id', access.organization_id)
        .eq('rep_user_id', user.id)
        .in('status', ['dashboard_opened', 'details_required'])
        .select('id,status,rep_outcome,rep_outcome_at,updated_at')
        .maybeSingle()
      if (updateError) throw updateError
      if (!capture) return json({ error: 'capture_not_open' }, 409)
      return json({ ok: true, capture })
    }

    if (action === 'list') {
      const isAdmin = access.role === 'admin'
      const mineOnly = body.mine_only === true || body.open_only === true
      let query = admin
        .from('provider_sale_captures')
        .select(`id,client_request_id,created_at,updated_at,rep_user_id,rep_email,rep_name,provider,sale_context,session_id,lead_id,source_door_visit_id,lead_label,service_address,seller_portal_label,portal_opened,portal_open_reason,status,rep_outcome,rep_outcome_at,return_count,last_returned_at,metadata,sales_records!sales_records_provider_capture_id_fkey(id,verification_status,verification_reason,competition_eligible,ranking_eligible,sale_status)`)
        .eq('organization_id', access.organization_id)
        .order('created_at', { ascending: false })
        .limit(isAdmin && !mineOnly ? 500 : 100)
      if (!isAdmin || mineOnly) query = query.eq('rep_user_id', user.id)
      if (body.open_only === true) query = query.in('status', ['dashboard_opened', 'details_required'])
      const { data: captures, error: listError } = await query
      if (listError) throw listError
      const counts: Record<string, number> = {}
      for (const capture of captures || []) counts[capture.status] = (counts[capture.status] || 0) + 1
      return json({ ok: true, scope: mineOnly ? 'current_user' : (isAdmin ? 'organization_admin' : 'current_user'), counts, captures: captures || [] })
    }

    return json({ error: 'unknown_action' }, 400)
  } catch (error) {
    console.error('provider-sale-capture', error)
    return json({
      error: 'provider_sale_capture_failed',
      detail: String((error as Error)?.message || error).slice(0, 240),
    }, 500)
  }
})
