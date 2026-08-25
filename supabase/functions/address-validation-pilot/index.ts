// @ts-nocheck
import { createClient } from 'npm:@supabase/supabase-js@2.95.0'
import { corsHeaders } from 'npm:@supabase/supabase-js@2.95.0/cors'
import {
  addressValidationRequest,
  comparisonRow,
  cohortSnapshotPayload,
  countSuspiciousCoordinateStacks,
  fieldPlacementForLead,
  selectSuspiciousCohort
} from '../_shared/address-validation-pilot-core.mjs'

const json = (body:any, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {...corsHeaders, 'Content-Type':'application/json', 'Cache-Control':'no-store'}
})

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

async function sha256(value:string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
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
    if (String(body.action || '') !== 'run_read_only_pilot') return json({error:'unknown_action'}, 400)
    const requestedLimit = Math.floor(Number(body.limit || 100))
    if (requestedLimit !== 100) return json({error:'pilot_requires_exactly_100_leads'}, 400)

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
    const eligiblePendingCohort = selectSuspiciousCohort(visibleLeads, 50000)
    const cohort = eligiblePendingCohort.slice(0, requestedLimit)
    if (cohort.length !== requestedLimit) return json({
      error:'insufficient_suspicious_visible_leads', requested:requestedLimit,
      available:cohort.length,
      suspicious_coordinate_stacks:countSuspiciousCoordinateStacks(visibleLeads)
    }, 409)
    const pilotSnapshotToken = await sha256(cohortSnapshotPayload(cohort))
    const cohortTierCounts = cohort.reduce((counts:any,lead:any) => {
      const tier = String(lead.pilot_cohort_tier || 'unknown')
      counts[tier] = (counts[tier] || 0) + 1
      return counts
    }, {})

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

    const validated = rows.filter(row => row.api_status === 'validated')
    const distances = validated.map(row => Number(row.old_to_google_meters)).filter(Number.isFinite).sort((a,b) => a-b)
    const percentile = (fraction:number) => distances.length ? distances[Math.min(distances.length - 1, Math.floor((distances.length - 1) * fraction))] : null
    const errors = rows.reduce((counts:any,row:any) => {
      if (row.api_status !== 'error') return counts
      const key = String(row.api_error || 'unknown').split(':')[0]
      counts[key] = (counts[key] || 0) + 1
      return counts
    }, {})
    const fieldConfirmed = rows.filter(row => row.field_confirmed_latitude !== null && row.field_confirmed_longitude !== null)
    const repairDecisions = rows.reduce((counts:any,row:any) => {
      const key = String(row.repair_decision || 'unknown')
      counts[key] = (counts[key] || 0) + 1
      return counts
    }, {})
    return json({
      ok:true,
      read_only:true,
      generated_at:new Date().toISOString(),
      pilot_snapshot_token:pilotSnapshotToken,
      cohort_rule:`All ${Number(cohortTierCounts.census_matched_pending_google || 0)} eligible Census-matched pending-Google stacks, plus a stable-hash fill of ${Number(cohortTierCounts.google_mymaps_pending_google || 0)} Google My Maps pending-Google stacks; one lead from each distinct visible exact-coordinate stack containing at least two different base street addresses.`,
      source_pool:{
        visible_leads:visibleLeads.length,
        suspicious_coordinate_stacks:countSuspiciousCoordinateStacks(visibleLeads),
        eligible_pending_stacks:eligiblePendingCohort.length
      },
      summary:{
        requested:requestedLimit,returned:rows.length,validated:validated.length,errors,
        cohort_tiers:cohortTierCounts,
        automatic_repair_eligible:validated.filter(row => row.automatic_repair_eligible === true).length,
        admin_review:rows.filter(row => String(row.repair_decision || '').startsWith('admin_review_')).length,
        protected:rows.filter(row => String(row.repair_decision || '').startsWith('protected_')).length,
        repair_decisions:repairDecisions,
        field_confirmed:fieldConfirmed.length,field_evidence_missing:rows.length-fieldConfirmed.length,
        old_to_google_meters:{median:percentile(0.5),p90:percentile(0.9),max:distances.at(-1) ?? null},
        moved_over_25m:validated.filter(row => Number(row.old_to_google_meters)>25).length,
        moved_over_50m:validated.filter(row => Number(row.old_to_google_meters)>50).length,
        moved_over_100m:validated.filter(row => Number(row.old_to_google_meters)>100).length,
        complete_addresses:validated.filter(row => row.address_complete === true).length,
        place_ids:validated.filter(row => Boolean(row.place_id)).length
      },
      rows
    })
  } catch(error) {
    console.error('address-validation-pilot failed', String(error?.message || error))
    return json({error:'address_validation_pilot_failed',detail:String(error?.message || error)},500)
  }
})
