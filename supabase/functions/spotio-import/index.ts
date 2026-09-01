import { serveWithOrganizationAccess } from '../_shared/organization-paywall.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.95.0'
import { corsHeaders } from 'npm:@supabase/supabase-js@2.95.0/cors'

const json = (body, status = 200) => Response.json(body, {
  status,
  headers: { ...corsHeaders, 'Cache-Control': 'no-store' },
})
const clean = value => String(value ?? '').trim().replace(/\s+/g, ' ')
const normalizeEmail = value => clean(value).toLowerCase()
const normalizePart = value => clean(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const zip5 = value => clean(value).replace(/[^0-9]/g, '').slice(0, 5)
const validNumber = (value, min, max) => {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) && number >= min && number <= max ? number : null
}
const sourceTime = value => {
  const text = clean(value)
  if (!text) return null
  const parsed = Date.parse(text)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null
}
const hashText = async value => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}
const pick = (payload, names) => {
  for (const name of names) {
    const value = payload?.[name]
    if (value !== undefined && value !== null && clean(value) !== '') return clean(value)
  }
  const keys = Object.keys(payload || {})
  for (const name of names) {
    const key = keys.find(candidate => candidate.toLowerCase() === name.toLowerCase())
    if (key && clean(payload[key]) !== '') return clean(payload[key])
  }
  return ''
}
const validUnit = value => {
  const text = clean(value)
  return text && text !== '-' && text !== '0' ? text : ''
}
const parseAddress = full => {
  let value = clean(full).replace(/,\s*$/, '')
  value = value.replace(/,\s*(?:US|USA)\s*$/i, '').replace(/,\s*$/, '')
  const match = value.match(/^(.*?),\s*([^,]+),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)\s*$/i)
  if (!match) return { address1: value, address2: '', city: '', state: '', zip: '' }
  return {
    address1: clean(match[1]),
    address2: '',
    city: clean(match[2]),
    state: clean(match[3]).toUpperCase(),
    zip: clean(match[4]),
  }
}
const apiFields = payload => {
  const result = {}
  for (const field of Array.isArray(payload?.fields) ? payload.fields : []) {
    if (!field || field.fieldId === undefined) continue
    result[String(field.fieldId)] = clean(field.value)
  }
  return result
}
const STAGE_IDS = {
  'prospecting / keep knocking': '1', 'prospecting keep knocking': '1',
  'hot lead': '28', contacted: '22', smb: '30',
  'follow-up': '25', 'follow up': '25', 'no sale made': '3',
  'existing customer': '27', 'sale made': '19', migrator: '24',
  'admin hold': '26', 'no sale': '3',
}
const STAGE_LABELS = {
  '1': 'Prospecting / Keep Knocking', '28': 'Hot Lead', '22': 'Contacted',
  '30': 'SMB', '25': 'Follow-up', '3': 'No Sale Made',
  '27': 'Existing Customer', '19': 'Sale Made', '24': 'Migrator', '26': 'Admin Hold',
}

function sourceCoordinate(api, payload) {
  const pin = api?.pin || payload?.pin || {}
  const latitude = validNumber(api?.latitude ?? api?.lat ?? pin?.lat ?? pin?.latitude ?? payload?.latitude ?? payload?.lat, -90, 90)
  const longitude = validNumber(api?.longitude ?? api?.lng ?? api?.lon ?? pin?.lng ?? pin?.longitude ?? payload?.longitude ?? payload?.lng ?? payload?.lon, -180, 180)
  return latitude === null || longitude === null ? { latitude: null, longitude: null } : { latitude, longitude }
}

