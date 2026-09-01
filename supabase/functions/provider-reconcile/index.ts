import { serveWithOrganizationAccess } from '../_shared/organization-paywall.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.95.0'
import { corsHeaders } from 'npm:@supabase/supabase-js@2.95.0/cors'
import { isCancelledProviderStatus } from '../_shared/accounting-records.mjs'
import { normalizeSaleProvider } from '../_shared/provider-sale-capture-core.mjs'
import { isImmediateProcessedSaleRankingEligible } from '../_shared/sale-ranking-policy.mjs'
import {
  classifySaleEvidence,
  crossReferenceRepRow,
  isAbandonedProviderStatus,
  isBassReportDefinitionXml,
  mapReportEvidence,
  normalizeEvidenceToken,
  parseDelimitedReport,
  parseHtmlTableReport,
  pickReportValue,
  safeReportPayload
} from '../_shared/provider-report-core.mjs'

const json = (body: unknown, status = 200) => Response.json(body, {
  status,
  headers: { ...corsHeaders, 'Cache-Control': 'no-store' }
})

function reportDate(value: unknown) {
  const text = String(value ?? '').trim()
  if (!text) return null
  const parsed = new Date(text)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

function inputDate(value: unknown) {
  const text = String(value ?? '').trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null
}

async function sha256(text: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('')
}

function outsideSystem(sale: any) {
  const snapshot = sale?.compensation_snapshot || {}
  return snapshot.sale_origin === 'outside_system' || snapshot.sale_context === 'out_of_area_phone'
}

function approvalAllowsEligibility(sale: any) {
  if (!outsideSystem(sale)) return true
  return String(sale?.compensation_snapshot?.admin_approval?.status || '').toLowerCase() === 'approved'
}

async function providerEvidence(admin: any, selectedProvider: string) {
  const { data, error } = await admin
    .from('provider_sales_rows')
    .select('id,provider,order_number,account_number,seller_identifier,seller_name,seller_email,customer_name,service_address,sale_date,provider_status,evidence_scope,source_rep_user_id,source_rep_email,cross_reference_status,created_at')
    .eq('provider', selectedProvider)
    .order('created_at', { ascending: false })
    .limit(5000)
  if (error) throw error
  return (data || []).filter((row: any) => !isAbandonedProviderStatus(row.provider_status))
}

async function reconcile(admin: any, sale: any, cache?: { evidence: Map<string, any[]>, sellers: Map<string, Set<string>> }) {
  const selectedProvider = normalizeSaleProvider(sale.isp)
  if (!selectedProvider) return { status: 'low_potential', reason: 'invalid_provider', row: null }
  if (!normalizeEvidenceToken(sale.provider_order_number) && !normalizeEvidenceToken(sale.provider_account_number)) {
    return { status: 'low_potential', reason: 'missing_order_or_account_number', row: null }
  }
  let rows = cache?.evidence.get(selectedProvider)
  if (!rows) {
    rows = await providerEvidence(admin, selectedProvider)
    cache?.evidence.set(selectedProvider, rows)
  }
  const sellerKey = `${sale.rep_user_id}:${selectedProvider}`
  let sellerIdentifiers = cache?.sellers.get(sellerKey)
  if (!sellerIdentifiers) {
    const { data: links, error: linkError } = await admin
      .from('provider_seller_links')
      .select('seller_identifier')
      .eq('rep_user_id', sale.rep_user_id)
      .eq('provider', selectedProvider)
      .eq('active', true)
    if (linkError) throw linkError
    sellerIdentifiers = new Set((links || []).map((link: any) => normalizeEvidenceToken(link.seller_identifier)).filter(Boolean))
    cache?.sellers.set(sellerKey, sellerIdentifiers)
  }
  return classifySaleEvidence({
    rows,
    repUserId: sale.rep_user_id,
    sellerIdentifiers,
    orderNumber: sale.provider_order_number,
    accountNumber: sale.provider_account_number
  })
}

async function applyReconciliation(admin: any, sale: any, cache?: { evidence: Map<string, any[]>, sellers: Map<string, Set<string>> }) {
  const result = await reconcile(admin, sale, cache)
  const providerStatus = String(result.row?.provider_status || '').trim() || null
  const providerCancelled = result.status === 'verified_processed' && !!result.row && isCancelledProviderStatus(providerStatus)
  const priorSnapshot = sale.compensation_snapshot && typeof sale.compensation_snapshot === 'object' ? sale.compensation_snapshot : {}
  const scheduledReduction = Number(priorSnapshot.base_commission || 0) + Number(priorSnapshot.att_mobile_originating_commission || 0)
  const saleStatus = providerCancelled ? 'cancelled' : sale.sale_status
  const rankingEligible = isImmediateProcessedSaleRankingEligible({ ...sale, sale_status: saleStatus })
    || (result.status === 'verified_processed' && approvalAllowsEligibility(sale))
  const eligible = result.status === 'verified_processed' && approvalAllowsEligibility(sale) && saleStatus !== 'cancelled'
  const patch: Record<string, unknown> = {
    verification_status: result.status,
    verification_reason: result.reason,
    competition_eligible: eligible,
    ranking_eligible: rankingEligible,
    ranking_verified_at: rankingEligible ? (sale.ranking_verified_at || new Date().toISOString()) : null,
    provider_sale_row_id: result.row?.id || null,
    verified_at: result.status === 'verified_processed' ? new Date().toISOString() : null,
    low_potential_since: result.status === 'low_potential' ? (sale.low_potential_since || new Date().toISOString()) : null
  }
  if (providerCancelled) {
    patch.sale_status = 'cancelled'
    patch.compensation_snapshot = {
      ...priorSnapshot,
      cancellation: {
        status: 'cancelled',
        source: 'provider_sales_row',
        provider_status: providerStatus,
        provider_sale_row_id: result.row?.id || null,
        detected_at: priorSnapshot?.cancellation?.detected_at || new Date().toISOString(),
        reduction_amount: Number.isFinite(scheduledReduction) ? scheduledReduction : 0,
        reduction_policy: 'excluded_from_current_earned_pay'
      }
    }
  }
  const { error } = await admin.from('sales_records').update(patch).eq('id', sale.id)
  if (error) throw error
  return result
}

function chunked<T>(values: T[], size = 200) {
  const output: T[][] = []
  for (let index = 0; index < values.length; index += size) output.push(values.slice(index, index + size))
  return output
}

async function crossReferenceDealerImport(admin: any, importRow: any) {
  const { data: dealerRows, error: dealerError } = await admin
    .from('provider_sales_rows')
    .select('id,provider,order_number,account_number,seller_identifier,seller_name,seller_email,sale_date,provider_status')
    .eq('import_id', importRow.id)
    .eq('evidence_scope', 'dealer_account')
  if (dealerError) throw dealerError

  const eligibleDealerRows = (dealerRows || []).filter((row: any) => !isAbandonedProviderStatus(row.provider_status))
  const providers = [...new Set(eligibleDealerRows.map((row: any) => row.provider).filter(Boolean))] as string[]
  const summary: Record<string, number> = { matched_dealer: 0, missing_from_dealer: 0, conflict: 0, not_assessed: 0 }
  const now = new Date().toISOString()
  for (const selectedProvider of providers) {
    const relevantDealerRows = eligibleDealerRows.filter((row: any) => row.provider === selectedProvider)
    const { data: repRows, error: repError } = await admin
      .from('provider_sales_rows')
      .select('id,provider,order_number,account_number,seller_identifier,seller_name,seller_email,sale_date,provider_status,cross_reference_status')
      .eq('provider', selectedProvider)
      .eq('evidence_scope', 'rep_account')
      .order('created_at', { ascending: false })
      .limit(10000)
    if (repError) throw repError

    const grouped = new Map<string, string[]>()
    for (const repRow of (repRows || []).filter((row: any) => !isAbandonedProviderStatus(row.provider_status))) {
      const result = crossReferenceRepRow(repRow, relevantDealerRows, importRow.report_period_start, importRow.report_period_end)
      if (!['matched_dealer', 'missing_from_dealer', 'conflict'].includes(result.status)) {
        summary.not_assessed++
        continue
      }
      summary[result.status]++
      const key = `${result.status}:${result.dealerRowId || ''}`
      grouped.set(key, [...(grouped.get(key) || []), repRow.id])
    }
    for (const [key, ids] of grouped) {
      const separator = key.indexOf(':')
      const status = key.slice(0, separator)
      const dealerRowId = key.slice(separator + 1) || null
      for (const idChunk of chunked(ids)) {
        const { error } = await admin.from('provider_sales_rows').update({
          cross_reference_status: status,
          cross_referenced_row_id: dealerRowId,
          cross_referenced_at: now
        }).in('id', idChunk)
        if (error) throw error
      }
    }
  }
  const { error: summaryError } = await admin.from('provider_sales_imports').update({
    cross_reference_summary: summary,
    last_cross_referenced_at: now
  }).eq('id', importRow.id)
  if (summaryError) throw summaryError
  return summary
}

async function reconcileSalesForImport(admin: any, sourceScope: string, sourceRepUserId: string | null, providers: string[]) {
  if (!providers.length) return { total: 0, verified: 0 }
  let query = admin.from('sales_records').select('*').order('created_at', { ascending: false }).limit(5000)
  if (sourceScope === 'rep_account' && sourceRepUserId) query = query.eq('rep_user_id', sourceRepUserId)
  if (providers.length === 1) query = query.eq('isp', providers[0])
  const { data: sales, error } = await query
  if (error) throw error
  const providerSet = new Set(providers)
  const scopedSales = providerSet.size > 1
    ? (sales || []).filter((sale: any) => providerSet.has(normalizeSaleProvider(sale.isp)))
    : (sales || [])
  let verified = 0
  const cache = { evidence: new Map<string, any[]>(), sellers: new Map<string, Set<string>>() }
  for (const sale of scopedSales) {
    const result = await applyReconciliation(admin, sale, cache)
    if (result.status === 'verified_processed') verified++
  }
  return { total: scopedSales.length, verified }
}

async function uploadReport(admin: any, user: any, access: any, body: any) {
  const requestedScope = String(body.source_scope || '').toLowerCase()
  const sourceScope = requestedScope === 'dealer_account' ? 'dealer_account' : 'rep_account'
  if (sourceScope === 'dealer_account' && access.role !== 'admin') return json({ error: 'admin_only' }, 403)
  let corporateProviders = new Set<string>()
  if (sourceScope === 'dealer_account') {
    const { data: corporateAccess, error: corporateAccessError } = await admin
      .from('provider_corporate_access')
      .select('provider')
      .eq('mccoy_user_id', user.id)
      .eq('mccoy_email', user.email.toLowerCase())
      .eq('active', true)
    if (corporateAccessError) throw corporateAccessError
    corporateProviders = new Set((corporateAccess || []).map((row: any) => normalizeSaleProvider(row.provider)).filter(Boolean))
    if (!corporateProviders.size) return json({ error: 'corporate_provider_access_required' }, 403)
  }

  const text = String(body.report_text || body.csv_text || '')
  if (!text.trim()) return json({ error: 'report_required' }, 400)
  if (text.length > 12000000) return json({ error: 'report_too_large' }, 413)
  let reportFormat = 'csv'
  let rows: string[][]
  if (/<table(?:\s|>)/i.test(text)) {
    reportFormat = 'html_table_xls'
    rows = parseHtmlTableReport(text)
  } else if (isBassReportDefinitionXml(text)) {
    return json({
      error: 'bass_report_definition_no_orders',
      detail: 'This BASS XML only defines report columns and search filters; it contains no order rows. Run the report in BASS and export the result rows as CSV.'
    }, 400)
  } else if (/^\s*</.test(text)) {
    return json({
      error: 'unsupported_xml_order_export',
      detail: 'This XML format does not contain supported BASS order rows. Export the completed BASS report results as Excel (.xls) or CSV.'
    }, 400)
  } else rows = parseDelimitedReport(text)
  if (rows.length < 2) return json({ error: 'report_has_no_data' }, 400)

  const selectedProvider = body.provider ? normalizeSaleProvider(body.provider) : null
  if (sourceScope === 'rep_account' && !selectedProvider) return json({ error: 'provider_required_for_rep_report' }, 400)
  const periodStart = inputDate(body.report_period_start)
  const periodEnd = inputDate(body.report_period_end)
  if (!!periodStart !== !!periodEnd) return json({ error: 'complete_report_period_required' }, 400)
  if (periodStart && periodEnd && periodStart > periodEnd) return json({ error: 'invalid_report_period' }, 400)

  const headers = rows[0].map(value => value.replace(/^\uFEFF/, ''))
  const normalizedRows = rows.slice(1).map(values => {
    const raw: Record<string, unknown> = {}
    headers.forEach((header, column) => { raw[header] = values[column] ?? '' })
    const detectedProvider = normalizeSaleProvider(pickReportValue(raw, ['provider', 'carrier', 'isp', 'brand', 'product provider']))
    return { raw, rowProvider: selectedProvider || detectedProvider, evidence: mapReportEvidence(raw) }
  })
  const recognizedOrderRows = normalizedRows.filter(row => row.evidence.orderNumber || row.evidence.accountNumber)
  if (!recognizedOrderRows.length) {
    return json({
      error: 'report_has_no_recognized_orders',
      detail: 'No order or account identifiers were found. For BASS, run All Orders and export result rows containing Order # or BASS Order ID.'
    }, 400)
  }
  const abandonedExcluded = recognizedOrderRows.filter(row => isAbandonedProviderStatus(row.evidence.providerStatus)).length
  const orderRows = recognizedOrderRows.filter(row => !isAbandonedProviderStatus(row.evidence.providerStatus))
  if (recognizedOrderRows.some(row => !row.rowProvider)) {
    return json({
      error: 'provider_not_detected',
      detail: 'The report has no provider column. Select its ISP instead of Mixed / Auto-detect and import it again.'
    }, 400)
  }
  if (sourceScope === 'dealer_account') {
    const unauthorizedProviders = [...new Set(recognizedOrderRows.map(row => row.rowProvider).filter(provider => !corporateProviders.has(provider)))]
    if (unauthorizedProviders.length) return json({ error: 'corporate_provider_not_authorized', providers: unauthorizedProviders }, 403)
  }

  const fileHash = await sha256(text)
  let duplicateQuery = admin.from('provider_sales_imports').select('id,created_at,mapped_row_count').eq('source_scope', sourceScope).eq('file_sha256', fileHash)
  duplicateQuery = selectedProvider ? duplicateQuery.eq('source_provider', selectedProvider) : duplicateQuery.is('source_provider', null)
  duplicateQuery = sourceScope === 'rep_account' ? duplicateQuery.eq('source_rep_user_id', user.id) : duplicateQuery.is('source_rep_user_id', null)
  const { data: duplicate, error: duplicateError } = await duplicateQuery.maybeSingle()
  if (duplicateError) throw duplicateError
  if (duplicate) return json({ ok: true, duplicate: true, import_id: duplicate.id, mapped: duplicate.mapped_row_count, rows: rows.length - 1, abandoned_excluded: abandonedExcluded })

  const sourceRepUserId = sourceScope === 'rep_account' ? user.id : null
  const sourceRepEmail = sourceScope === 'rep_account' ? user.email.toLowerCase() : null
  const { data: importRow, error: importError } = await admin.from('provider_sales_imports').insert({
    imported_by: user.id,
    imported_by_email: user.email,
    source_filename: String(body.filename || 'provider-sales.csv').slice(0, 255),
    source_provider: selectedProvider,
    source_scope: sourceScope,
    source_rep_user_id: sourceRepUserId,
    source_rep_email: sourceRepEmail,
    report_period_start: periodStart,
    report_period_end: periodEnd,
    file_sha256: fileHash,
    row_count: rows.length - 1
  }).select('id,source_scope,source_provider,source_rep_user_id,report_period_start,report_period_end').single()
  if (importError) throw importError

  const mapped = orderRows.length
  const importedProviders = new Set<string>()
  try {
    for (let index = 0; index < orderRows.length; index += 250) {
      const chunk = orderRows.slice(index, index + 250).map(({ raw, rowProvider, evidence }) => {
        if (rowProvider) importedProviders.add(rowProvider)
        return {
          import_id: importRow.id,
          provider: rowProvider,
          order_number: evidence.orderNumber,
          account_number: evidence.accountNumber,
          seller_identifier: evidence.sellerIdentifier,
          seller_name: evidence.sellerName,
          seller_email: evidence.sellerEmail?.toLowerCase() || null,
          customer_name: evidence.customerName,
          service_address: evidence.serviceAddress,
          sale_date: reportDate(evidence.saleDate),
          provider_status: evidence.providerStatus,
          evidence_scope: sourceScope,
          source_rep_user_id: sourceRepUserId,
          source_rep_email: sourceRepEmail,
          cross_reference_status: sourceScope === 'dealer_account' ? 'authoritative' : 'pending_dealer',
          raw_payload: safeReportPayload(raw)
        }
      })
      const { error } = await admin.from('provider_sales_rows').insert(chunk)
      if (error) throw error
    }
  } catch (error) {
    await admin.from('provider_sales_imports').delete().eq('id', importRow.id)
    throw error
  }

  const { error: importUpdateError } = await admin.from('provider_sales_imports').update({
    mapped_row_count: mapped,
    notes: `${mapped} rows contained an order or account identifier and were imported. ${abandonedExcluded} ABANDONED rows were excluded.`
  }).eq('id', importRow.id)
  if (importUpdateError) throw importUpdateError

  let crossReference = null
  if (sourceScope === 'dealer_account') crossReference = await crossReferenceDealerImport(admin, importRow)
  const salesResult = await reconcileSalesForImport(admin, sourceScope, sourceRepUserId, [...importedProviders])
  return json({
    ok: true,
    import_id: importRow.id,
    source_scope: sourceScope,
    rows: rows.length - 1,
    mapped,
    abandoned_excluded: abandonedExcluded,
    verified_after_import: salesResult.verified,
    sales_checked: salesResult.total,
    cross_reference: crossReference,
    report_format: reportFormat,
    headers
  })
}

serveWithOrganizationAccess('provider_integrations',async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const jwt = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/, '')
    if (!jwt) return json({ error: 'unauthorized' }, 401)
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false }
    })
    const { data: { user }, error: userError } = await admin.auth.getUser(jwt)
    if (userError || !user?.email) return json({ error: 'unauthorized' }, 401)
    const { data: access, error: accessError } = await admin.from('app_user_access').select('role,active').eq('email', user.email.toLowerCase()).maybeSingle()
    if (accessError) throw accessError
    if (!access?.active) return json({ error: 'forbidden' }, 403)
    const body = await request.json().catch(() => ({}))
    const action = String(body.action || (access.role === 'admin' ? 'overview' : 'my_overview'))

    if (action === 'upload_report' || action === 'upload_csv') return await uploadReport(admin, user, access, body)

    if (action === 'link_seller') {
      if (access.role !== 'admin') return json({ error: 'admin_only' }, 403)
      const repEmail = String(body.rep_email || '').trim().toLowerCase()
      const selectedProvider = normalizeSaleProvider(body.provider)
      const sellerIdentifier = String(body.seller_identifier || '').trim()
      if (!repEmail || !selectedProvider || !sellerIdentifier) return json({ error: 'rep_provider_seller_required' }, 400)
      const { data: authUsers } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
      const rep = authUsers?.users?.find((candidate: any) => String(candidate.email || '').toLowerCase() === repEmail)
      if (!rep) return json({ error: 'rep_not_found' }, 404)
      const { error } = await admin.from('provider_seller_links').upsert({
        rep_user_id: rep.id,
        rep_email: repEmail,
        provider: selectedProvider,
        seller_identifier: sellerIdentifier,
        seller_name: body.seller_name || null,
        active: true
      }, { onConflict: 'rep_user_id,provider,seller_identifier' })
      if (error) throw error
      return json({ ok: true })
    }

    if (action === 'assign_unmatched_seller') {
      if (access.role !== 'admin') return json({ error: 'admin_only' }, 403)
      const selectedProvider = normalizeSaleProvider(body.provider)
      const sellerIdentifier = String(body.seller_identifier || '').trim()
      const sellerName = String(body.seller_name || '').trim() || null
      const repUserId = String(body.rep_user_id || '').trim()
      if (!selectedProvider || !sellerIdentifier || !repUserId) return json({ error: 'provider_seller_rep_required' }, 400)

      const { data: targetAuth, error: targetAuthError } = await admin.auth.admin.getUserById(repUserId)
      if (targetAuthError || !targetAuth?.user?.email) return json({ error: 'rep_not_found' }, 404)
      const repEmail = targetAuth.user.email.toLowerCase()
      const { data: targetAccess, error: targetAccessError } = await admin
        .from('app_user_access').select('display_name,active').eq('email', repEmail).maybeSingle()
      if (targetAccessError) throw targetAccessError
      if (!targetAccess?.active) return json({ error: 'active_rep_required' }, 400)
      const repName = String(targetAccess.display_name || repEmail)

      const { data: activeLinks, error: activeLinksError } = await admin
        .from('provider_seller_links').select('id,rep_user_id,seller_identifier,seller_name')
        .eq('provider', selectedProvider).eq('active', true)
      if (activeLinksError) throw activeLinksError
      const identityKeys = new Set([normalizeEvidenceToken(sellerIdentifier), normalizeEvidenceToken(sellerName)].filter(Boolean))
      const conflictingLinkIds = (activeLinks || []).filter((link: any) =>
        String(link.rep_user_id) !== repUserId
        && [link.seller_identifier, link.seller_name].some(value => identityKeys.has(normalizeEvidenceToken(value)))
      ).map((link: any) => link.id)
      if (conflictingLinkIds.length) {
        const { error } = await admin.from('provider_seller_links').update({ active: false }).in('id', conflictingLinkIds)
        if (error) throw error
      }

      const { error: linkError } = await admin.from('provider_seller_links').upsert({
        rep_user_id: repUserId, rep_email: repEmail, provider: selectedProvider,
        seller_identifier: sellerIdentifier, seller_name: sellerName, active: true
      }, { onConflict: 'rep_user_id,provider,seller_identifier' })
      if (linkError) throw linkError

      const { data: candidates, error: candidateError } = await admin
        .from('provider_sales_rows')
        .select('id,seller_identifier,seller_name,materialized_sale_id,materialization_status')
        .eq('provider', selectedProvider)
        .in('materialization_status', ['unmatched_seller', 'seller_mismatch_review'])
        .limit(10000)
      if (candidateError) throw candidateError
      const matching = (candidates || []).filter((row: any) =>
        [row.seller_identifier, row.seller_name].some(value => identityKeys.has(normalizeEvidenceToken(value)))
      )
      const retryIds = matching.filter((row: any) => row.materialization_status === 'unmatched_seller').map((row: any) => row.id)
      for (const ids of chunked(retryIds)) {
        const { error } = await admin.from('provider_sales_rows').update({
          materialization_reason: 'Admin assigned unmatched provider seller identity; reprocessing historical evidence.'
        }).in('id', ids)
        if (error) throw error
      }
      const { data: refreshed, error: refreshedError } = retryIds.length
        ? await admin.from('provider_sales_rows').select('id,materialized_sale_id,materialization_status').in('id', retryIds)
        : { data: [], error: null }
      if (refreshedError) throw refreshedError
      const materialized = (refreshed || []).filter((row: any) => row.materialized_sale_id).length
      const conflicts = matching.filter((row: any) => row.materialization_status === 'seller_mismatch_review').length

      const { error: auditError } = await admin.from('provider_seller_assignment_history').insert({
        provider: selectedProvider, seller_identifier: sellerIdentifier, seller_name: sellerName,
        affected_row_count: matching.length, rep_user_id: repUserId, rep_email: repEmail, rep_name: repName,
        assigned_by_user_id: user.id, assigned_by_email: user.email.toLowerCase()
      })
      if (auditError) throw auditError
      return json({ ok: true, affected: matching.length, retried: retryIds.length, materialized, conflicts })
    }

    if (action === 'reconcile_all') {
      if (access.role !== 'admin') return json({ error: 'admin_only' }, 403)
      const { data: sales, error } = await admin.from('sales_records').select('*').order('created_at', { ascending: false }).limit(5000)
      if (error) throw error
      const counts: Record<string, number> = { verified_processed: 0, low_potential: 0, pending_verification: 0, mismatch: 0 }
      const cache = { evidence: new Map<string, any[]>(), sellers: new Map<string, Set<string>>() }
      for (const sale of sales || []) {
        const result = await applyReconciliation(admin, sale, cache)
        counts[result.status] = (counts[result.status] || 0) + 1
      }
      return json({ ok: true, counts, total: (sales || []).length })
    }

    if (action === 'cross_reference_all') {
      if (access.role !== 'admin') return json({ error: 'admin_only' }, 403)
      const { data: imports, error } = await admin
        .from('provider_sales_imports')
        .select('id,source_provider,report_period_start,report_period_end,created_at')
        .eq('source_scope', 'dealer_account')
        .order('created_at', { ascending: true })
        .limit(50)
      if (error) throw error
      const total: Record<string, number> = { matched_dealer: 0, missing_from_dealer: 0, conflict: 0, not_assessed: 0 }
      for (const importRow of imports || []) {
        const summary = await crossReferenceDealerImport(admin, importRow)
        for (const key of Object.keys(total)) total[key] += Number(summary[key] || 0)
      }
      return json({ ok: true, imports_checked: (imports || []).length, cross_reference: total })
    }

    if (action === 'my_overview') {
      const { data: imports, error: importError } = await admin
        .from('provider_sales_imports')
        .select('id,source_filename,source_provider,row_count,mapped_row_count,report_period_start,report_period_end,cross_reference_summary,last_cross_referenced_at,created_at')
        .eq('source_scope', 'rep_account')
        .eq('source_rep_user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(20)
      if (importError) throw importError
      const { data: rows, error: rowError } = await admin
        .from('provider_sales_rows')
        .select('cross_reference_status')
        .eq('evidence_scope', 'rep_account')
        .eq('source_rep_user_id', user.id)
        .limit(5000)
      if (rowError) throw rowError
      const counts: Record<string, number> = {}
      for (const row of rows || []) counts[row.cross_reference_status] = (counts[row.cross_reference_status] || 0) + 1
      return json({ ok: true, imports: imports || [], counts })
    }

    if (action === 'overview') {
      if (access.role !== 'admin') return json({ error: 'admin_only' }, 403)
      const { data: imports } = await admin
        .from('provider_sales_imports')
        .select('id,source_filename,source_provider,source_scope,source_rep_email,row_count,mapped_row_count,report_period_start,report_period_end,cross_reference_summary,last_cross_referenced_at,created_at')
        .order('created_at', { ascending: false })
        .limit(30)
      const { data: sales } = await admin
        .from('sales_records')
        .select('id,created_at,rep_name,rep_email,isp,service_address,provider_order_number,provider_account_number,verification_status,verification_reason,competition_eligible')
        .order('created_at', { ascending: false })
        .limit(500)
      const { data: discrepancies } = await admin
        .from('provider_sales_rows')
        .select('id,provider,order_number,account_number,seller_identifier,source_rep_email,sale_date,cross_reference_status,cross_referenced_at')
        .eq('evidence_scope', 'rep_account')
        .in('cross_reference_status', ['missing_from_dealer', 'conflict'])
        .order('cross_referenced_at', { ascending: false })
        .limit(200)
      const { data: unmatchedRows } = await admin
        .from('provider_sales_rows')
        .select('provider,seller_identifier,seller_name,provider_status,materialization_status')
        .in('materialization_status', ['unmatched_seller', 'seller_mismatch_review'])
        .order('created_at', { ascending: false })
        .limit(10000)
      const unmatchedMap = new Map<string, any>()
      for (const row of unmatchedRows || []) {
        if (isAbandonedProviderStatus(row.provider_status)) continue
        const identifier = String(row.seller_identifier || row.seller_name || '').trim()
        if (!identifier) continue
        const key = `${row.provider}:${normalizeEvidenceToken(identifier)}`
        const current = unmatchedMap.get(key) || { provider: row.provider, seller_identifier: identifier, seller_name: row.seller_name || null, rows: 0, conflicts: 0 }
        current.rows++
        if (row.materialization_status === 'seller_mismatch_review') current.conflicts++
        unmatchedMap.set(key, current)
      }
      const { data: accessUsers } = await admin.from('app_user_access').select('email,display_name,role,active').eq('active', true).order('display_name')
      const { data: authUsers } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
      const authByEmail = new Map((authUsers?.users || []).map((candidate: any) => [String(candidate.email || '').toLowerCase(), candidate.id]))
      const activeUsers = (accessUsers || []).map((candidate: any) => ({
        user_id: authByEmail.get(String(candidate.email || '').toLowerCase()) || null,
        email: candidate.email, display_name: candidate.display_name || candidate.email, role: candidate.role
      })).filter((candidate: any) => candidate.user_id)
      const counts: Record<string, number> = {}
      for (const sale of sales || []) counts[sale.verification_status] = (counts[sale.verification_status] || 0) + 1
      return json({
        ok: true,
        counts,
        imports: imports || [],
        discrepancies: discrepancies || [],
        unmatched_sellers: [...unmatchedMap.values()].sort((a, b) => b.rows - a.rows || String(a.seller_name || a.seller_identifier).localeCompare(String(b.seller_name || b.seller_identifier))),
        active_users: activeUsers,
        low_potential: (sales || []).filter((sale: any) => sale.verification_status === 'low_potential').slice(0, 100),
        recent_sales: (sales || []).slice(0, 50)
      })
    }

    return json({ error: 'unknown_action' }, 400)
  } catch (error) {
    console.error('provider-reconcile', error)
    return json({
      error: 'provider_reconcile_failed',
      detail: String((error as Error)?.message || error).slice(0, 240)
    }, 500)
  }
})
