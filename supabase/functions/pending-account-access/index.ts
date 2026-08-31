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
const json=(body,status=200)=>new Response(JSON.stringify(body),{
  status,
  headers:{...corsHeaders,'Content-Type':'application/json','Cache-Control':'no-store'}
})

async function listAllAuthUsers(admin){
  const users=[]
  for(let page=1;page<=20;page++){
    const {data,error}=await admin.auth.admin.listUsers({page,perPage:1000})
    if(error)throw error
    const pageUsers=data?.users||[]
    users.push(...pageUsers)
    if(pageUsers.length<1000)break
  }
  return users
}

async function loadProviderSettings(admin,organizationId){
  const {data,error}=await admin.from('auth_email_provider_settings')
    .select('provider,sender_email,sender_name,site_url,confirmation_redirect_url,custom_smtp_active,delivery_webhook_active,provider_webhook_id,provider_domain,last_verified_at,verification_detail,updated_at')
    .eq('organization_id',organizationId)
    .maybeSingle()
  if(error)throw error
  const settings=data||{
    provider:'unconfigured',
    sender_email:null,
    sender_name:null,
    site_url:PROD_SITE_URL,
    confirmation_redirect_url:PROD_CONFIRM_URL,
    custom_smtp_active:false,
    delivery_webhook_active:false,
    provider_webhook_id:null,
    provider_domain:null,
    last_verified_at:null,
    verification_detail:'Production SMTP has not been activated.'
  }
  const productionUrlReady=String(settings.site_url||'').replace(/\/$/,'')===PROD_SITE_URL
    &&String(settings.confirmation_redirect_url||'').startsWith(PROD_CONFIRM_URL)
  return {
    ...settings,
    production_url_ready:productionUrlReady,
    production_ready:Boolean(settings.custom_smtp_active&&settings.sender_email&&productionUrlReady),
    fully_observable:Boolean(settings.custom_smtp_active&&settings.delivery_webhook_active&&settings.sender_email&&productionUrlReady),
    activation_required:[
      !settings.custom_smtp_active?'custom_smtp':null,
      !settings.sender_email?'verified_sender':null,
      !productionUrlReady?'production_redirects':null,
      !settings.delivery_webhook_active?'delivery_webhook':null
    ].filter(Boolean)
  }
}

