// @ts-nocheck
import { createClient } from 'npm:@supabase/supabase-js@2.95.0'

const json=(body,status=200)=>new Response(JSON.stringify(body),{
  status,
  headers:{'Content-Type':'application/json','Cache-Control':'no-store'}
})
const lower=value=>String(value||'').trim().toLowerCase()
const encoder=new TextEncoder()

function decodeBase64(value){
  const normalized=String(value||'').replace(/-/g,'+').replace(/_/g,'/');
  const padded=normalized.padEnd(Math.ceil(normalized.length/4)*4,'=');
  const binary=atob(padded);
  return Uint8Array.from(binary,character=>character.charCodeAt(0));
}
function encodeBase64(value){
  let binary=''
  for(const byte of value)binary+=String.fromCharCode(byte)
  return btoa(binary)
}
function timingSafeEqual(left,right){
  const a=encoder.encode(String(left||''))
  const b=encoder.encode(String(right||''))
  if(a.length!==b.length)return false
  let difference=0
  for(let index=0;index<a.length;index++)difference|=a[index]^b[index]
  return difference===0
}
async function verifyStandardWebhook(rawBody,headers,secret){
  const messageId=headers.get('svix-id')||headers.get('webhook-id')||''
  const timestamp=headers.get('svix-timestamp')||headers.get('webhook-timestamp')||''
  const signatures=headers.get('svix-signature')||headers.get('webhook-signature')||''
  if(!messageId||!timestamp||!signatures||!secret?.startsWith('whsec_'))return {ok:false,error:'missing_webhook_signature'}
  const timestampSeconds=Number(timestamp)
  if(!Number.isFinite(timestampSeconds)||Math.abs(Date.now()/1000-timestampSeconds)>300)return {ok:false,error:'stale_webhook_timestamp'}

  let secretBytes
  try{secretBytes=decodeBase64(secret.slice(6))}catch(_error){return {ok:false,error:'invalid_webhook_secret'}}
  const key=await crypto.subtle.importKey('raw',secretBytes,{name:'HMAC',hash:'SHA-256'},false,['sign'])
  const signedPayload=`${messageId}.${timestamp}.${rawBody}`
  const digest=new Uint8Array(await crypto.subtle.sign('HMAC',key,encoder.encode(signedPayload)))
  const expected=encodeBase64(digest)
  const valid=signatures.split(/\s+/).some(item=>{
    const [version,value]=item.split(',',2)
    return version==='v1'&&timingSafeEqual(value,expected)
  })
  return {ok:valid,error:valid?null:'invalid_webhook_signature',messageId,timestampSeconds}
}

function normalizeEventType(type){
  const map={
    'email.sent':'sent',
    'email.delivered':'delivered',
    'email.delivery_delayed':'delivery_delayed',
    'email.bounced':'bounced',
    'email.complained':'complained',
    'email.suppressed':'suppressed',
    'email.failed':'failed',
    'email.opened':'opened',
    'email.clicked':'clicked'
  }
  return map[String(type||'')]||null
}
function eventDetail(payload){
  const data=payload?.data||{}
  const details=data.bounce||data.failed||data.delivery_delayed||data.suppressed||null
  if(!details)return null
  try{return JSON.stringify(details)}catch(_error){return String(details)}
}

Deno.serve(async request=>{
  if(request.method!=='POST')return json({error:'method_not_allowed'},405)
  try{
    const secret=Deno.env.get('MCCOY_EMAIL_WEBHOOK_SECRET')||''
    if(!secret)return json({error:'email_webhook_not_configured'},503)
    const rawBody=await request.text()
    const verification=await verifyStandardWebhook(rawBody,request.headers,secret)
    if(!verification.ok)return json({error:verification.error},401)

    const payload=JSON.parse(rawBody)
    const eventType=normalizeEventType(payload?.type)
    if(!eventType)return json({ok:true,ignored:true,reason:'unsupported_event_type'})

    const url=Deno.env.get('SUPABASE_URL')
    const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if(!url||!serviceKey)return json({error:'server_configuration_missing'},500)
    const admin=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}})

    const providerEventId=verification.messageId
    const data=payload?.data||{}
    const recipients=(Array.isArray(data.to)?data.to:[data.to]).map(lower).filter(Boolean)
    const providerMessageId=String(data.email_id||data.id||'').trim()||null
    let stored=0
    let ignored=0
    const touchedOrganizations=new Set()

    for(const targetEmail of recipients){
      const {data:existing,error:existingError}=await admin.from('auth_email_delivery_events')
        .select('id')
        .eq('provider_event_id',providerEventId)
        .eq('target_email',targetEmail)
        .maybeSingle()
      if(existingError)throw existingError
      if(existing){ignored++;continue}

      let organizationId=null
      let authUserId=null

      const {data:prior,error:priorError}=await admin.from('auth_email_delivery_events')
        .select('organization_id,auth_user_id')
        .eq('target_email',targetEmail)
        .order('created_at',{ascending:false})
        .limit(1)
        .maybeSingle()
      if(priorError)throw priorError
      if(prior){
        organizationId=prior.organization_id
        authUserId=prior.auth_user_id
      }else{
        const {data:access,error:accessError}=await admin.from('app_user_access')
          .select('organization_id')
          .eq('email',targetEmail)
          .maybeSingle()
        if(accessError)throw accessError
        organizationId=access?.organization_id||null
      }

      if(!organizationId){ignored++;continue}
      const createdAt=payload.created_at||data.created_at||new Date().toISOString()
      const event={
        organization_id:organizationId,
        auth_user_id:authUserId,
        target_email:targetEmail,
        event_type:eventType,
        status:eventType,
        provider:'resend',
        provider_message_id:providerMessageId,
        provider_event_id:providerEventId,
        detail:eventDetail(payload),
        provider_payload:payload,
        request_source:'resend_webhook',
        event_created_at:createdAt,
        received_at:new Date().toISOString()
      }
      const {error:insertError}=await admin.from('auth_email_delivery_events').insert(event)
      if(insertError){
        if(insertError.code==='23505')return json({ok:true,duplicate:true})
        throw insertError
      }
      stored++
      touchedOrganizations.add(String(organizationId))
    }

    for(const organizationId of touchedOrganizations){
      const {error:updateError}=await admin.from('auth_email_provider_settings')
        .update({
          provider:'resend',
          delivery_webhook_active:true,
          last_verified_at:new Date().toISOString(),
          verification_detail:`Verified Resend webhook event received: ${payload.type}`,
          updated_at:new Date().toISOString()
        })
        .eq('organization_id',organizationId)
      if(updateError)throw updateError
    }

    return json({ok:true,stored,ignored,event_type:eventType})
  }catch(error){
    console.error('auth-email-provider-webhook failed',error)
    return json({error:'email_webhook_processing_failed'},500)
  }
})
