import { createClient } from 'npm:@supabase/supabase-js@2.95.0'
import { corsHeaders } from 'npm:@supabase/supabase-js@2.95.0/cors'

const json = (body: unknown, status = 200) => Response.json(body, {
  status,
  headers: { ...corsHeaders, 'Cache-Control': 'no-store' },
})

const clean = (value: unknown) => String(value ?? '').trim().replace(/\s+/g, ' ')
const normalizeEmail = (value: unknown) => clean(value).toLowerCase()
const compact = (value: unknown) => clean(value).toLowerCase().replace(/[^a-z0-9]/g, '')
const normalizedPart = (value: unknown) => clean(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const normalizedZip = (value: unknown) => clean(value).replace(/[^0-9]/g, '').slice(0, 5)

const hashText = async (value: string) => {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

function parseAddress(full = '') {
  const value = clean(full).replace(/,\s*$/, '')
  const match = value.match(/^(.*?),\s*([^,]+),\s*([A-Z]{2})(?:,|\s)+\s*(\d{5}(?:-\d{4})?)$/i)
  if (!match) return { address1: value, address2: '', city: '', state: '', zip: '' }
  return {
    address1: clean(match[1]),
    address2: '',
    city: clean(match[2]),
    state: clean(match[3]).toUpperCase(),
    zip: clean(match[4]),
  }
}

function pick(payload: any, names: string[]) {
  for (const name of names) {
    const value = payload?.[name]
    if (value !== undefined && value !== null && clean(value) !== '') return clean(value)
  }
  const keys = Object.keys(payload || {})
  for (const name of names) {
    const key = keys.find(candidate => candidate.toLowerCase() === name.toLowerCase())
    if (key && payload[key] !== undefined && payload[key] !== null && clean(payload[key]) !== '') {
      return clean(payload[key])
    }
  }
  return ''
}

function providerId(payload: any, allowGenericId = false) {
  const names = [
    'provider_lead_id', 'strong_id', 'lead_id', 'leadId', 'dataObjectId',
    'data_object_id', 'objectId', 'object_id', 'spotio_id', 'spotioId',
  ]
  if (allowGenericId) names.push('id')
  return pick(payload, names) || pick(payload?.pin, ['id', 'lead_id'])
}

function providerName(payload: any) {
  return pick(payload, [
    'provider', 'provider_name', 'providerName', 'service_provider',
    'serviceProvider', 'internet_provider', 'internetProvider', 'isp', 'ISP',
  ])
}

function numeric(value: unknown, min: number, max: number) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) && number >= min && number <= max ? number : null
}

function normalizedRecord(payload: any, mode: string) {
  const full = pick(payload, ['full_address', 'FULL_ADDRESS', 'address', 'ADDRESS'])
  const parsed = parseAddress(full)
  const address1 = pick(payload, ['address1', 'ADDRESS1', 'street', 'STREET']) || parsed.address1
  const address2 = pick(payload, ['address2', 'ADDRESS2', 'unit', 'UNIT', 'suite', 'SUITE']) || parsed.address2
  const city = pick(payload, ['city', 'CITY']) || parsed.city
  const state = (pick(payload, ['state', 'STATE']) || parsed.state).toUpperCase()
  const zip = pick(payload, ['zip', 'ZIP', 'ZIP_5', 'postal_code', 'POSTAL_CODE']) || parsed.zip
  const latitude = numeric(
    payload?.latitude ?? payload?.lat ?? payload?.pin?.lat ?? payload?.pin?.latitude,
    -90, 90,
  )
  const longitude = numeric(
    payload?.longitude ?? payload?.lng ?? payload?.lon ?? payload?.pin?.lng ?? payload?.pin?.longitude,
    -180, 180,
  )
  const phones = Array.isArray(payload?.phones) ? payload.phones : []
  const phone = pick(payload, ['phone', 'PHONE'])
    || clean(phones[0]?.phone || phones[0]?.value || phones[0] || '')
  return {
    provider_lead_id: providerId(payload, mode === 'api_responses') || null,
    provider: providerName(payload) || 'SPOTIO',
    source_stage_id: pick(payload, ['source_stage_id', 'stageId', 'stage_id']) || null,
    address1,
    address2: address2 || null,
    city,
    state,
    zip,
    latitude,
    longitude,
    customer_name: pick(payload, ['customer_name', 'CUSTOMER_NAME', 'name', 'NAME']) || null,
    phone: phone || null,
    capture_mode: mode,
    source_payload: payload,
  }
}