async function preservedDomRecord(payload, batchMetadata, globalIndex) {
  const cells = Array.isArray(payload?.raw_cells) ? payload.raw_cells : []
  const file = payload?._mccoy_file || {}
  const api = payload?._mccoy_api || {}
  const fields = apiFields(api)
  const parsed = parseAddress(clean(cells[4]) || pick(payload, ['full_address', 'address']))
  const name = validUnit(cells[1]) || pick(payload, ['customer_name', 'name']) || clean(api.name)
  const unit = validUnit(cells[8]) || validUnit(api.addressUnit) || validUnit(fields['100001'])
  const stageLabel = clean(cells[2]) || pick(payload, ['stage', 'status', 'disposition'])
  const stageKey = stageLabel.toLowerCase()
  const phoneRaw = clean(cells[10]) || fields['9'] || clean(api?.phones?.[0]?.phone || api?.phones?.[0]?.value || api?.phones?.[0] || '')
  const phone = phoneRaw.replace(/\D/g, '')
  const address1 = parsed.address1 || `Imported SPOTIO row ${globalIndex + 1}`
  const city = parsed.city || 'Location Review'
  const state = /^[A-Z]{2}$/.test(parsed.state) ? parsed.state : 'US'
  const zip = /^\d{5}(?:-\d{4})?$/.test(parsed.zip) ? parsed.zip : '00000'
  const sourceOrigin = clean(file.source_origin || batchMetadata.source_origin || '')
  const startedAt = clean(file.started_at || batchMetadata.started_at || '')
  const rowIndex = payload?.row_index ?? file.row_index ?? globalIndex
  const fingerprint = [
    sourceOrigin,
    startedAt,
    String(rowIndex),
    normalizePart(address1),
    normalizePart(unit),
    normalizePart(city),
    state,
    zip5(zip),
    normalizePart(name),
  ].join('|')
  const hash = await hashText(fingerprint)
  const coordinate = sourceCoordinate(api, payload)
  const updatedAt = sourceTime(cells[3] || api.stageUpdatedAt || api.updatedAt || payload?.captured_at)
  return {
    provider_lead_id: `LISTROW:${hash.slice(0, 32)}`,
    provider: 'SPOTIO',
    source_stage_id: STAGE_IDS[stageKey] || clean(api.stageId) || null,
    source_stage: stageLabel || null,
    source_stage_updated_at: updatedAt,
    source_updated_at: updatedAt,
    source_last_activity_at: updatedAt,
    address1,
    address2: unit || null,
    city,
    state,
    zip,
    latitude: coordinate.latitude,
    longitude: coordinate.longitude,
    customer_name: name && name !== '-' ? name : null,
    phone: phone.length >= 7 ? phone : null,
    _row_hash: hash,
    _source_has_coordinates: coordinate.latitude !== null,
    source_payload: {
      permanent_source_record_key: `spotiolist:${hash}`,
      synthetic_list_row_provider_id: `LISTROW:${hash.slice(0, 32)}`,
      spotio_provider_lead_id: clean(api.id) || null,
      spotio_pin_id: clean(api?.pin?.id) || null,
      spotio_owner_id: clean(api.ownerId) || null,
      spotio_territory_id: clean(api.territoryId) || null,
      source_origin: sourceOrigin || null,
      source_started_at: startedAt || null,
      source_row_index: rowIndex,
      row_preservation_version: 1,
      raw_payload: payload,
      api_evidence: api && Object.keys(api).length ? api : null,
    },
  }
}

