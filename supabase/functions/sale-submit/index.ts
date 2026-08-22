import { createClient } from 'npm:@supabase/supabase-js@2.95.0'
import { corsHeaders } from 'npm:@supabase/supabase-js@2.95.0/cors'
import { commissionSnapshot, normalizePayLevel } from '../_shared/compensation-calculator.mjs'
import { isUuid, normalizeSaleProvider } from '../_shared/provider-sale-capture-core.mjs'
import { classifySaleEvidence, normalizeEvidenceToken } from '../_shared/provider-report-core.mjs'
import { normalizeVoipHomePhoneAddOn } from '../_shared/sale-products-core.mjs'

const json = (body: unknown, status = 200) => Response.json(body, {
  status,
  headers: { ...corsHeaders, 'Cache-Control': 'no-store' }
})

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const jwt = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/, '')
    if (!jwt) return json({ error: 'unauthorized' }, 401)
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data: { user }, error: userError } = await admin.auth.getUser(jwt)
    if (userError || !user?.email) return json({ error: 'unauthorized' }, 401)
    const repEmail = user.email.toLowerCase()
    const { data: access, error: accessError } = await admin.from('app_user_access').select('role,active,display_name,sales_classification,team_name,assigned_manager_name,assigned_manager_email').eq('email', repEmail).maybeSingle()
    if (accessError) throw accessError
    if (!access?.active) return json({ error: 'forbidden' }, 403)

    const body = await request.json()
    for (const key of ['customer_first_name', 'customer_last_name', 'service_address', 'isp']) {
      if (!String(body[key] || '').trim()) return json({ error: `${key}_required` }, 400)
    }
    const isp = normalizeSaleProvider(body.isp)
    if (!isp) return json({ error: 'invalid_provider' }, 400)

    let providerCapture: any = null
    let captureId = String(body.provider_capture_id || '').trim()
    const captureClientRequestId = String(body.provider_capture_client_request_id || '').trim()
    if (!captureId && isUuid(captureClientRequestId)) {
      const { data: existingCapture, error: existingCaptureError } = await admin.from('provider_sale_captures').select('id,provider,sale_context,status').eq('rep_user_id', user.id).eq('client_request_id', captureClientRequestId).maybeSingle()
      if (existingCaptureError) throw existingCaptureError
      if (existingCapture) { providerCapture = existingCapture; captureId = existingCapture.id }
      else {
        const fallbackRow = {
          client_request_id: captureClientRequestId, rep_user_id: user.id, rep_email: repEmail, rep_name: access.display_name || user.email,
          provider: isp, sale_context: body.sale_context === 'out_of_area_phone' ? 'out_of_area_phone' : 'field', session_id: isUuid(body.session_id) ? body.session_id : null,
          lead_label: String(body.lead_label || '').trim().slice(0, 500) || null, service_address: String(body.service_address).trim().slice(0, 500),
          seller_portal_label: null, portal_opened: false, portal_open_reason: 'sale_submit_fallback', status: 'details_required', metadata: { capture_version: 1, fallback: true }
        }
        const { data: insertedCapture, error: insertedCaptureError } = await admin.from('provider_sale_captures').insert(fallbackRow).select('id,provider,sale_context,status').maybeSingle()
        if (insertedCaptureError && insertedCaptureError.code !== '23505') throw insertedCaptureError
        if (insertedCapture) { providerCapture = insertedCapture; captureId = insertedCapture.id }
        else {
          const { data: racedCapture, error: racedCaptureError } = await admin.from('provider_sale_captures').select('id,provider,sale_context,status').eq('rep_user_id', user.id).eq('client_request_id', captureClientRequestId).maybeSingle()
          if (racedCaptureError) throw racedCaptureError
          if (racedCapture) { providerCapture = racedCapture; captureId = racedCapture.id }
        }
      }
    }
    if (captureId) {
      if (!isUuid(captureId)) return json({ error: 'invalid_provider_capture' }, 400)
      let capture = providerCapture
      if (!capture) {
        const { data, error: captureError } = await admin.from('provider_sale_captures').select('id,provider,sale_context,status').eq('id', captureId).eq('rep_user_id', user.id).maybeSingle()
        if (captureError) throw captureError
        capture = data
      }
      if (!capture) return json({ error: 'provider_capture_not_found' }, 400)
      if (capture.provider !== isp) return json({ error: 'provider_capture_mismatch' }, 400)
      if (capture.status === 'cancelled') return json({ error: 'provider_capture_cancelled' }, 409)
      providerCapture = capture
      const { data: prior, error: priorError } = await admin.from('sales_records').select('id,compensation_snapshot,verification_status,verification_reason,competition_eligible').eq('provider_capture_id', capture.id).eq('rep_user_id', user.id).maybeSingle()
      if (priorError) throw priorError
      if (prior) return json({ ok: true, duplicate: true, sale_id: prior.id, compensation_snapshot: prior.compensation_snapshot, verification: { status: prior.verification_status, reason: prior.verification_reason, competition_eligible: prior.competition_eligible } })
    }

    const saleContext = providerCapture?.sale_context === 'out_of_area_phone' || body.sale_context === 'out_of_area_phone' ? 'out_of_area_phone' : 'field'
    const outsideSystem = saleContext === 'out_of_area_phone'
    const saleOrigin = outsideSystem ? 'outside_system' : 'mccoy_app'
    const adminApproval = { required: outsideSystem, status: outsideSystem ? 'pending' : 'not_required', reviewed_by: null, reviewed_at: null, notes: null }

    let safeSessionId: string | null = null
    const sessionCandidate = String(body.session_id || '')
    if (isUuid(sessionCandidate)) {
      const { data: session } = await admin.from('test_sessions').select('id').eq('id', sessionCandidate).maybeSingle()
      if (session?.id) safeSessionId = session.id
    }

    const classification = normalizePayLevel(access.sales_classification)
    const { data: compensationRule } = await admin.from('compensation_rules').select('rule').eq('active', true).limit(1).maybeSingle()
    const rule: any = compensationRule?.rule || {}
    const product = String(body.internet_product || '')
    const allowedSpeeds = new Set([1000, 2000, 3000, 5000, 8000, 10000])
    const requestedSpeed = Math.max(0, Math.round(Number(body.internet_speed_mbps || 0)))
    const speed = product === 'None' ? 0 : requestedSpeed
    if (product !== 'None' && !allowedSpeeds.has(speed)) return json({ error: 'invalid_internet_speed', allowed_mbps: [...allowedSpeeds] }, 400)
    const installDate = String(body.install_date || '').trim()
    const installDateValue = new Date(`${installDate}T00:00:00Z`)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(installDate) || Number.isNaN(installDateValue.getTime()) || installDateValue.toISOString().slice(0, 10) !== installDate) return json({ error: 'valid_install_date_required' }, 400)

    const directv = !!body.directv
    const directvService = directv ? (String(body.directv_service || '').trim().slice(0, 120) || null) : null
    const vivint = !!body.vivint
    const vivintService = vivint ? (String(body.vivint_service || '').trim().slice(0, 120) || null) : null
    const mobileLines = Math.max(0, Math.min(20, Math.round(Number(body.mobile_phone_lines ?? body.att_mobile_lines ?? 0))))
    const mobileDeviceCount = Math.max(0, Math.min(20, Math.round(Number(body.mobile_device_count ?? body.att_device_count ?? 0))))
    const mobileDeviceProtection = !!(body.mobile_device_protection ?? body.att_device_protection)
    const voipLines = normalizeVoipHomePhoneAddOn(body.voip_home_phone_add_on ?? body.voip_home_phone_lines, product)
    const attTotalHomeCare = isp === 'AT&T' && !!body.att_total_home_care
    const calculatedCommission = commissionSnapshot(rule, { isp, internet_product: product, internet_speed_mbps: speed, mobile_phone_lines: mobileLines }, classification)

    const { data: globalSettings } = await admin.from('compensation_admin_settings').select('manager_overrides_enabled').eq('singleton', true).maybeSingle()
    const managerName = access.assigned_manager_name || null
    const managerEmail = access.assigned_manager_email || null
    let managerEnabled = true
    let repEnabled = true
    if (managerName || managerEmail) {
      let managerQuery = admin.from('manager_override_controls').select('overrides_enabled')
      managerQuery = managerEmail ? managerQuery.eq('manager_email', String(managerEmail).toLowerCase()) : managerQuery.eq('manager_name', managerName)
      const { data: managerControl } = await managerQuery.maybeSingle()
      if (managerControl) managerEnabled = !!managerControl.overrides_enabled
    }
    const { data: repControl } = await admin.from('rep_override_controls').select('overrides_enabled').eq('rep_email', repEmail).maybeSingle()
    if (repControl) repEnabled = !!repControl.overrides_enabled
    const globalEnabled = globalSettings?.manager_overrides_enabled ?? true
    const snapshot = {
      classification: calculatedCommission.pay_level, pay_level: calculatedCommission.pay_level, pay_level_label: calculatedCommission.pay_level_label,
      sale_context: saleContext, sale_origin: saleOrigin, provider_capture_id: providerCapture?.id || null, admin_approval: adminApproval,
      base_commission: calculatedCommission.base_commission, att_mobile_originating_commission: calculatedCommission.att_mobile_originating_commission,
      mobile_phone_lines: mobileLines, mobile_device_count: mobileDeviceCount, mobile_device_protection: mobileDeviceProtection,
      voip_home_phone_lines: voipLines, att_device_count: mobileDeviceCount, att_device_protection: mobileDeviceProtection, att_total_home_care: attTotalHomeCare,
      directv_compensation: rule?.directv_compensation ?? 'not_configured', vivint_compensation: rule?.vivint_compensation ?? 'not_configured',
      weekly_production_pay_increase: rule?.weekly_production_pay_increase || [],
      manager_override: { assigned_manager_name: managerName, assigned_manager_email: managerEmail, global_enabled: globalEnabled, manager_enabled: managerEnabled, rep_enabled: repEnabled, effective_enabled: !!((managerName || managerEmail) && globalEnabled && managerEnabled && repEnabled), amount_per_sale: Number(rule?.manager_override?.amount_per_sale || 25) },
      source: rule?.source || null
    }

    const orderNumber = String(body.provider_order_number || '').trim() || null
    const accountNumber = String(body.provider_account_number || '').trim() || null
    let verificationStatus = 'low_potential'
    let verificationReason = body.low_potential_reason ? String(body.low_potential_reason) : (!orderNumber && !accountNumber ? 'missing_order_or_account_number' : 'not_yet_in_dealer_file')
    let providerRow: any = null
    if (orderNumber || accountNumber) {
      const { data: providerRows, error: providerRowsError } = await admin
        .from('provider_sales_rows')
        .select('id,provider,order_number,account_number,seller_identifier,seller_name,seller_email,provider_status,evidence_scope,source_rep_user_id,created_at')
        .eq('provider', isp)
        .order('created_at', { ascending: false })
        .limit(5000)
      if (providerRowsError) throw providerRowsError
      const { data: sellerLinks, error: sellerLinksError } = await admin.from('provider_seller_links').select('seller_identifier').eq('rep_user_id', user.id).eq('provider', isp).eq('active', true)
      if (sellerLinksError) throw sellerLinksError
      const evidence = classifySaleEvidence({
        rows: providerRows || [],
        repUserId: user.id,
        sellerIdentifiers: new Set((sellerLinks || []).map((row: any) => normalizeEvidenceToken(row.seller_identifier)).filter(Boolean)),
        orderNumber,
        accountNumber
      })
      verificationStatus = evidence.status
      verificationReason = evidence.status === 'low_potential' && body.low_potential_reason
        ? String(body.low_potential_reason)
        : evidence.reason
      providerRow = evidence.row
    }

    const competitionEligible = verificationStatus === 'verified_processed' && !outsideSystem
    const saleRow = {
      rep_user_id: user.id, rep_email: user.email, rep_name: access.display_name || user.email, session_id: safeSessionId,
      lead_label: body.lead_label || null, provider_capture_id: providerCapture?.id || null,
      customer_first_name: String(body.customer_first_name).trim(), customer_last_name: String(body.customer_last_name).trim(),
      customer_phone: body.customer_phone || null, customer_email: body.customer_email || null, service_address: String(body.service_address).trim(),
      isp, internet_product: body.internet_product || null, internet_speed_mbps: speed > 0 ? speed : null, install_date: installDate,
      directv, directv_service: directvService, mobile_phone_lines: mobileLines, mobile_device_count: mobileDeviceCount,
      mobile_device_protection: mobileDeviceProtection, att_mobile_lines: mobileLines, vivint, vivint_service: vivintService,
      voip_home_phone_lines: voipLines, att_device_count: mobileDeviceCount, att_device_protection: mobileDeviceProtection,
      att_total_home_care: attTotalHomeCare, notes: body.notes || null, compensation_snapshot: snapshot,
      provider_order_number: orderNumber, provider_account_number: accountNumber, verification_status: verificationStatus,
      verification_reason: verificationReason, provider_sale_row_id: providerRow?.id || null, competition_eligible: competitionEligible,
      verified_at: verificationStatus === 'verified_processed' ? new Date().toISOString() : null,
      low_potential_since: verificationStatus === 'low_potential' ? new Date().toISOString() : null
    }
    const { data: sale, error: saleError } = await admin.from('sales_records').insert(saleRow).select('id,created_at').single()
    if (saleError) throw saleError

    const products: string[] = []
    if (saleContext === 'out_of_area_phone') products.push('OUT OF AREA phone sale')
    if (product && product !== 'None') products.push(`${product}${speed ? ` ${speed / 1000} Gig` : ''}`)
    if (voipLines) products.push(`${isp} VoIP home phone add-on`)
    if (mobileLines) products.push(`${mobileLines} AT&T mobile phone line${mobileLines === 1 ? '' : 's'}`)
    if (mobileDeviceCount) products.push(`${mobileDeviceCount} AT&T mobile device${mobileDeviceCount === 1 ? '' : 's'}`)
    if (mobileDeviceProtection) products.push('AT&T Device Protection')
    if (attTotalHomeCare) products.push('Total Home Care')
    if (directv) products.push(`DIRECTV${directvService ? ` — ${directvService}` : ''}`)
    if (vivint) products.push(`Vivint${vivintService ? ` — ${vivintService}` : ''}`)
    const message = `🎉 ${access.display_name || user.email} closed ${isp}${products.length ? ` — ${products.join(' + ')}` : ''}!`
    const { error: feedError } = await admin.from('sales_feed').insert({ sale_id: sale.id, rep_user_id: user.id, rep_name: access.display_name || user.email, isp, internet_product: body.internet_product || null, directv, mobile_phone_lines: mobileLines, mobile_device_count: mobileDeviceCount, att_mobile_lines: mobileLines, vivint, message })
    if (feedError) { await admin.from('sales_records').delete().eq('id', sale.id); throw feedError }

    if (providerCapture?.id) {
      const { error: captureUpdateError } = await admin.from('provider_sale_captures').update({ status: 'recorded', updated_at: new Date().toISOString() }).eq('id', providerCapture.id).eq('rep_user_id', user.id)
      if (captureUpdateError) console.error('provider capture status update failed', captureUpdateError)
    }
    return json({ ok: true, sale_id: sale.id, provider_capture_id: providerCapture?.id || null, message, compensation_snapshot: snapshot, verification: { status: verificationStatus, reason: verificationReason, competition_eligible: competitionEligible, requires_admin_approval: outsideSystem, admin_approval_status: adminApproval.status } })
  } catch (error) {
    console.error('sale-submit', error)
    return json({ error: 'sale_submit_failed', detail: String((error as Error)?.message || error).slice(0, 180) }, 500)
  }
})
