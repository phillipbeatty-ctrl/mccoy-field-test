// @ts-nocheck
import { createClient } from 'npm:@supabase/supabase-js@2.95.0'

const corsHeaders={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS'
}
const PROD_SITE_URL='https://mccoy-field-test.vercel.app'
const PROD_CONFIRM_URL=`${PROD_SITE_URL}/confirm-email.html`
const lower=value=>String(value||'').trim().toLowerCase()
const validEmail=value=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
const json=(body,status=200)=>new Response(JSON.stringify(body),{
  status,
  headers:{...corsHeaders,'Content-Type':'application/json','Cache-Control':'no-store'}
})
const genericAccepted=()=>json({
  ok:true,
  accepted:true,
  detail:'If this address has an unconfirmed McCoy account, a fresh confirmation was requested. Check inbox, spam, and junk.'
})

async function listAllAuthUsers(admin){
  const users=[]
  for(let page=1;page<=20;page++){
    const {data,error}=await admin.auth.admin.listUsers({page,perPage:1000})
    if(error)throw error
    const batch=data?.users||[]
    users.push(...batch)
    if(batch.length<1000)break
  }
  return users
}

async function resolveOrganization(admin,user,email){
  const {data:access,error:accessError}=await admin.from('app_user_access')
    .select('organization_id')
    .eq('email',email)
    .maybeSingle()
  if(accessError)throw accessError
  if(access?.organization_id)return access.organization_id

  const {data:membership,error:membershipError}=await admin.from('organization_memberships')
    .select('organization_id')
    .eq('auth_user_id',user.id)
    .eq('active',true)
    .order('is_default',{ascending:false})
    .limit(1)
    .maybeSingle()
  if(membershipError)throw membershipError
  if(membership?.organization_id)return membership.organization_id

  const {data:requestRow,error:requestError}=await admin.from('rep_access_requests')
    .select('id')
    .eq('user_id',user.id)
    .order('created_at',{ascending:false})
    .limit(1)
    .maybeSingle()
  if(requestError)throw requestError
  if(!requestRow)return null

  const {data:organization,error:organizationError}=await admin.from('organizations')
    .select('id')
    .eq('slug','mccoy-platform-llc')
    .maybeSingle()
  if(organizationError)throw organizationError
  return organization?.id||null
}

async function loadSettings(admin,organizationId){
  const {data,error}=await admin.from('auth_email_provider_settings')
    .select('provider,sender_email,site_url,confirmation_redirect_url,custom_smtp_active')
    .eq('organization_id',organizationId)
    .maybeSingle()
  if(error)throw error
  const siteReady=String(data?.site_url||'').replace(/\/$/,'')===PROD_SITE_URL
    &&String(data?.confirmation_redirect_url||'').startsWith(PROD_CONFIRM_URL)
  return {
    ...(data||{}),
    production_ready:Boolean(data?.custom_smtp_active&&data?.sender_email&&siteReady)
  }
}

async function enforceRateLimit(admin,organizationId,email){
  const now=Date.now()
  const minuteAgo=new Date(now-60_000).toISOString()
  const hourAgo=new Date(now-3_600_000).toISOString()
  const {data:recent,error:recentError}=await admin.from('auth_email_delivery_events')
    .select('created_at')
    .eq('organization_id',organizationId)
    .eq('target_email',email)
    .eq('event_type','confirmation_requested')
    .gte('created_at',minuteAgo)
    .order('created_at',{ascending:false})
    .limit(1)
  if(recentError)throw recentError
  if(recent?.length)return false
  const {count,error:countError}=await admin.from('auth_email_delivery_events')
    .select('id',{count:'exact',head:true})
    .eq('organization_id',organizationId)
    .eq('target_email',email)
    .eq('event_type','confirmation_requested')
    .gte('created_at',hourAgo)
  if(countError)throw countError
  return (count||0)<5
}

Deno.serve(async request=>{
  if(request.method==='OPTIONS')return new Response('ok',{headers:corsHeaders})
  if(request.method!=='POST')return json({error:'method_not_allowed'},405)
  try{
    const body=await request.json().catch(()=>({}))
    const email=lower(body.email)
    if(!validEmail(email))return genericAccepted()

    const url=Deno.env.get('SUPABASE_URL')
    const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if(!url||!serviceKey)return json({error:'server_configuration_missing'},500)
    const admin=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}})

    const users=await listAllAuthUsers(admin)
    const user=users.find(candidate=>lower(candidate.email)===email)
    if(!user||user.email_confirmed_at||user.confirmed_at)return genericAccepted()

    const organizationId=await resolveOrganization(admin,user,email)
    if(!organizationId)return genericAccepted()
    const settings=await loadSettings(admin,organizationId)
    if(!settings.production_ready){
      return json({
        error:'production_smtp_not_active',
        detail:'McCoy production confirmation email is not active. No resend was attempted.'
      },503)
    }
    if(!(await enforceRateLimit(admin,organizationId,email)))return genericAccepted()

    const redirectUrl=settings.confirmation_redirect_url||PROD_CONFIRM_URL
    const requestedAt=new Date().toISOString()
    const {error:resendError}=await admin.auth.resend({
      type:'signup',
      email,
      options:{emailRedirectTo:redirectUrl}
    })
    const {error:auditError}=await admin.from('auth_email_delivery_events').insert({
      organization_id:organizationId,
      auth_user_id:user.id,
      target_email:email,
      event_type:'confirmation_requested',
      status:resendError?'failed':'accepted_by_auth',
      provider:settings.provider||'supabase_auth',
      redirect_url:redirectUrl,
      request_source:'public_confirmation_page',
      detail:resendError?String(resendError.message||'Confirmation request failed.'):'Supabase Auth accepted a public confirmation resend request.',
      provider_payload:{source:'public_confirmation_page'},
      event_created_at:requestedAt,
      received_at:requestedAt
    })
    if(auditError)throw auditError
    return genericAccepted()
  }catch(error){
    console.error('auth-email-resend failed',error)
    return json({error:'confirmation_resend_unavailable'},500)
  }
})