async function loadPendingAccounts(admin,caller){
  const authUsers=await listAllAuthUsers(admin)
  const authIds=authUsers.map(user=>String(user.id)).filter(Boolean)

  let accessQuery=admin.from('app_user_access')
    .select('email,display_name,role,active,created_at,organization_id')
  if(caller.organization_id)accessQuery=accessQuery.eq('organization_id',caller.organization_id)

  const requestsPromise=admin.from('rep_access_requests')
    .select('id,user_id,email,display_name,requested_role,requested_team,status,created_at,reviewed_at')
    .order('created_at',{ascending:false})

  const membershipsPromise=authIds.length
    ?admin.from('organization_memberships')
      .select('auth_user_id,organization_id,active,role')
      .in('auth_user_id',authIds)
    :Promise.resolve({data:[],error:null})

  const [{data:accessRows,error:accessError},{data:requestRows,error:requestError},{data:membershipRows,error:membershipError}]=await Promise.all([
    accessQuery,
    requestsPromise,
    membershipsPromise
  ])
  if(accessError)throw accessError
  if(requestError)throw requestError
  if(membershipError)throw membershipError

  const accessByEmail=new Map((accessRows||[]).map(row=>[lower(row.email),row]))
  const latestRequestByUser=new Map()
  for(const row of requestRows||[]){
    const key=String(row.user_id||'')
    if(key&&!latestRequestByUser.has(key))latestRequestByUser.set(key,row)
  }
  const membershipsByUser=new Map()
  for(const row of membershipRows||[]){
    const key=String(row.auth_user_id||'')
    if(!membershipsByUser.has(key))membershipsByUser.set(key,[])
    membershipsByUser.get(key).push(row)
  }

  const accounts=[]
  for(const account of authUsers){
    const email=lower(account.email)
    if(!email||account.is_anonymous||account.deleted_at)continue

    const access=accessByEmail.get(email)||null
    const request=latestRequestByUser.get(String(account.id))||null
    const memberships=membershipsByUser.get(String(account.id))||[]
    const belongsToCaller=Boolean(
      access
      ||memberships.some(row=>row.active&&String(row.organization_id)===String(caller.organization_id))
      ||(request&&memberships.every(row=>!row.active))
    )
    if(!belongsToCaller)continue

    const emailConfirmedAt=account.email_confirmed_at||account.confirmed_at||null
    const requestPending=request?.status==='pending'
    const accessActive=access?.active===true
    if(emailConfirmedAt&&accessActive&&!requestPending)continue

    const metadata=account.user_metadata||{}
    const metadataName=String(
      metadata.full_name
      ||metadata.display_name
      ||metadata.name
      ||[metadata.first_name,metadata.last_name].filter(Boolean).join(' ')
      ||''
    ).trim()
    const name=String(request?.display_name||access?.display_name||metadataName||email).trim()
    const accessState=!emailConfirmedAt
      ?'email_unconfirmed'
      :requestPending
        ?'approval_requested'
        :access
          ?'access_inactive'
          :'no_access_record'

    accounts.push({
      email,
      display_name:name,
      role:access?.role||request?.requested_role||'rep',
      account_created_at:account.created_at||null,
      confirmation_sent_at:account.confirmation_sent_at||null,
      email_confirmed_at:emailConfirmedAt,
      last_sign_in_at:account.last_sign_in_at||null,
      access_state:accessState,
      access_active:accessActive,
      requires_access_grant:!accessActive,
      waiting_for_email_confirmation:!emailConfirmedAt,
      auth_user_id:String(account.id),
      request:request?{
        id:request.id,
        status:request.status,
        requested_role:request.requested_role,
        requested_team:request.requested_team,
        created_at:request.created_at,
        reviewed_at:request.reviewed_at
      }:null
    })
  }

  const emails=accounts.map(account=>account.email)
  const latestByEmail=new Map()
  if(emails.length){
    const {data:events,error:eventsError}=await admin.from('auth_email_delivery_events')
      .select('target_email,event_type,status,provider,provider_message_id,detail,event_created_at,received_at,created_at')
      .eq('organization_id',caller.organization_id)
      .in('target_email',emails)
      .order('created_at',{ascending:false})
      .limit(Math.max(100,emails.length*20))
    if(eventsError)throw eventsError
    for(const event of events||[]){
      const email=lower(event.target_email)
      if(email&&!latestByEmail.has(email))latestByEmail.set(email,event)
    }
  }

  for(const account of accounts){
    account.delivery=latestByEmail.get(account.email)||null
  }
  accounts.sort((left,right)=>String(right.account_created_at||'').localeCompare(String(left.account_created_at||'')))
  return accounts
}

async function enforceResendRateLimit(admin,organizationId,targetEmail){
  const now=Date.now()
  const minuteAgo=new Date(now-60_000).toISOString()
  const hourAgo=new Date(now-3_600_000).toISOString()
  const {data:recent,error:recentError}=await admin.from('auth_email_delivery_events')
    .select('created_at')
    .eq('organization_id',organizationId)
    .eq('target_email',targetEmail)
    .eq('event_type','confirmation_requested')
    .gte('created_at',minuteAgo)
    .order('created_at',{ascending:false})
    .limit(1)
  if(recentError)throw recentError
  if(recent?.length){
    const retryAfter=Math.max(1,60-Math.floor((now-new Date(recent[0].created_at).getTime())/1000))
    return {allowed:false,retry_after_seconds:retryAfter,reason:'confirmation_resend_too_soon'}
  }
  const {count,error:countError}=await admin.from('auth_email_delivery_events')
    .select('id',{count:'exact',head:true})
    .eq('organization_id',organizationId)
    .eq('target_email',targetEmail)
    .eq('event_type','confirmation_requested')
    .gte('created_at',hourAgo)
  if(countError)throw countError
  if((count||0)>=5)return {allowed:false,retry_after_seconds:3600,reason:'confirmation_resend_hourly_limit'}
  return {allowed:true}
}

