import { serveWithOrganizationAccess } from '../_shared/organization-paywall.ts'
// @ts-nocheck
import { createClient } from 'npm:@supabase/supabase-js@2.95.0'
import { corsHeaders } from 'npm:@supabase/supabase-js@2.95.0/cors'
import { Client as GoogleMapsClient } from 'npm:@googlemaps/google-maps-services-js@3.4.2'
import {
  GOOGLE_PROVIDER,
  LOW_PRECISION_STATUSES,
  googleResultAssessment,
  leadAddress,
  normalizedStatus
} from '../_shared/lead-geocode-core.mjs'

const json=(body:any,status=200)=>new Response(JSON.stringify(body),{
  status,headers:{...corsHeaders,'Content-Type':'application/json','Cache-Control':'no-store'}
})
const maps=new GoogleMapsClient({})
function addressInput(body:any){
  return {
    address1:String(body.address1||'').trim(),address2:String(body.address2||'').trim(),
    city:String(body.city||'').trim(),state:String(body.state||'').trim().toUpperCase(),
    zip:String(body.zip||'').trim()
  }
}

serveWithOrganizationAccess('lead_management',async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders})
  try{
    const jwt=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/,'')
    if(!jwt)return json({error:'unauthorized'},401)
    const url=Deno.env.get('SUPABASE_URL')!,service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const googleKey=Deno.env.get('GOOGLE_MAPS_API_KEY')||''
    const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}})
    const {data:{user},error:userError}=await admin.auth.getUser(jwt)
    if(userError||!user?.email)return json({error:'unauthorized'},401)
    const {data:access,error:accessError}=await admin.from('app_user_access').select('role,active').eq('email',user.email.toLowerCase()).maybeSingle()
    if(accessError)throw accessError
    if(!access?.active||access.role!=='admin')return json({error:'admin_only'},403)

    const body=await req.json().catch(()=>({}))
    const action=String(body.action||'status')
    const {data:batches,error:batchError}=await admin.from('spotio_import_batches').select('id,created_at,status,raw_payload').eq('status','normalized').order('created_at',{ascending:false}).limit(100)
    if(batchError)throw batchError
    const normalized=batches||[]
    const canonicalSpotio=normalized.find((batch:any)=>String(batch?.raw_payload?.source_type||'')==='spotio_json')
    const csvBatches=normalized.filter((batch:any)=>String(batch?.raw_payload?.source_type||'')==='csv')
    const selectedIds=[canonicalSpotio?.id,...csvBatches.map((batch:any)=>batch.id)].filter(Boolean)

    const pool=(query:any)=>{
      query=query.is('deleted_at',null).not('source_system','ilike','%demo%')
      return selectedIds.length
        ?query.or(`import_batch_id.in.(${selectedIds.join(',')}),source_system.eq.FIELD_ENTRY`)
        :query.eq('source_system','FIELD_ENTRY')
    }
    const count=async(configure:(query:any)=>any)=>{
      const {count,error}=await configure(pool(admin.from('leads').select('id',{head:true,count:'exact'})))
      if(error)throw error
      return Number(count||0)
    }
    const stats=async()=>{
      const [total,mapped,googleVerified,preserved,review,pending]=await Promise.all([
        count(q=>q),
        count(q=>q.not('latitude','is',null).not('longitude','is',null)),
        count(q=>q.in('geocode_verification_status',['google_rooftop_applied','google_address_validation_applied'])),
        count(q=>q.in('geocode_verification_status',['google_verified_preserved','google_conflict_preserved','google_low_precision_preserved'])),
        count(q=>q.in('geocode_verification_status',['google_low_precision','google_address_mismatch','google_no_match','google_invalid_location','google_api_error','address_validation_admin_review'])),
        count(q=>q.or('geocode_verification_status.is.null,geocode_verification_status.in.(pending_google,trusted_pending_google_comparison,google_in_progress)'))
      ])
      return {
        batch_id:csvBatches[0]?.id||canonicalSpotio?.id||null,batch_ids:selectedIds,total,mapped,
        geocoded:mapped,google_verified:googleVerified,preserved,review,pending,remaining:pending,
        unmapped:Math.max(0,total-mapped),google_configured:Boolean(googleKey),
        complete:total>0&&pending===0
      }
    }
    if(action==='status')return json({ok:true,...await stats()})
    if(!googleKey)return json({error:'google_maps_key_not_configured',detail:'Admin must configure the server-only GOOGLE_MAPS_API_KEY Edge Function secret.'},503)

    const claimOne=async(leadId:string)=>{
      const now=new Date().toISOString()
      const {data,error}=await pool(admin.from('leads').update({
        geocode_verification_status:'google_in_progress',geocode_verification_claimed_at:now,
        geocode_verification_claimed_by:user.id
      }).eq('id',leadId)).select('id,address1,address2,city,state,zip,latitude,longitude,geocode_status,geocode_verification_status').maybeSingle()
      if(error)throw error
      return data
    }
    const releaseClaim=async(leadId:string,status='google_api_error')=>{
      await admin.from('leads').update({
        geocode_verification_status:status,geocode_verification_claimed_at:null,
        geocode_verification_claimed_by:null,geocode_verification_details:{reason:status}
      }).eq('id',leadId).eq('geocode_verification_claimed_by',user.id)
    }

    const verify=async(lead:any,addressUpdate:any=null)=>{
      const candidate={...lead,...(addressUpdate||{})}
      let firstResult:any=null
      try{
        const response=await maps.geocode({
          params:{address:leadAddress(candidate),region:'us',key:googleKey},timeout:10000
        })
        firstResult=response.data?.results?.[0]||null
      }catch(error){
        await releaseClaim(lead.id)
        throw error
      }
      const assessment=googleResultAssessment(candidate,firstResult)
      const applyCoordinates=assessment.decision==='google_rooftop_applied'&&Boolean(assessment.location)
      const clearCoordinates=Boolean(addressUpdate)||(
        !assessment.trusted&&LOW_PRECISION_STATUSES.has(normalizedStatus(lead.geocode_status))&&!applyCoordinates
      )
      const details={reason:assessment.reason,address_match:assessment.addressMatch,checks:assessment.checks||{}}
      const {data:updated,error:updateError}=await admin.rpc('apply_google_geocode_decision',{
        p_lead_id:lead.id,p_actor_user_id:user.id,p_provider:GOOGLE_PROVIDER,
        p_precision:assessment.precision,p_formatted_address:assessment.formattedAddress,
        p_place_id:assessment.placeId,p_decision:assessment.decision,
        p_comparison_distance_meters:assessment.distanceMeters,p_details:details,
        p_candidate_latitude:assessment.location?.latitude??null,p_candidate_longitude:assessment.location?.longitude??null,
        p_apply_coordinates:applyCoordinates,p_clear_coordinates:clearCoordinates,
        p_address_update:addressUpdate||{}
      })
      if(updateError)throw updateError
      return {lead:updated,assessment}
    }

    if(action==='correct_address_location'||action==='verify_lead'){
      const leadId=String(body.lead_id||'')
      if(!leadId)return json({error:'lead_id_required'},400)
      let updatedAddress=null
      if(action==='correct_address_location'){
        updatedAddress=addressInput(body)
        if(!updatedAddress.address1||!updatedAddress.city||!updatedAddress.state||!updatedAddress.zip)return json({error:'complete_address_required'},400)
        if(!/^[A-Z]{2}$/.test(updatedAddress.state)||!/^\d{5}(?:-\d{4})?$/.test(updatedAddress.zip))return json({error:'invalid_address_region'},400)
      }
      const existing=await claimOne(leadId)
      if(!existing)return json({error:'lead_not_in_live_pool'},404)
      let verified
      try{verified=await verify(existing,updatedAddress)}catch(error){await releaseClaim(leadId);throw error}
      return json({
        ok:true,matched:verified.assessment.decision==='google_rooftop_applied',
        decision:verified.assessment.decision,precision:verified.assessment.precision,
        lead:verified.lead
      })
    }

    if(!['verify_next','geocode_next','resolve_missing_locations'].includes(action))return json({error:'unknown_action'},400)
    const limit=Math.min(Math.max(Math.floor(Number(body.limit)||25),1),25)
    const {data:rows,error:claimError}=await admin.rpc('claim_leads_for_google_verification',{
      p_batch_ids:selectedIds,p_limit:limit,p_actor_user_id:user.id
    })
    if(claimError)throw claimError
    let applied=0,preserved=0,review=0,failed=0
    const decisions:Record<string,number>={}
    for(const row of rows||[]){
      try{
        const verified=await verify(row)
        const decision=verified.assessment.decision
        decisions[decision]=(decisions[decision]||0)+1
        if(decision==='google_rooftop_applied')applied++
        else if(decision.includes('preserved'))preserved++
        else review++
      }catch(error){
        failed++
        await releaseClaim(row.id)
        console.error('Google lead verification failed',{lead_id:row.id,error:String(error?.message||error)})
      }
    }
    return json({ok:true,processed:(rows||[]).length,applied,preserved,review,failed,decisions,...await stats()})
  }catch(error){
    console.error('lead-geocode failed',String(error?.message||error))
    return json({error:'lead_geocode_failed',detail:String(error?.message||error)},500)
  }
})