async function apiRecord(payload, batchMetadata, globalIndex) {
  const fields = apiFields(payload)
  const parsed = parseAddress(pick(payload, ['full_address', 'address']) || clean(payload?.pin?.address))
  const name = pick(payload, ['customer_name', 'name']) || clean(`${fields['100002'] || ''} ${fields['100003'] || ''}`)
  const unit = validUnit(pick(payload, ['address2', 'addressUnit', 'unit', 'suite']) || fields['100001'])
  const providerId = pick(payload, ['provider_lead_id', 'id', 'leadId', 'spotioId']) || clean(payload?.pin?.id)
  const address1 = parsed.address1 || `Imported SPOTIO API row ${globalIndex + 1}`
  const city = parsed.city || 'Location Review'
  const state = /^[A-Z]{2}$/.test(parsed.state) ? parsed.state : 'US'
  const zip = /^\d{5}(?:-\d{4})?$/.test(parsed.zip) ? parsed.zip : '00000'
  const coordinate = sourceCoordinate(payload, payload)
  const stageId = clean(payload.stageId)
  const stageLabel = pick(payload, ['stage', 'stageName', 'status', 'disposition']) || STAGE_LABELS[stageId] || ''
  const updatedAt = sourceTime(pick(payload, ['stageUpdatedAt', 'updatedAt', 'lastActivityTime']))
  const hash = await hashText([clean(batchMetadata.source_origin), providerId || globalIndex, normalizePart(address1), normalizePart(unit)].join('|'))
  return {
    provider_lead_id: providerId || `LISTROW:${hash.slice(0, 32)}`,
    provider: 'SPOTIO',
    source_stage_id: stageId || STAGE_IDS[stageLabel.toLowerCase()] || null,
    source_stage: stageLabel || null,
    source_stage_updated_at: updatedAt,
    source_updated_at: updatedAt,
    source_last_activity_at: updatedAt,
    address1,
    address2: unit || null,
    city,
    state,
    zip,
    latitude: coordinate.latitude,
    longitude: coordinate.longitude,
    customer_name: name || null,
    phone: fields['9'] || null,
    _row_hash: hash,
    _source_has_coordinates: coordinate.latitude !== null,
    source_payload: {
      permanent_source_record_key: providerId ? `spotioapi:${providerId.toLowerCase()}` : `spotiolist:${hash}`,
      spotio_provider_lead_id: providerId || null,
      spotio_pin_id: clean(payload?.pin?.id) || null,
      spotio_owner_id: clean(payload.ownerId) || null,
      spotio_territory_id: clean(payload.territoryId) || null,
      row_preservation_version: 1,
      raw_payload: payload,
    },
  }
}

async function csvRecord(payload, batchMetadata, globalIndex) {
  const full = pick(payload, ['full_address', 'FULL_ADDRESS', 'address', 'ADDRESS'])
  const parsed = parseAddress(full)
  const address1 = pick(payload, ['address1', 'ADDRESS1', 'street', 'STREET']) || parsed.address1 || `Imported CSV row ${globalIndex + 1}`
  const address2 = validUnit(pick(payload, ['address2', 'ADDRESS2', 'unit', 'UNIT', 'suite', 'SUITE']))
  const city = pick(payload, ['city', 'CITY']) || parsed.city || 'Location Review'
  const stateRaw = (pick(payload, ['state', 'STATE']) || parsed.state).toUpperCase()
  const state = /^[A-Z]{2}$/.test(stateRaw) ? stateRaw : 'US'
  const zipRaw = pick(payload, ['zip', 'ZIP', 'ZIP_5', 'postal_code', 'POSTAL_CODE']) || parsed.zip
  const zip = /^\d{5}(?:-\d{4})?$/.test(zipRaw) ? zipRaw : '00000'
  const name = pick(payload, ['customer_name', 'CUSTOMER_NAME', 'name', 'NAME'])
  const file = payload?._mccoy_file || {}
  const rowIndex = payload?._mccoy_row_index ?? globalIndex
  const fingerprint = [clean(file.source_name || batchMetadata.source_filename), String(rowIndex), normalizePart(address1), normalizePart(address2), normalizePart(city), state, zip5(zip), normalizePart(name)].join('|')
  const hash = await hashText(fingerprint)
  const coordinate = sourceCoordinate(payload, payload)
  return {
    provider_lead_id: `LISTROW:${hash.slice(0, 32)}`,
    provider: pick(payload, ['provider', 'provider_name', 'ISP']) || 'SPOTIO',
    source_stage_id: pick(payload, ['source_stage_id', 'stageId', 'stage_id']) || null,
    source_stage: pick(payload, ['stage', 'status', 'disposition']) || null,
    source_stage_updated_at: sourceTime(pick(payload, ['updated_at', 'updatedAt', 'last_activity_at'])),
    source_updated_at: sourceTime(pick(payload, ['updated_at', 'updatedAt', 'last_activity_at'])),
    address1,
    address2: address2 || null,
    city,
    state,
    zip,
    latitude: coordinate.latitude,
    longitude: coordinate.longitude,
    customer_name: name || null,
    phone: pick(payload, ['phone', 'PHONE']) || null,
    _row_hash: hash,
    _source_has_coordinates: coordinate.latitude !== null,
    source_payload: {
      permanent_source_record_key: `spotiolist:${hash}`,
      synthetic_list_row_provider_id: `LISTROW:${hash.slice(0, 32)}`,
      row_preservation_version: 1,
      raw_payload: payload,
    },
  }
}

