import { createClient } from 'npm:@supabase/supabase-js@2.95.0'

type EdgeHandler=(request:Request)=>Response|Promise<Response>
type ActionGuardOptions={
  defaultEntitlement:string
  exemptActions?:string[]
  actionEntitlements?:Record<string,string>
}

type AccessDecision={
  allowed:boolean
  status:number
  reason:string|null
  state:unknown
}

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
  return match?.[1]||null
}

export async function checkOrganizationAccess(
  admin:any,
  authUserId:string,
  entitlement:string
):Promise<AccessDecision>{
  const {data,error}=await admin.rpc('service_assert_organization_access',{
    p_auth_user_id:authUserId,
    p_entitlement:entitlement
  })
  if(!error)return {allowed:true,status:200,reason:null,state:data}

  const reason=denialReason(error.message)
  if(reason)return {allowed:false,status:403,reason,state:null}

  console.error('organization access RPC failed',error)
  return {allowed:false,status:503,reason:'organization_access_check_failed',state:null}
}

export function organizationAccessDenial(decision:AccessDecision,entitlement:string){
  const reason=decision.reason||'organization_access_denied'
  return json({
    error:decision.status===403?'organization_access_denied':'organization_access_check_failed',
    reason,
    organization_access:{
      access_allowed:false,
      denial_reason:reason,
      entitlement_key:entitlement,
      purchase_model:'organization_managed_external',
      purchase_action_available:false
    }
  },decision.status)
}

async function authenticatedUser(request:Request){
  const jwt=(request.headers.get('Authorization')||'').replace(/^Bearer\s+/,'')
  if(!jwt)return {response:json({error:'unauthorized'},401),admin:null,user:null}

  const url=Deno.env.get('SUPABASE_URL')
  const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if(!url||!serviceKey)return {response:json({error:'server_configuration_missing'},500),admin:null,user:null}

  const admin=createClient(url,serviceKey,{
    auth:{persistSession:false,autoRefreshToken:false}
  })
  const {data:{user},error:userError}=await admin.auth.getUser(jwt)
  if(userError||!user)return {response:json({error:'unauthorized'},401),admin:null,user:null}
  return {response:null,admin,user}
}

async function enforceAndHandle(request:Request,entitlement:string,handler:EdgeHandler){
  const identity=await authenticatedUser(request)
  if(identity.response)return identity.response

  const decision=await checkOrganizationAccess(identity.admin,identity.user.id,entitlement)
  if(!decision.allowed)return organizationAccessDenial(decision,entitlement)

  const enrichedHeaders=new Headers(request.headers)
  enrichedHeaders.set('x-field-coach-organization-access','verified')
  enrichedHeaders.set('x-field-coach-entitlement',entitlement)
  const verifiedRequest=new Request(request,{headers:enrichedHeaders})
  const response=await handler(verifiedRequest)

  // Some fetch-originated Responses expose immutable headers. Clone instead of
  // mutating so the paywall marker cannot turn a successful request into an error.
  const responseHeaders=new Headers(response.headers)
  responseHeaders.set('X-Field-Coach-Organization-Access','verified')
  responseHeaders.set('X-Field-Coach-Entitlement',entitlement)
  return new Response(response.body,{
    status:response.status,
    statusText:response.statusText,
    headers:responseHeaders
  })
}

/**
 * Registers an Edge Function behind the shared organization billing and
 * entitlement gate. The wrapped handler still performs role, ownership,
 * organization, and action authorization; this guard only adds the paywall.
 */
export function serveWithOrganizationAccess(entitlement:string,handler:EdgeHandler){
  Deno.serve(async request=>{
    if(request.method==='OPTIONS')return handler(request)
    try{
      return await enforceAndHandle(request,entitlement,handler)
    }catch(error){
      console.error('organization paywall guard failed',error)
      return json({error:'organization_access_check_failed'},503)
    }
  })
}

/**
 * Action-aware version for endpoints that must keep pre-membership account
 * recovery/onboarding actions available while protecting every business action.
 */
export function serveWithOrganizationAccessByAction(options:ActionGuardOptions,handler:EdgeHandler){
  const exempt=new Set(options.exemptActions||[])
  Deno.serve(async request=>{
    if(request.method==='OPTIONS')return handler(request)
    try{
      const payload=await request.clone().json().catch(()=>({})) as Record<string,unknown>
      const action=String(payload?.action||'').trim()
      if(exempt.has(action))return handler(request)
      const entitlement=options.actionEntitlements?.[action]||options.defaultEntitlement
      return await enforceAndHandle(request,entitlement,handler)
    }catch(error){
      console.error('action-aware organization paywall guard failed',error)
      return json({error:'organization_access_check_failed'},503)
    }
  })
}