Deno.serve(async request=>{
  if(request.method==='OPTIONS')return new Response('ok',{headers:corsHeaders})
  if(request.method!=='POST')return json({error:'method_not_allowed'},405)
  try{
    const authorization=request.headers.get('Authorization')||''
    const jwt=authorization.replace(/^Bearer\s+/,'')
    if(!jwt)return json({error:'unauthorized'},401)

    const url=Deno.env.get('SUPABASE_URL')
    const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if(!url||!serviceKey)return json({error:'server_configuration_missing'},500)
    const admin=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}})
    const {data:{user},error:userError}=await admin.auth.getUser(jwt)
    if(userError||!user?.email)return json({error:'unauthorized'},401)

    const callerEmail=lower(user.email)
    const {data:caller,error:callerError}=await admin.from('app_user_access')
      .select('email,display_name,role,active,organization_id')
      .eq('email',callerEmail)
      .maybeSingle()
    if(callerError)throw callerError
    if(!caller?.active||caller.role!=='admin')return json({error:'admin_only'},403)

    const body=await request.json().catch(()=>({}))
    const action=String(body.action||'list')
    const providerSettings=await loadProviderSettings(admin,caller.organization_id)

    if(action==='list'){
      const accounts=await loadPendingAccounts(admin,caller)
      return json({
        ok:true,
        accounts,
        count:accounts.length,
        mail_configuration:providerSettings,
        generated_at:new Date().toISOString()
      })
    }

    if(action==='resend_confirmation'){
      const targetEmail=lower(body.email)
      if(!targetEmail)return json({error:'email_required'},400)
      if(!providerSettings.production_ready){
        return json({
          error:'production_smtp_not_active',
          detail:'Confirmation delivery is disabled until the verified production SMTP sender and production Auth URLs are activated.',
          mail_configuration:providerSettings
        },503)
      }

      const accounts=await loadPendingAccounts(admin,caller)
      const target=accounts.find(account=>account.email===targetEmail)
      if(!target)return json({error:'pending_account_not_found'},404)
      if(!target.waiting_for_email_confirmation)return json({error:'email_already_confirmed'},409)

      const rateLimit=await enforceResendRateLimit(admin,caller.organization_id,targetEmail)
      if(!rateLimit.allowed)return json({error:rateLimit.reason,retry_after_seconds:rateLimit.retry_after_seconds},429)

      const redirectUrl=providerSettings.confirmation_redirect_url||PROD_CONFIRM_URL
      const requestedAt=new Date().toISOString()
      const {error:resendError}=await admin.auth.resend({
        type:'signup',
        email:targetEmail,
        options:{emailRedirectTo:redirectUrl}
      })

      const event={
        organization_id:caller.organization_id,
        auth_user_id:target.auth_user_id,
        target_email:targetEmail,
        event_type:'confirmation_requested',
        status:resendError?'failed':'accepted_by_auth',
        provider:providerSettings.provider||'supabase_auth',
        requested_by_email:callerEmail,
        redirect_url:redirectUrl,
        detail:resendError?String(resendError.message||'Confirmation request failed.'):'Supabase Auth accepted a new signup-confirmation request. Provider delivery events are tracked separately.',
        provider_payload:{source:'admin_pending_access',custom_smtp_active:providerSettings.custom_smtp_active},
        event_created_at:requestedAt,
        received_at:requestedAt
      }
      const {error:auditError}=await admin.from('auth_email_delivery_events').insert(event)
      if(auditError)throw auditError
      if(resendError)return json({error:'confirmation_resend_failed',detail:resendError.message},502)

      return json({
        ok:true,
        accepted:true,
        email:targetEmail,
        requested_at:requestedAt,
        status:'accepted_by_auth',
        detail:'A fresh confirmation was accepted by Supabase Auth. Delivery, bounce, delay, and complaint events will appear as the provider reports them.'
      })
    }

    return json({error:'unknown_action'},400)
  }catch(error){
    console.error('pending-account-access failed',error)
    return json({error:'pending_account_access_failed'},500)
  }
})
