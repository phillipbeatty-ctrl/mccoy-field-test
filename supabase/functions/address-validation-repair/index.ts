// @ts-nocheck
import { createClient } from 'npm:@supabase/supabase-js@2.95.0'
import { corsHeaders } from 'npm:@supabase/supabase-js@2.95.0/cors'
import {
  addressValidationRequest,
  comparisonRow,
  cohortSnapshotPayload,
  fieldPlacementForLead,
  selectSuspiciousCohort
} from '../_shared/address-validation-pilot-core.mjs'

const json = (body:any, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {...corsHeaders, 'Content-Type':'application/json', 'Cache-Control':'no-store'}
})

async function sha256(value:string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

async function fetchAll(queryFactory:any, pageSize = 1000) {
  const rows:any[] = []
  for (let start = 0; start < 50000; start += pageSize) {
    const {data, error} = await queryFactory().range(start, start + pageSize - 1)
    if (error) throw error
    rows.push(...(data || []))
    if ((data || []).length < pageSize) return rows
  }
  throw new Error('read_pagination_guard')
}

async function validateAddress(googleKey:string, lead:any) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 12000)
  try {
    const response = await fetch(`https://addressvalidation.googleapis.com/v1:validateAddress?key=${encodeURIComponent(googleKey)}`, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify(addressValidationRequest(lead)),
      signal: controller.signal
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      const code = payload?.error?.status || `HTTP_${response.status}`
      const message = payload?.error?.message || 'address_validation_failed'
      throw new Error(`${code}: ${message}`)
    }
    return payload
  } finally {
    clearTimeout(timeout)
  }
}

