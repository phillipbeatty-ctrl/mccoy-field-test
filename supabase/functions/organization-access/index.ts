import { createClient } from 'npm:@supabase/supabase-js@2.95.0'
import { corsHeaders } from 'npm:@supabase/supabase-js@2.95.0/cors'

const ENTITLEMENTS=new Set([
  'field_coach_access',
  'lead_management',
  'sales_tracking',
  'provider_integrations',
  'rankings',
  'analytics',
  'native_background_location',
  'admin_controls'
])

function json(body:unknown,status=200){
  return new Response(JSON.stringify(body),{
    status,
    headers:{...corsHeaders,'Content-Type':'application/json','Cache-Control':'no-store'}
  })
}

Deno.serve(async request=>{
  if(request.method==='OPTIONS')return new Response('ok',{headers:corsHeaders})
  if(request.method!=='POST')return json({error:'method_not_allowed'},405)

  try{
    const jwt=(request.headers.get('Authorization')||'').replace(/^Bearer\s+/,'')
    if(!jwt)return json({error:'unauthorized'},401)

    const url=Deno.env.get('SUPABASE_URL')
    const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if(!url||!serviceKey)return json({error:'server_configuration_missing'},500)

    const admin=createClient(url,serviceKey,{
      auth:{persistSession:false,autoRefreshToken:false}
    })
    const {data:{user},error:userError}=await admin.auth.getUser(jwt)
    if(userError||!user)return json({error:'unauthorized'},401)

    const body=await request.json().catch(()=>({})) as Record<string,unknown>
    const action=String(body.action||'status')
    if(action!=='status')return json({error:'unknown_action'},400)

    const entitlement=String(body.entitlement||'field_coach_access').trim()
    if(!ENTITLEMENTS.has(entitlement))return json({error:'unsupported_entitlement'},400)

    const {data:state,error:stateError}=await admin.rpc('service_organization_access_state',{
      p_auth_user_id:user.id,
      p_entitlement:entitlement
    })
    if(stateError){
      console.error('organization access state failed',stateError)
      return json({error:'organization_access_check_failed'},500)
    }

    return json({
      ok:true,
      organization_access:state,
      entitlement
    })
  }catch(error){
    console.error('organization-access failed',error)
    return json({error:'organization_access_failed'},500)
  }
})