function jitterPoint(point, hash) {
  const first = parseInt(hash.slice(0, 8), 16) / 0xffffffff
  const second = parseInt(hash.slice(8, 16), 16) / 0xffffffff
  const angle = first * Math.PI * 2
  const radius = 0.001 + second * 0.006
  const cosine = Math.max(Math.abs(Math.cos(Number(point.latitude) * Math.PI / 180)), 0.2)
  return {
    latitude: Number(point.latitude) + Math.cos(angle) * radius,
    longitude: Number(point.longitude) + Math.sin(angle) * radius / cosine,
  }
}

function applyMapVisibility(record, centroids) {
  if (record.latitude !== null && record.longitude !== null) {
    return {
      ...record,
      geocode_status: 'spotio_source',
      geocode_provider: 'spotio',
      geocode_precision: 'source_pin',
      geocode_verification_status: 'unverified_source',
    }
  }
  const centroid = centroids.get(zip5(record.zip)) || {
    latitude: 39.8283,
    longitude: -98.5795,
    provider: 'mccoy_fallback',
    formatted_address: 'United States review point',
    place_id: null,
  }
  const point = jitterPoint(centroid, record._row_hash)
  const hasZip = centroids.has(zip5(record.zip))
  return {
    ...record,
    latitude: point.latitude,
    longitude: point.longitude,
    geocode_status: hasZip ? 'zip_centroid_review' : 'national_review_fallback',
    geocode_provider: centroid.provider || 'mccoy_centroid',
    geocode_precision: hasZip ? 'zip_centroid' : 'country',
    geocode_verification_status: 'approximate_address_review',
    geocode_formatted_address: centroid.formatted_address || null,
    geocode_place_id: centroid.place_id || null,
  }
}

async function fetchItems(db, batchId, offset, limit) {
  const { data, error } = await db.from('spotio_import_items')
    .select('chunk_index,item_index,payload')
    .eq('batch_id', batchId)
    .order('chunk_index')
    .order('item_index')
    .range(offset, offset + limit - 1)
  if (error) throw error
  return data || []
}

