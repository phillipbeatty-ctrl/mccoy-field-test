import { createClient } from 'npm:@supabase/supabase-js@2.95.0'
import { corsHeaders } from 'npm:@supabase/supabase-js@2.95.0/cors'
import { isCancelledProviderStatus } from '../_shared/accounting-records.mjs'
import { normalizeSaleProvider } from '../_shared/provider-sale-capture-core.mjs'
import {
  classifySaleEvidence,
  crossReferenceRepRow,
  normalizeEvidenceToken,
  safeReportPayload
} from '../_shared/provider-report-core.mjs'

const json = (body: unknown, status = 200) => Response.json(body, {
  status,
  headers: { ...corsHeaders, 'Cache-Control': 'no-store' }
})

function parseCsv(text: string) {
  const output: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let index = 0; index < text.length; index++) {
    const current = text[index]
    const next = text[index + 1]
    if (current === '"') {
      if (quoted && next === '"') { cell += '"'; index++ } else quoted = !quoted
    } else if (current === ',' && !quoted) {
      row.push(cell); cell = ''
    } else if ((current === '\n' || current === '\r') && !quoted) {
      if (current === '\r' && next === '\n') index++
      row.push(cell); cell = ''
      if (row.some(value => value.trim())) output.push(row)
      row = []
    } else cell += current
  }
  row.push(cell)
  if (row.some(value => value.trim())) output.push(row)
  return output
}

const pick = (object: Record<string, unknown>, keys: string[]) => {
  for (const expected of keys) {
    const key = Object.keys(object).find(candidate => normalizeEvidenceToken(candidate) === normalizeEvidenceToken(expected))
    if (key && String(object[key] ?? '').trim()) return String(object[key]).trim()
  }
  return null
}

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
  return data || []
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
  const eligible = result.status === 'verified_processed' && approvalAllowsEligibility(sale) && saleStatus !== 'cancelled'
  const patch: Record<string, unknown> = {
    verification_status: result.status,
    verification_reason: result.reason,
    competition_eligible: eligible,
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
    .select('id,provider,order_number,account_number,seller_identifier,seller_name,seller_email,sale_date')
    .eq('import_id', importRow.id)
    .eq('evidence_scope', 'dealer_account')
  if (dealerError) throw dealerError

  const providers = [...new Set((dealerRows || []).map((row: any) => row.provider).filter(Boolean))] as string[]
  const summary: Record<string, number> = { matched_dealer: 0, missing_from_dealer: 0, conflict: 0, not_assessed: 0 }
  const now = new Date().toISOString()
  for (const selectedProvider of providers) {
    const relevantDealerRows = (dealerRows || []).filter((row: any) => row.provider === selectedProvider)
    const { data: repRows, error: repError } = await admin
      .from('provider_sales_rows')
      .select('id,provider,order_number,account_number,seller_identifier,seller_name,seller_email,sale_date,cross_reference_status')
      .eq('provider', selectedProvider)
      .eq('evidence_scope', 'rep_account')
      .order('created_at', { ascending: false })
      .limit(10000)
    if (repError) throw repError

    const grouped = new Map<string, string[]>()
    for (const repRow of repRows || []) {
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

  const text = String(body.csv_text || '')
  if (!text.trim()) return json({ error: 'csv_required' }, 400)
  if (text.length > 12000000) return json({ error: 'csv_too_large' }, 413)
  const rows = parseCsv(text)
  if (rows.length < 2) return json({ error: 'csv_has_no_data' }, 400)

  const selectedProvider = body.provider ? normalizeSaleProvider(body.provider) : null
  if (sourceScope === 'rep_account' && !selectedProvider) return json({ error: 'provider_required_for_rep_report' }, 400)
  const periodStart = inputDate(body.report_period_start)
  const periodEnd = inputDate(body.report_period_end)
  if (!!periodStart !== !!periodEnd) return json({ error: 'complete_report_period_required' }, 400)
  if (periodStart && periodEnd && periodStart > periodEnd) return json({ error: 'invalid_report_period' }, 400)

  const fileHash = await sha256(text)
  let duplicateQuery = admin.from('provider_sales_imports').select('id,created_at,mapped_row_count').eq('source_scope', sourceScope).eq('file_sha256', fileHash)
  duplicateQuery = selectedProvider ? duplicateQuery.eq('source_provider', selectedProvider) : duplicateQuery.is('source_provider', null)
  duplicateQuery = sourceScope === 'rep_account' ? duplicateQuery.eq('source_rep_user_id', user.id) : duplicateQuery.is('source_rep_user_id', null)
  const { data: duplicate, error: duplicateError } = await duplicateQuery.maybeSingle()
  if (duplicateError) throw duplicateError
  if (duplicate) return json({ ok: true, duplicate: true, import_id: duplicate.id, mapped: duplicate.mapped_row_count, rows: rows.length - 1 })

  const headers = rows[0].map(value => value.replace(/^\uFEFF/, ''))
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

  let mapped = 0
  const importedProviders = new Set<string>()
  try {
    for (let index = 1; index < rows.length; index += 250) {
      const chunk = rows.slice(index, index + 250).map(values => {
        const raw: Record<string, unknown> = {}
        headers.forEach((header, column) => { raw[header] = values[column] ?? '' })
        const detectedProvider = normalizeSaleProvider(pick(raw, ['provider', 'carrier', 'isp', 'brand', 'product provider']))
        const rowProvider = selectedProvider || detectedProvider
        const order = pick(raw, ['order number', 'order #', 'order id', 'order', 'confirmation number', 'confirmation #'])
        const account = pick(raw, ['account number', 'account #', 'account id', 'customer account', 'ban'])
        const seller = pick(raw, ['seller id', 'agent id', 'rep id', 'sales rep id', 'employee id', 'salesperson id'])
        const sellerName = pick(raw, ['seller name', 'agent name', 'rep name', 'sales rep', 'salesperson', 'agent'])
        const sellerEmail = pick(raw, ['seller email', 'agent email', 'rep email', 'sales rep email'])
        if (order || account) mapped++
        if (rowProvider) importedProviders.add(rowProvider)
        return {
          import_id: importRow.id,
          provider: rowProvider,
          order_number: order,
          account_number: account,
          seller_identifier: seller || sellerEmail || sellerName,
          seller_name: sellerName,
          seller_email: sellerEmail?.toLowerCase() || null,
          customer_name: pick(raw, ['customer name', 'subscriber name', 'name']),
          service_address: pick(raw, ['service address', 'address', 'install address']),
          sale_date: reportDate(pick(raw, ['sale date', 'order date', 'created date', 'submitted date', 'date'])),
          provider_status: pick(raw, ['status', 'order status', 'sale status']),
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
    notes: `${mapped} rows contained an order or account identifier.`
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
    verified_after_import: salesResult.verified,
    sales_checked: salesResult.total,
    cross_reference: crossReference,
    headers
  })
}

Deno.serve(async request => {
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

    if (action === 'upload_csv') return await uploadReport(admin, user, access, body)

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
      const counts: Record<string, number> = {}
      for (const sale of sales || []) counts[sale.verification_status] = (counts[sale.verification_status] || 0) + 1
      return json({
        ok: true,
        counts,
        imports: imports || [],
        discrepancies: discrepancies || [],
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
