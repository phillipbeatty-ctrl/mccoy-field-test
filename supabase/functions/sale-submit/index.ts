import { serveWithOrganizationAccess } from '../_shared/organization-paywall.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.95.0'
import { corsHeaders } from 'npm:@supabase/supabase-js@2.95.0/cors'
import { normalizePayLevel, payLevelLabel } from '../_shared/compensation-calculator.mjs'
import { isTesterPkbIdentity, isUuid, normalizeSaleOutcome, normalizeSaleProvider } from '../_shared/provider-sale-capture-core.mjs'
import { saleDistanceAudit } from '../_shared/sale-location-core.mjs'

const json = (body: unknown, status = 200) => Response.json(body, {
  status,
  headers: { ...corsHeaders, 'Cache-Control': 'no-store' },
})

const captureSelection = 'id,provider,sale_context,status,session_id,lead_id,source_door_visit_id,lead_label,service_address,portal_opened,portal_open_reason,rep_outcome,metadata,organization_id'

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

    const repEmail = user.email.toLowerCase()
    const { data: access, error: accessError } = await admin
      .from('app_user_access')
      .select('role,active,display_name,sales_classification,team_name,assigned_manager_name,assigned_manager_email,organization_id')
      .eq('email', repEmail)
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
    if (normalizeSaleOutcome(body.sale_outcome) !== 'completed') {
      return json({ error: 'completed_sale_outcome_required' }, 400)
    }

    const captureId = String(body.provider_capture_id || '').trim()
    if (!isUuid(captureId)) return json({ error: 'valid_provider_capture_required' }, 400)

    const testerSimulationRequested = body.tester_simulation === true
    const testerSimulation = testerSimulationRequested && isTesterPkbIdentity(repEmail, access.display_name)
    if (testerSimulationRequested && !testerSimulation) return json({ error: 'tester_simulation_forbidden' }, 403)
    const repDisplayName = testerSimulation ? 'Ghost' : (access.display_name || user.email)

    const { data: capture, error: captureError } = await admin
      .from('provider_sale_captures')
      .select(captureSelection)
      .eq('id', captureId)
      .eq('organization_id', access.organization_id)
      .eq('rep_user_id', user.id)
      .maybeSingle()
    if (captureError) throw captureError
    if (!capture) return json({ error: 'provider_capture_not_found' }, 404)

    const { data: prior, error: priorError } = await admin
      .from('sales_records')
      .select('id,compensation_snapshot,verification_status,verification_reason,competition_eligible,ranking_eligible,distance_lead_id,source_door_visit_id')
      .eq('organization_id', access.organization_id)
      .eq('provider_capture_id', capture.id)
      .eq('rep_user_id', user.id)
      .maybeSingle()
    if (priorError) throw priorError
    if (prior) {
      if (capture.status !== 'recorded') {
        const completedAt = new Date().toISOString()
        await admin.from('provider_sale_captures').update({ status: 'recorded', rep_outcome: 'completed', rep_outcome_at: completedAt, updated_at: completedAt })
          .eq('id', capture.id).eq('organization_id', access.organization_id).eq('rep_user_id', user.id)
      }
      return json({
        ok: true,
        duplicate: true,
        sale_id: prior.id,
        provider_capture_id: capture.id,
        lead_id: prior.distance_lead_id,
        source_door_visit_id: prior.source_door_visit_id,
        compensation_snapshot: prior.compensation_snapshot,
        verification: {
          status: prior.verification_status,
          reason: prior.verification_reason,
          competition_eligible: prior.competition_eligible,
          ranking_eligible: prior.ranking_eligible,
          tester_simulation: testerSimulation,
        },
      })
    }

    if (capture.status === 'cancelled' || capture.rep_outcome === 'abandoned') {
      return json({ error: 'provider_capture_abandoned' }, 409)
    }
    if (!['dashboard_opened', 'details_required'].includes(capture.status)) {
      return json({ error: 'provider_capture_not_open' }, 409)
    }

    const isp = normalizeSaleProvider(capture.provider)
    if (!isp) return json({ error: 'invalid_capture_provider' }, 400)
    const saleContext = capture.sale_context === 'out_of_area_phone' ? 'out_of_area_phone' : 'field'
    const outsideSystem = saleContext === 'out_of_area_phone'
    const saleOrigin = outsideSystem ? 'outside_system' : 'mccoy_app'
    const completedAt = new Date().toISOString()

    let safeSessionId: string | null = null
    const sessionCandidate = isUuid(capture.session_id)
      ? String(capture.session_id)
      : (isUuid(body.session_id) ? String(body.session_id) : '')
    if (sessionCandidate) {
      const { data: session, error: sessionError } = await admin
        .from('test_sessions')
        .select('id')
        .eq('id', sessionCandidate)
        .eq('organization_id', access.organization_id)
        .eq('tester_user_id', user.id)
        .maybeSingle()
      if (sessionError) throw sessionError
      if (session?.id) safeSessionId = session.id
    }

    let distanceLeadId: string | null = null
    let matchedLead: any = null
    const authoritativeLeadCandidate = isUuid(capture.lead_id)
      ? String(capture.lead_id)
      : (isUuid(body.lead_id) ? String(body.lead_id) : '')

    if (authoritativeLeadCandidate) {
      const { data: lead, error: leadError } = await admin
        .from('leads')
        .select('id,address1,address2,city,state,zip,latitude,longitude')
        .eq('id', authoritativeLeadCandidate)
        .eq('organization_id', access.organization_id)
        .is('deleted_at', null)
        .maybeSingle()
      if (leadError) throw leadError
      if (lead?.id) {
        distanceLeadId = lead.id
        matchedLead = lead
      }
    }

    // If the phone address exactly matches a live lead, make that pin authoritative
    // even when the client did not explicitly retain the lead ID.
    if (!distanceLeadId && capture.service_address) {
      const { data: exactLeadId, error: exactError } = await admin.rpc('match_lead_by_service_address', {
        p_organization_id: access.organization_id,
        p_service_address: capture.service_address,
      })
      if (exactError) throw exactError
      if (exactLeadId) {
        const { data: lead, error: leadError } = await admin
          .from('leads')
          .select('id,address1,address2,city,state,zip,latitude,longitude')
          .eq('id', exactLeadId)
          .eq('organization_id', access.organization_id)
          .is('deleted_at', null)
          .maybeSingle()
        if (leadError) throw leadError
        if (lead?.id) {
          distanceLeadId = lead.id
          matchedLead = lead
        }
      }
    }

    // Only a field capture may close a visit, and only the exact visit recorded on
    // the capture may be linked. Phone sales are always unlinked by design.
    let sourceDoorVisitId: string | null = null
    if (saleContext === 'field' && isUuid(capture.source_door_visit_id) && safeSessionId) {
      const { data: sourceVisit, error: sourceVisitError } = await admin
        .from('door_visits')
        .select('id,status,session_id')
        .eq('id', String(capture.source_door_visit_id))
        .eq('organization_id', access.organization_id)
        .eq('rep_id', profile.id)
        .eq('session_id', safeSessionId)
        .maybeSingle()
      if (sourceVisitError) throw sourceVisitError
      if (sourceVisit?.status === 'active') sourceDoorVisitId = sourceVisit.id
    }

    const capturePoint = validPoint(capture?.metadata?.customer_map_location)
    const matchedLeadPoint = validPoint(matchedLead)
    const bodyPoint = saleContext === 'field' ? validPoint(body.customer_map_location) : null
    const customerMapLocation = capturePoint || matchedLeadPoint || bodyPoint
    const distanceAudit = saleDistanceAudit(body.rep_location, customerMapLocation)

    const classification = normalizePayLevel(access.sales_classification)
    const adminApproval = {
      required: outsideSystem,
      status: outsideSystem ? 'pending' : 'not_required',
      reviewed_by: null,
      reviewed_at: null,
      notes: null,
    }
    const verificationStatus = testerSimulation ? 'verified_processed' : 'pending_verification'
    const verificationReason = testerSimulation ? 'tester_pkb_simulation_authorized' : 'capture_only_completed_outcome'
    const competitionEligible = testerSimulation
    const snapshot = {
      classification,
      pay_level: classification,
      pay_level_label: payLevelLabel(classification),
      sale_context: saleContext,
      sale_origin: saleOrigin,
      provider_capture_id: capture.id,
      lead_id: distanceLeadId,
      source_door_visit_id: sourceDoorVisitId,
      active_visit_preserved: !sourceDoorVisitId,
      admin_approval: adminApproval,
      capture_only_completion: {
        enabled: true,
        completed_at: completedAt,
        source: 'complete_sale_button',
        customer_details_collected: false,
        provider_order_details_collected: false,
        provider_evidence_status: testerSimulation ? 'authorized_test' : 'pending',
      },
      accounting: {
        status: testerSimulation ? 'authorized_test' : 'pending_provider_evidence',
        commission_calculation_status: 'pending_provider_evidence',
      },
      distance_audit: {
        status: distanceAudit.status,
        distance_meters: distanceAudit.distance_meters,
        accuracy_meters: distanceAudit.accuracy_meters,
        recorded_at: distanceAudit.recorded_at,
        informational_only: true,
      },
      base_commission: null,
      att_mobile_originating_commission: 0,
      mobile_phone_lines: 0,
      mobile_device_count: 0,
      mobile_device_protection: false,
      voip_home_phone_lines: 0,
      att_device_count: 0,
      att_device_protection: false,
      att_total_home_care: false,
      directv_compensation: 'pending_provider_evidence',
      vivint_compensation: 'pending_provider_evidence',
      manager_override: {
        assigned_manager_name: access.assigned_manager_name || null,
        assigned_manager_email: access.assigned_manager_email || null,
        effective_enabled: false,
        reason: 'pending_provider_evidence',
      },
      tester_simulation: testerSimulation
        ? { enabled: true, account: 'Ghost', provider_dashboard_bypassed: true, provider_evidence_claimed: false }
        : { enabled: false },
    }

    const saleRow = {
      organization_id: access.organization_id,
      rep_user_id: user.id,
      rep_email: user.email,
      rep_name: repDisplayName,
      session_id: safeSessionId,
      source_door_visit_id: sourceDoorVisitId,
      lead_label: capture.lead_label || capture.service_address || null,
      provider_capture_id: capture.id,
      customer_first_name: null,
      customer_last_name: null,
      customer_phone: null,
      customer_email: null,
      service_address: capture.service_address || null,
      distance_lead_id: distanceLeadId,
      rep_distance_from_customer_meters: distanceAudit.distance_meters,
      rep_location_accuracy_meters: distanceAudit.accuracy_meters,
      distance_recorded_at: distanceAudit.recorded_at,
      distance_measurement_status: distanceAudit.status,
      isp,
      internet_product: null,
      internet_speed_mbps: null,
      install_date: null,
      order_date: null,
      directv: false,
      directv_service: null,
      mobile_phone_lines: 0,
      mobile_device_count: 0,
      mobile_device_protection: false,
      att_mobile_lines: 0,
      vivint: false,
      vivint_service: null,
      voip_home_phone_lines: 0,
      att_device_count: 0,
      att_device_protection: false,
      att_total_home_care: false,
      notes: null,
      compensation_snapshot: snapshot,
      provider_order_number: null,
      provider_account_number: null,
      verification_status: verificationStatus,
      rep_reported_outcome: 'completed',
      rep_reported_outcome_at: completedAt,
      verification_reason: verificationReason,
      provider_sale_row_id: null,
      competition_eligible: competitionEligible,
      ranking_eligible: true,
      ranking_verified_at: completedAt,
      verified_at: testerSimulation ? completedAt : null,
      low_potential_since: null,
    }

    let { data: sale, error: saleError } = await admin
      .from('sales_records')
      .insert(saleRow)
      .select('id,created_at')
      .single()
    if (saleError?.code === '23505') {
      const { data: raced, error: racedError } = await admin
        .from('sales_records')
        .select('id,created_at')
        .eq('organization_id', access.organization_id)
        .eq('provider_capture_id', capture.id)
        .eq('rep_user_id', user.id)
        .maybeSingle()
      if (racedError) throw racedError
      if (raced) { sale = raced; saleError = null }
    }
    if (saleError || !sale) throw saleError || new Error('sale_insert_failed')

    const { error: captureUpdateError } = await admin
      .from('provider_sale_captures')
      .update({ status: 'recorded', rep_outcome: 'completed', rep_outcome_at: completedAt, updated_at: completedAt })
      .eq('id', capture.id)
      .eq('organization_id', access.organization_id)
      .eq('rep_user_id', user.id)
      .in('status', ['dashboard_opened', 'details_required'])
    if (captureUpdateError) console.error('provider capture status update failed', captureUpdateError)

    const message = testerSimulation
      ? `👻 Ghost recorded a verified ${isp} benchmark simulation.`
      : `🎉 ${repDisplayName} completed a ${isp} sale.`
    return json({
      ok: true,
      sale_id: sale.id,
      provider_capture_id: capture.id,
      lead_id: distanceLeadId,
      source_door_visit_id: sourceDoorVisitId,
      active_visit_preserved: !sourceDoorVisitId,
      message,
      compensation_snapshot: snapshot,
      verification: {
        status: verificationStatus,
        reason: verificationReason,
        competition_eligible: competitionEligible,
        ranking_eligible: true,
        tester_simulation: testerSimulation,
        requires_admin_approval: outsideSystem,
        admin_approval_status: adminApproval.status,
      },
    })
  } catch (error) {
    console.error('sale-submit', error)
    return json({ error: 'sale_submit_failed', detail: String((error as Error)?.message || error).slice(0, 180) }, 500)
  }
})