Deno.serve(async(req:Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', {headers:corsHeaders})
  try {
    if (req.method !== 'POST') return json({error:'method_not_allowed'}, 405)
    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/, '')
    if (!jwt) return json({error:'unauthorized'}, 401)
    const url = Deno.env.get('SUPABASE_URL')!
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const googleKey = Deno.env.get('GOOGLE_MAPS_API_KEY') || ''
    const admin = createClient(url, service, {auth:{persistSession:false,autoRefreshToken:false}})
    const {data:{user}, error:userError} = await admin.auth.getUser(jwt)
    if (userError || !user?.email) return json({error:'unauthorized'}, 401)
    const {data:access, error:accessError} = await admin.from('app_user_access')
      .select('role,active').eq('email', user.email.toLowerCase()).maybeSingle()
    if (accessError) throw accessError
    if (!access?.active || access.role !== 'admin') return json({error:'admin_only'}, 403)
    if (!googleKey) return json({error:'google_maps_key_not_configured'}, 503)

    const body = await req.json().catch(() => ({}))
    if (String(body.action || '') !== 'apply_safest_pilot_repair') return json({error:'unknown_action'}, 400)
    if (Math.floor(Number(body.limit || 100)) !== 100) return json({error:'repair_requires_exactly_100_leads'}, 400)
    const suppliedSnapshotToken = String(body.pilot_snapshot_token || '')
    if (!/^[a-f0-9]{64}$/.test(suppliedSnapshotToken)) return json({error:'pilot_snapshot_token_required'}, 400)

    const {data:batches, error:batchError} = await admin.from('spotio_import_batches')
      .select('id,created_at,status,raw_payload').eq('status','normalized')
      .order('created_at',{ascending:false}).limit(100)
    if (batchError) throw batchError
    const normalized = batches || []
    const canonicalSpotio = normalized.find((batch:any) => String(batch?.raw_payload?.source_type || '') === 'spotio_json')
    const csvBatches = normalized.filter((batch:any) => String(batch?.raw_payload?.source_type || '') === 'csv')
    const selectedIds = [canonicalSpotio?.id, ...csvBatches.map((batch:any) => batch.id)].filter(Boolean)
    const columns = 'id,source_id,address1,address2,city,state,zip,latitude,longitude,geocode_status,geocode_provider,geocode_verification_status,geocode_verified_at,source_system,import_batch_id'
    const queryFactory = () => {
      let query = admin.from('leads').select(columns).is('deleted_at',null)
        .not('source_system','ilike','%demo%').not('latitude','is',null).not('longitude','is',null)
      query = selectedIds.length
        ? query.or(`import_batch_id.in.(${selectedIds.join(',')}),source_system.eq.FIELD_ENTRY`)
        : query.eq('source_system','FIELD_ENTRY')
      return query.order('id',{ascending:true})
    }
    const visibleLeads = await fetchAll(queryFactory)
    const cohort = selectSuspiciousCohort(visibleLeads, 100)
    if (cohort.length !== 100) return json({error:'insufficient_suspicious_visible_leads',available:cohort.length}, 409)
    const currentSnapshotToken = await sha256(cohortSnapshotPayload(cohort))
    if (currentSnapshotToken !== suppliedSnapshotToken) return json({
      error:'stale_pilot_snapshot',
      detail:'The Lead Pool changed after the read-only pilot. Run the pilot again before applying any repair.'
    }, 409)

    const cohortIds = cohort.map((lead:any) => lead.id)
    const {data:visits, error:visitError} = await admin.from('door_visits').select(
      'lead_id,arrived_at,arrival_latitude,arrival_longitude,arrival_accuracy_meters,disposition_at,disposition_latitude,disposition_longitude,disposition_accuracy_meters,gps_verified_at_arrival,gps_verified_at_disposition,created_at,updated_at'
    ).in('lead_id',cohortIds)
    if (visitError) throw visitError
    const visitsByLead = new Map()
    for (const visit of visits || []) {
      if (!visitsByLead.has(visit.lead_id)) visitsByLead.set(visit.lead_id, [])
      visitsByLead.get(visit.lead_id).push(visit)
    }

    // All external calls finish before the database repair transaction starts.
    const rows:any[] = []
    for (let start = 0; start < cohort.length; start += 5) {
      const batch = cohort.slice(start, start + 5)
      const batchRows = await Promise.all(batch.map(async(lead:any) => {
        const fieldPlacement = fieldPlacementForLead(lead, visitsByLead.get(lead.id) || [])
        try {
          const response = await validateAddress(googleKey, lead)
          return comparisonRow(lead, response, fieldPlacement)
        } catch (error) {
          return comparisonRow(lead, null, fieldPlacement, String(error?.message || error))
        }
      }))
      rows.push(...batchRows)
    }
    const errors = rows.filter(row => row.api_status !== 'validated')
    if (errors.length) return json({
      error:'google_validation_incomplete',
      detail:`Google failed ${errors.length} of 100 comparisons. No lead data was changed.`,
      errors:errors.reduce((counts:any,row:any) => {
        const key = String(row.api_error || 'unknown').split(':')[0]
        counts[key] = (counts[key] || 0) + 1
        return counts
      }, {})
    }, 502)

    const {data:result, error:repairError} = await admin.rpc('apply_address_validation_pilot_repair', {
      p_actor_user_id:user.id,
      p_snapshot_token:currentSnapshotToken,
      p_rows:rows
    })
    if (repairError) throw repairError
    const distances = rows.map(row => Number(row.old_to_google_meters)).filter(Number.isFinite).sort((a,b) => a-b)
    const percentile = (fraction:number) => distances.length ? distances[Math.min(distances.length - 1, Math.floor((distances.length - 1) * fraction))] : null
    return json({
      ok:true,
      read_only:false,
      pilot_snapshot_token:currentSnapshotToken,
      result,
      summary:{
        requested:100,returned:rows.length,validated:rows.length,errors:{},
        automatic_repair_eligible:rows.filter(row => row.automatic_repair_eligible === true).length,
        admin_review:rows.filter(row => String(row.repair_decision || '').startsWith('admin_review_')).length,
        protected:rows.filter(row => String(row.repair_decision || '').startsWith('protected_')).length,
        field_confirmed:rows.filter(row => row.field_confirmed_latitude !== null && row.field_confirmed_longitude !== null).length,
        old_to_google_meters:{median:percentile(0.5),p90:percentile(0.9),max:distances.at(-1) ?? null},
        moved_over_25m:rows.filter(row => Number(row.old_to_google_meters)>25).length,
        moved_over_50m:rows.filter(row => Number(row.old_to_google_meters)>50).length,
        moved_over_100m:rows.filter(row => Number(row.old_to_google_meters)>100).length
      },
      rows
    })
  } catch(error) {
    console.error('address-validation-repair failed', String(error?.message || error))
    return json({error:'address_validation_repair_failed',detail:String(error?.message || error)},500)
  }
})