function fallbackRecordKey(record: any) {
  return [record.provider, record.address1, record.address2, normalizedZip(record.zip)]
    .map(normalizedPart)
    .join('|')
}

function recordKey(record: any, index: number) {
  if (record.provider_lead_id) return `provider:${compact(record.provider_lead_id)}`
  const fallback = fallbackRecordKey(record)
  return fallback.replace(/\|/g, '') ? `address:${fallback}` : `invalid:${index}`
}

async function fetchAllItems(db: any, batchId: string) {
  const rows: any[] = []
  const pageSize = 1000
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await db
      .from('spotio_import_items')
      .select('id,chunk_index,item_index,payload')
      .eq('batch_id', batchId)
      .order('chunk_index')
      .order('item_index')
      .range(from, from + pageSize - 1)
    if (error) throw error
    rows.push(...(data || []))
    if ((data || []).length < pageSize) break
  }
  return rows
}

Deno.serve(async request => {
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

    const email = normalizeEmail(user.email)
    const { data: access, error: accessError } = await db
      .from('app_user_access')
      .select('role,active,organization_id')
      .eq('email', email)
      .maybeSingle()
    if (accessError) throw accessError
    if (!access?.active || access.role !== 'admin' || !access.organization_id) {
      return json({ error: 'admin_only' }, 403)
    }

    const body = await request.json().catch(() => ({}))
    const action = String(body.action || 'single')

    if (action === 'init') {
      const { data, error } = await db.from('spotio_import_batches').insert({
        uploaded_by: user.id,
        uploaded_by_email: email,
        organization_id: access.organization_id,
        source_filename: body.source_filename || null,
        captured_at: body.captured_at || new Date().toISOString(),
        raw_payload: {
          source_type: body.source_type || 'spotio_json',
          metadata: body.metadata || {},
          chunked: true,
          retention_mode: 'additive_missing_retained',
          import_batch_is_provenance_only: true,
          identity_precedence: ['provider_lead_id', 'organization_provider_street_unit_zip'],
        },
        record_count: Number(body.record_count || 0),
        status: 'uploading',
        created_count: 0,
        updated_count: 0,
        unchanged_count: 0,
        collision_count: 0,
        quarantined_count: 0,
        archived_count: 0,
        missing_retained_count: 0,
        capture_missing_count: 0,
      }).select('id,record_count,status,organization_id').single()
      if (error) throw error
      return json({ ok: true, batch: data })
    }

    const batchId = String(body.batch_id || '')
    if (!batchId) return json({ error: 'batch_id_required' }, 400)
    const { data: batch, error: batchError } = await db
      .from('spotio_import_batches')
      .select('*')
      .eq('id', batchId)
      .eq('uploaded_by', user.id)
      .eq('organization_id', access.organization_id)
      .maybeSingle()
    if (batchError) throw batchError
    if (!batch) return json({ error: 'batch_not_found' }, 404)

    if (action === 'chunk') {
      const records = Array.isArray(body.records) ? body.records : null
      if (!records) return json({ error: 'invalid_chunk' }, 400)
      const chunkIndex = Math.max(0, Math.floor(Number(body.chunk_index || 0)))
      const rows = records.map((payload: any, itemIndex: number) => ({
        batch_id: batchId,
        chunk_index: chunkIndex,
        item_index: itemIndex,
        payload,
      }))
      const { error } = await db.from('spotio_import_items').upsert(rows, {
        onConflict: 'batch_id,chunk_index,item_index',
      })
      if (error) throw error
      return json({ ok: true, accepted: rows.length })
    }

    if (action === 'finalize') {
      const { count, error: countError } = await db
        .from('spotio_import_items')
        .select('*', { count: 'exact', head: true })
        .eq('batch_id', batchId)
      if (countError) throw countError
      const { data, error } = await db.from('spotio_import_batches').update({
        status: 'received',
        record_count: count || 0,
      }).eq('id', batchId).select('id,record_count,status').single()
      if (error) throw error
      return json({ ok: true, batch: data })
    }

    if (action !== 'normalize') return json({ error: 'unsupported_action' }, 400)

    await db.from('spotio_import_results').delete().eq('batch_id', batchId)
    const { error: resetError } = await db.from('spotio_import_batches').update({
      status: 'normalizing',
      created_count: 0,
      updated_count: 0,
      unchanged_count: 0,
      collision_count: 0,
      quarantined_count: 0,
      archived_count: 0,
      missing_retained_count: 0,
      capture_missing_count: 0,
      normalization_completed_at: null,
    }).eq('id', batchId)
    if (resetError) throw resetError

    const items = await fetchAllItems(db, batchId)
    const rawPayload = batch.raw_payload || {}
    const metadata = rawPayload.metadata || {}
    const sourceType = String(rawPayload.source_type || 'spotio_json')
    const mode = String(metadata.capture_mode || '')
    let expected = Number(
      metadata?.summary?.expected_leads
      || metadata?.summary?.selected_count
      || metadata?.dom_row_count
      || 0
    )

    const normalized: any[] = []
    if (sourceType === 'csv') {
      for (const item of items) normalized.push(normalizedRecord(item.payload || {}, 'csv'))
      if (!expected) expected = normalized.length
    } else if (mode === 'dom_rows' || items.some(item => item?.payload?.source === 'spotio_dom')) {
      for (const item of items) normalized.push(normalizedRecord(item.payload || {}, 'dom_rows'))
      if (!expected) expected = normalized.length
    } else {
      const byProvider = new Map<string, any>()
      const withoutProvider: any[] = []
      for (const item of items) {
        const capture = item.payload || {}
        const url = String(capture.url || '')
        const data = capture.data
        if (url.includes('/api/dataobjectssearch/list') && Array.isArray(data?.items)) {
          expected = Math.max(expected, Number(data.totalCount || 0))
          for (const lead of data.items) {
            const id = providerId(lead, true)
            if (id) byProvider.set(id, lead)
            else withoutProvider.push(lead)
          }
        } else if (Array.isArray(data?.items)) {
          for (const lead of data.items) {
            const id = providerId(lead, true)
            if (id) byProvider.set(id, lead)
            else withoutProvider.push(lead)
          }
        } else if (capture?.id || capture?.pin || capture?.address) {
          const id = providerId(capture, true)
          if (id) byProvider.set(id, capture)
          else withoutProvider.push(capture)
        }
      }
      for (const lead of byProvider.values()) normalized.push(normalizedRecord(lead, 'api_responses'))
      for (const lead of withoutProvider) normalized.push(normalizedRecord(lead, 'api_responses'))
      if (!expected) expected = normalized.length
    }

    const unique = new Map<string, any>()
    normalized.forEach((record, index) => unique.set(recordKey(record, index), record))
    const records = [...unique.values()]
    const duplicateInputRecords = Math.max(0, normalized.length - records.length)

    let created = 0
    let updated = 0
    let unchanged = 0
    let collisions = 0
    let quarantined = 0
    let archived = 0
    let missingRetained = 0

    if (sourceType === 'csv') {
      const csvRows = []
      for (const record of records) {
        const fallback = fallbackRecordKey(record)
        const sourceId = record.provider_lead_id
          ? `CSV:${access.organization_id}:PROVIDER:${compact(record.provider_lead_id)}`
          : `CSV:${access.organization_id}:ADDRESS:${await hashText(fallback)}`
        csvRows.push({
          organization_id: access.organization_id,
          source_system: 'CSV',
          source_id: sourceId,
          provider: record.provider,
          provider_lead_id: record.provider_lead_id,
          canonical_identity_key: record.provider_lead_id
            ? `csv|provider|${compact(record.provider_lead_id)}`
            : `csv|address|${fallback}`,
          import_batch_id: batchId,
          source_stage_id: record.source_stage_id,
          source_payload: record.source_payload,
          address1: record.address1,
          address2: record.address2,
          city: record.city,
          state: record.state,
          zip: record.zip,
          latitude: record.latitude,
          longitude: record.longitude,
          customer_name: record.customer_name,
          phone: record.phone,
          source_first_seen_at: new Date().toISOString(),
          source_last_seen_at: new Date().toISOString(),
        })
      }
      for (let index = 0; index < csvRows.length; index += 250) {
        const slice = csvRows.slice(index, index + 250)
        const { error } = await db.from('leads').upsert(slice, {
          onConflict: 'source_system,source_id',
        })
        if (error) throw error
      }
      created = csvRows.length
    } else {
      const chunkSize = 250
      for (let offset = 0; offset < records.length; offset += chunkSize) {
        const { data, error } = await db.rpc('mccoy_upsert_spotio_batch_v1', {
          p_batch_id: batchId,
          p_records: records.slice(offset, offset + chunkSize),
          p_item_offset: offset,
        })
        if (error) throw error
        created += Number(data?.created || 0)
        updated += Number(data?.updated || 0)
        unchanged += Number(data?.unchanged || 0)
        collisions += Number(data?.collisions || 0)
        quarantined += Number(data?.quarantined || 0)
        archived += Number(data?.archived || 0)
      }

      const { data: missingData, error: missingError } = await db.rpc(
        'mccoy_classify_spotio_missing_retained_v1',
        { p_batch_id: batchId, p_item_offset: records.length },
      )
      if (missingError) throw missingError
      missingRetained = Number(missingData?.missing_retained || 0)
    }

    const captureMissing = expected > 0
      ? Math.max(0, expected - normalized.length)
      : (sourceType !== 'csv' && records.length === 0 ? 1 : 0)
    const accepted = created + updated + unchanged
    const complete = captureMissing === 0 && collisions === 0 && quarantined === 0
    const status = complete ? 'normalized' : 'incomplete'
    const notes = [
      `${sourceType.toUpperCase()} additive import: ${created} new, ${updated} updated,`,
      `${unchanged} unchanged, ${collisions} collisions, ${quarantined} quarantined,`,
      `${missingRetained} missing but retained, ${archived} explicitly archived,`,
      `${captureMissing} missing from capture, ${duplicateInputRecords} duplicate input rows.`,
      'Prior active leads were retained; import_batch_id is provenance only.',
    ].join(' ')

    const nextPayload = {
      ...rawPayload,
      additive_summary: {
        expected,
        input_records: normalized.length,
        unique_records: records.length,
        duplicate_input_records: duplicateInputRecords,
        accepted,
        created,
        updated,
        unchanged,
        collisions,
        quarantined,
        missing_retained: missingRetained,
        archived,
        capture_missing: captureMissing,
        retention_mode: 'additive_missing_retained',
        import_batch_is_provenance_only: true,
        identity_precedence: ['provider_lead_id', 'organization_provider_street_unit_zip'],
      },
    }
    const { error: finishError } = await db.from('spotio_import_batches').update({
      status,
      notes,
      raw_payload: nextPayload,
      normalization_completed_at: new Date().toISOString(),
      created_count: created,
      updated_count: updated,
      unchanged_count: unchanged,
      collision_count: collisions,
      quarantined_count: quarantined,
      archived_count: archived,
      missing_retained_count: missingRetained,
      capture_missing_count: captureMissing,
    }).eq('id', batchId)
    if (finishError) throw finishError

    const { count: activeLeadCount } = await db.from('leads')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', access.organization_id)
      .is('deleted_at', null)
      .not('source_system', 'ilike', '%demo%')

    return json({
      ok: true,
      complete,
      status,
      expected,
      input_records: normalized.length,
      unique_records: records.length,
      duplicate_input_records: duplicateInputRecords,
      unique_imported: accepted,
      created,
      updated,
      unchanged,
      collisions,
      quarantined,
      missing_retained: missingRetained,
      archived,
      capture_missing: captureMissing,
      missing: captureMissing,
      active_leads_retained: activeLeadCount || 0,
      retention_mode: 'additive_missing_retained',
      import_batch_is_provenance_only: true,
      identity_precedence: ['provider_lead_id', 'organization_provider_street_unit_zip'],
      batch_id: batchId,
    })
  } catch (error) {
    console.error('spotio_import_failed', error)
    return json({
      error: 'spotio_import_failed',
      detail: String((error as Error)?.message || error).slice(0, 600),
    }, 500)
  }
})
