// @ts-nocheck
import { createClient } from 'npm:@supabase/supabase-js@2.95.0'
import { corsHeaders } from 'npm:@supabase/supabase-js@2.95.0/cors'

const json=(body:any,status=200)=>new Response(JSON.stringify(body),{
  status,
  headers:{...corsHeaders,'Content-Type':'application/json','Cache-Control':'no-store'}
})

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders})
  try{
    if(req.method!=='POST')return json({error:'method_not_allowed'},405)
    const jwt=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/,'')
    if(!jwt)return json({error:'unauthorized'},401)
    const url=Deno.env.get('SUPABASE_URL')!
    const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}})
    const {data:{user},error:userError}=await admin.auth.getUser(jwt)
    if(userError||!user?.email)return json({error:'unauthorized'},401)
    const {data:access,error:accessError}=await admin.from('app_user_access')
      .select('role,active').eq('email',user.email.toLowerCase()).maybeSingle()
    if(accessError)throw accessError
    if(!access?.active||access.role!=='admin')return json({error:'admin_only'},403)

    const body=await req.json().catch(()=>({}))
    const action=String(body.action||'list')
    if(action==='list'){
      const {data,error}=await admin.from('leads').select(
        'id,address1,address2,city,state,zip,latitude,longitude,geocode_formatted_address,geocode_place_id,geocode_candidate_latitude,geocode_candidate_longitude,geocode_comparison_distance_meters,geocode_precision,geocode_verification_details,geocode_verified_at'
      ).eq('geocode_verification_status','address_validation_admin_review')
       .is('deleted_at',null)
       .order('geocode_comparison_distance_meters',{ascending:false})
       .limit(500)
      if(error)throw error
      return json({ok:true,rows:(data||[]).map((lead:any)=>({
        lead_id:lead.id,
        original_address:[lead.address1,lead.address2,lead.city,lead.state,lead.zip].filter(Boolean).join(', '),
        standardized_address:lead.geocode_formatted_address,
        old_latitude:lead.latitude,
        old_longitude:lead.longitude,
        google_latitude:lead.geocode_candidate_latitude,
        google_longitude:lead.geocode_candidate_longitude,
        distance_meters:lead.geocode_comparison_distance_meters,
        place_id:lead.geocode_place_id,
        precision:lead.geocode_precision,
        repair_decision:lead.geocode_verification_details?.repair_decision||lead.geocode_verification_details?.repair_reason||null,
        repair_reason:lead.geocode_verification_details?.repair_reason||null,
        possible_next_action:lead.geocode_verification_details?.possible_next_action||null,
        validation_granularity:lead.geocode_verification_details?.validation_granularity||null,
        geocode_granularity:lead.geocode_verification_details?.geocode_granularity||lead.geocode_precision||null,
        usps_dpv_confirmation:lead.geocode_verification_details?.usps_dpv_confirmation||null,
        address_complete:lead.geocode_verification_details?.address_complete??null,
        address_identity_match:lead.geocode_verification_details?.address_identity_match??null,
        has_inferred_components:lead.geocode_verification_details?.has_inferred_components===true,
        has_unconfirmed_components:lead.geocode_verification_details?.has_unconfirmed_components===true
      }))})
    }

    if(action==='decide'){
      const leadId=String(body.lead_id||'')
      const decision=String(body.decision||'')
      if(!/^[0-9a-f-]{36}$/i.test(leadId))return json({error:'valid_lead_id_required'},400)
      if(!['keep_original','apply_google_candidate'].includes(decision))return json({error:'invalid_decision'},400)
      const {data,error}=await admin.rpc('apply_address_validation_admin_review_decision',{
        p_actor_user_id:user.id,
        p_lead_id:leadId,
        p_decision:decision
      })
      if(error)throw error
      return json({ok:true,result:data})
    }

    return json({error:'unknown_action'},400)
  }catch(error){
    console.error('address-validation-admin-review failed',String(error?.message||error))
    return json({error:'address_validation_admin_review_failed',detail:String(error?.message||error)},500)
  }
})