serveWithOrganizationAccess('lead_management',async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  try {
    const jwt = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/, '')
    if (!jwt) return json({ error: 'unauthorized' }, 401)
    const db = createClient(
      Deno.env.get('SUPABASE_URL'),
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
      { auth: { persistSession: false, autoRefreshToken: false } },
    )
    const { data: { user }, error: userError } = await db.auth.getUser(jwt)
    if (userError || !user?.email) return json({ error: 'unauthorized' }, 401)
    const email = normalizeEmail(user.email)
    const { data: access, error: accessError } = await db.from('app_user_access')
      .select('role,active,organization_id')
      .eq('email', email)
      .maybeSingle()
    if (accessError) throw accessError
    if (!access?.active || access.role !== 'admin' || !access.organization_id) return json({ error: 'admin_only' }, 403)

    const body = await request.json().catch(() => ({}))
    const action = String(body.action || '')

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
          row_preservation_mode: true,
          map_visibility_required: true,
          retention_mode: 'additive_missing_retained',
          duplicate_policy: 'one live lead per source list row; repeated uploads update the same source-row identity',
          import_batch_is_provenance_only: true,
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
    const { data: batch, error: batchError } = await db.from('spotio_import_batches')
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
      const rows = records.map((payload, itemIndex) => ({ batch_id: batchId, chunk_index: chunkIndex, item_index: itemIndex, payload }))
      const { error } = await db.from('spotio_import_items').upsert(rows, { onConflict: 'batch_id,chunk_index,item_index' })
      if (error) throw error
      return json({ ok: true, accepted: rows.length })
    }

    if (action === 'finalize') {
      const { count, error: countError } = await db.from('spotio_import_items')
        .select('*', { count: 'exact', head: true }).eq('batch_id', batchId)
      if (countError) throw countError
      const { data, error } = await db.from('spotio_import_batches')
        .update({ status: 'received', record_count: Number(count || 0) })
        .eq('id', batchId)
        .select('id,record_count,status').single()
      if (error) throw error
      return json({ ok: true, batch: data })
    }

    if (action === 'prepare_normalization') {
      await db.from('spotio_import_results').delete().eq('batch_id', batchId)
      const { count, error: countError } = await db.from('spotio_import_items')
        .select('*', { count: 'exact', head: true }).eq('batch_id', batchId)
      if (countError) throw countError
      const { error } = await db.from('spotio_import_batches').update({
        status: 'normalizing',
        record_count: Number(count || 0),
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
      if (error) throw error
      return json({ ok: true, batch_id: batchId, total: Number(count || 0), chunk_size: 250 })
    }

    if (action === 'normalize_chunk') {
      const offset = Math.max(0, Math.floor(Number(body.offset || 0)))
      const limit = Math.min(250, Math.max(1, Math.floor(Number(body.limit || 250))))
      const rows = await fetchItems(db, batchId, offset, limit)
      if (!rows.length) return json({ ok: true, processed: 0, offset, done: offset >= Number(batch.record_count || 0) })
      const metadata = batch.raw_payload?.metadata || {}
      const normalized = []
      for (let index = 0; index < rows.length; index++) {
        const payload = rows[index].payload || {}
        const globalIndex = offset + index
        if (Array.isArray(payload.raw_cells) || payload._mccoy_kind === 'dom_row') {
          normalized.push(await preservedDomRecord(payload, metadata, globalIndex))
        } else if (payload._mccoy_kind === 'api_item' || payload.pin || payload.id) {
          normalized.push(await apiRecord(payload, metadata, globalIndex))
        } else {
          normalized.push(await csvRecord(payload, metadata, globalIndex))
        }
      }
      const requestedZips = [...new Set(normalized.map(record => zip5(record.zip)).filter(zip => /^\d{5}$/.test(zip) && zip !== '00000'))]
      const { data: centroidRows, error: centroidError } = await db.rpc('mccoy_spotio_map_centroids_v1', { p_zip_codes: requestedZips })
      if (centroidError) throw centroidError
      const centroids = new Map()
      for (const row of centroidRows || []) if (!centroids.has(row.zip)) centroids.set(row.zip, row)
      const mapped = normalized.map(record => applyMapVisibility(record, centroids)).map(record => {
        const { _row_hash, _source_has_coordinates, ...safe } = record
        return safe
      })
      const { data: result, error: rpcError } = await db.rpc('mccoy_upsert_spotio_batch_v2', {
        p_batch_id: batchId,
        p_records: mapped,
        p_item_offset: offset,
      })
      if (rpcError) throw rpcError
      const approximate = mapped.filter(record => record.geocode_verification_status === 'approximate_address_review').length
      return json({
        ok: true,
        batch_id: batchId,
        offset,
        processed: rows.length,
        next_offset: offset + rows.length,
        done: offset + rows.length >= Number(batch.record_count || 0),
        approximate_review: approximate,
        map_visible: rows.length,
        chunk: result,
      })
    }

    if (action === 'complete_normalization') {
      const { data: current, error: currentError } = await db.from('spotio_import_batches').select('*').eq('id', batchId).single()
      if (currentError) throw currentError
      const created = Number(current.created_count || 0)
      const updated = Number(current.updated_count || 0)
      const unchanged = Number(current.unchanged_count || 0)
      const collisions = Number(current.collision_count || 0)
      const quarantined = Number(current.quarantined_count || 0)
      const archived = Number(current.archived_count || 0)
      const expected = Number(current.record_count || 0)
      const accepted = created + updated + unchanged
      const processed = accepted + collisions + quarantined + archived
      const { count: mappedCount, error: mappedError } = await db.from('leads')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', access.organization_id)
        .eq('import_batch_id', batchId)
        .is('deleted_at', null)
        .not('latitude', 'is', null)
        .not('longitude', 'is', null)
      if (mappedError) throw mappedError
      const { count: missingRetained, error: retainedError } = await db.from('leads')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', access.organization_id)
        .is('deleted_at', null)
        .not('source_system', 'ilike', '%demo%')
        .or(`import_batch_id.is.null,import_batch_id.neq.${batchId}`)
      if (retainedError) throw retainedError
      const complete = processed === expected && collisions === 0 && quarantined === 0
      const status = complete ? 'normalized' : 'incomplete'
      const now = new Date().toISOString()
      const summary = {
        expected,
        input_records: expected,
        processed,
        accepted,
        created,
        updated,
        unchanged,
        collisions,
        quarantined,
        archived,
        missing_retained: Number(missingRetained || 0),
        map_visible: Number(mappedCount || 0),
        unmapped_accepted: Math.max(0, accepted - Number(mappedCount || 0)),
        row_preservation_mode: true,
        provider_id_required: false,
        source_coordinates_required: false,
        duplicate_policy: 'one live lead per source list row; repeated uploads update the same source-row identity',
      }
      const notes = `Row-preserving import: ${created} new, ${updated} updated, ${unchanged} unchanged, ${collisions} collisions, ${quarantined} quarantined, ${archived} explicitly archived, ${Number(mappedCount || 0)} map-visible, ${Number(missingRetained || 0)} prior leads retained.`
      const { error: finishError } = await db.from('spotio_import_batches').update({
        status,
        notes,
        raw_payload: { ...(current.raw_payload || {}), additive_summary: summary },
        normalization_completed_at: now,
        missing_retained_count: Number(missingRetained || 0),
        capture_missing_count: 0,
      }).eq('id', batchId)
      if (finishError) throw finishError
      const { count: activeCount } = await db.from('leads').select('*', { count: 'exact', head: true })
        .eq('organization_id', access.organization_id).is('deleted_at', null).not('source_system', 'ilike', '%demo%')
      return json({ ok: true, complete, status, batch_id: batchId, ...summary, active_leads_retained: Number(activeCount || 0) })
    }

    if (action === 'normalize') {
      const { count } = await db.from('spotio_import_items').select('*', { count: 'exact', head: true }).eq('batch_id', batchId)
      if (Number(count || 0) > 250) {
        return json({
          ok: true,
          complete: false,
          status: 'normalizing',
          chunked_normalization_required: true,
          expected: Number(count || 0),
          detail: 'Use prepare_normalization, normalize_chunk, and complete_normalization for large row-preserving uploads.',
        }, 202)
      }
      return json({ error: 'use_chunked_normalization_actions' }, 409)
    }

    if (action === 'status') return json({ ok: true, batch })
    return json({ error: 'unsupported_action' }, 400)
  } catch (error) {
    console.error('spotio_import_failed', error)
    return json({ error: 'spotio_import_failed', detail: String(error?.message || error).slice(0, 800) }, 500)
  }
})
