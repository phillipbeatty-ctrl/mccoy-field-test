import { createClient } from 'npm:@supabase/supabase-js@2.95.0'

type EdgeHandler=(request:Request)=>Response|Promise<Response>

const corsHeaders={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, GET, OPTIONS'
}

function json(body:unknown,status=200){
  return new Response(JSON.stringify(body),{
    status,
    headers:{...corsHeaders,'Content-Type':'application/json','Cache-Control':'no-store'}
  })
}

function denialReason(message:string){
  const match=String(message||'').match(/organization_access_denied:([a-z0-9_]+)/i)
  return match?.[1]||'organization_access_denied'
}

/**
 * Registers an Edge Function handler behind the shared organization billing and
 * entitlement gate. The wrapped handler still performs its own role, ownership,
 * organization, and action authorization; this guard only adds the paywall layer.
 */
export function serveWithOrganizationAccess(entitlement:string,handler:EdgeHandler){
  Deno.serve(async request=>{
    if(request.method==='OPTIONS')return handler(request)

    const jwt=(request.headers.get('Authorization')||'').replace(/^Bearer\s+/,'')
    if(!jwt)return json({error:'unauthorized'},401)

    const url=Deno.env.get('SUPABASE_URL')
    const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if(!url||!serviceKey)return json({error:'server_configuration_missing'},500)

    try{
      const admin=createClient(url,serviceKey,{
        auth:{persistSession:false,autoRefreshToken:false}
      })
      const {data:{user},error:userError}=await admin.auth.getUser(jwt)
      if(userError||!user)return json({error:'unauthorized'},401)

      const {data:state,error:accessError}=await admin.rpc('service_assert_organization_access',{
        p_auth_user_id:user.id,
        p_entitlement:entitlement
      })
      if(accessError){
        const reason=denialReason(accessError.message)
        return json({
          error:'organization_access_denied',
          reason,
          organization_access:{
            access_allowed:false,
            denial_reason:reason,
            entitlement_key:entitlement,
            purchase_model:'organization_managed_external',
            purchase_action_available:false
          }
        },403)
      }

      const enrichedHeaders=new Headers(request.headers)
      enrichedHeaders.set('x-field-coach-organization-access','verified')
      enrichedHeaders.set('x-field-coach-entitlement',entitlement)
      const verifiedRequest=new Request(request,{headers:enrichedHeaders})
      const response=await handler(verifiedRequest)
      response.headers.set('X-Field-Coach-Organization-Access','verified')
      return response
    }catch(error){
      console.error('organization paywall guard failed',error)
      return json({error:'organization_access_check_failed'},503)
    }
  })
}
