#!/usr/bin/env node
import { promises as dns } from 'node:dns';
import { chmod, readFile, writeFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';

const PROJECT_REF='athxxrfqxwlfnuvbqadp';
const SUPABASE_URL=`https://${PROJECT_REF}.supabase.co`;
const PROD_SITE_URL='https://mccoy-field-test.vercel.app';
const PROD_CONFIRM_URL=`${PROD_SITE_URL}/confirm-email.html`;
const WEBHOOK_ENDPOINT=`${SUPABASE_URL}/functions/v1/auth-email-provider-webhook`;
const ORGANIZATION_SLUG='mccoy-platform-llc';
const WEBHOOK_EVENTS=[
  'email.sent',
  'email.delivered',
  'email.delivery_delayed',
  'email.bounced',
  'email.complained',
  'email.suppressed',
  'email.failed',
  'email.opened',
  'email.clicked'
];
const CONTEXT_FILE=process.env.MCCOY_EMAIL_CONTEXT_FILE||'/tmp/mccoy-auth-email-context.json';
const SECRET_FILE=process.env.MCCOY_EMAIL_WEBHOOK_SECRET_FILE||'/tmp/mccoy-auth-email-webhook-secret';
const RESULT_FILE=process.env.MCCOY_EMAIL_RESULT_FILE||'/tmp/mccoy-auth-email-activation.json';

function required(name){
  const value=String(process.env[name]||'').trim();
  if(!value)throw new Error(`Missing required environment variable: ${name}`);
  return value;
}
function lower(value){return String(value||'').trim().toLowerCase();}
function validEmail(value){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);}
function senderDomain(email){return lower(email).split('@').pop()||'';}
function normalizeList(value){
  if(Array.isArray(value))return value;
  if(Array.isArray(value?.data))return value.data;
  return [];
}
async function requestJson(url,{method='GET',headers={},body}={}){
  const response=await fetch(url,{
    method,
    headers:{Accept:'application/json',...headers,...(body?{'Content-Type':'application/json'}:{})},
    body:body?JSON.stringify(body):undefined
  });
  const text=await response.text();
  let data={};
  try{data=text?JSON.parse(text):{};}catch{data={raw:text};}
  if(!response.ok){
    const detail=data?.message||data?.error||data?.detail||`${response.status} ${response.statusText}`;
    throw new Error(`${method} ${url} failed: ${detail}`);
  }
  return data;
}
async function resendRequest(path,options={}){
  const apiKey=required('RESEND_API_KEY');
  return requestJson(`https://api.resend.com${path}`,{
    ...options,
    headers:{Authorization:`Bearer ${apiKey}`,...options.headers}
  });
}
async function managementRequest(path,options={}){
  const token=required('SUPABASE_ACCESS_TOKEN');
  return requestJson(`https://api.supabase.com${path}`,{
    ...options,
    headers:{Authorization:`Bearer ${token}`,...options.headers}
  });
}
async function findDmarc(domain){
  const labels=domain.split('.').filter(Boolean);
  const candidates=[domain];
  if(labels.length>2)candidates.push(labels.slice(1).join('.'));
  for(const candidate of [...new Set(candidates)]){
    try{
      const records=await dns.resolveTxt(`_dmarc.${candidate}`);
      const value=records.map(parts=>parts.join('')).find(record=>/^v=DMARC1\b/i.test(record));
      if(value)return {domain:candidate,record:value};
    }catch(_error){}
  }
  return null;
}
function domainVerified(domain){
  return String(domain?.status||'').toLowerCase()==='verified';
}
async function prepare(){
  const fromEmail=lower(required('MCCOY_AUTH_FROM_EMAIL'));
  if(!validEmail(fromEmail))throw new Error('MCCOY_AUTH_FROM_EMAIL must be a valid email address.');
  const fromDomain=senderDomain(fromEmail);

  const domainResponse=await resendRequest('/domains');
  const domains=normalizeList(domainResponse);
  const exactDomain=domains.find(domain=>lower(domain.name)===fromDomain);
  if(!exactDomain)throw new Error(`Resend does not contain the exact sending domain ${fromDomain}. Add and verify it before activation.`);
  if(!domainVerified(exactDomain))throw new Error(`Resend domain ${fromDomain} is not verified (status: ${exactDomain.status||'unknown'}). SPF and DKIM must pass first.`);
  const dmarc=await findDmarc(fromDomain);
  if(!dmarc)throw new Error(`No DMARC TXT record was found for ${fromDomain} or its parent domain.`);

  const webhookResponse=await resendRequest('/webhooks');
  const existingWebhooks=normalizeList(webhookResponse);
  const previousWebhookIds=existingWebhooks
    .filter(webhook=>String(webhook.endpoint||webhook.url||'')===WEBHOOK_ENDPOINT)
    .map(webhook=>String(webhook.id||'')).filter(Boolean);

  const createdResponse=await resendRequest('/webhooks',{
    method:'POST',
    body:{endpoint:WEBHOOK_ENDPOINT,events:WEBHOOK_EVENTS}
  });
  const created=createdResponse?.data||createdResponse;
  const webhookId=String(created?.id||'').trim();
  const signingSecret=String(created?.signing_secret||created?.signingSecret||'').trim();
  if(!webhookId)throw new Error('Resend did not return a webhook ID.');
  if(!signingSecret.startsWith('whsec_'))throw new Error('Resend did not return a Standard Webhooks signing secret.');

  const context={
    prepared_at:new Date().toISOString(),
    sender_email:fromEmail,
    sender_domain:fromDomain,
    resend_domain_id:String(exactDomain.id||''),
    resend_webhook_id:webhookId,
    previous_webhook_ids:previousWebhookIds.filter(id=>id!==webhookId),
    webhook_endpoint:WEBHOOK_ENDPOINT,
    dmarc_domain:dmarc.domain,
    dmarc_present:true
  };
  await writeFile(CONTEXT_FILE,JSON.stringify(context,null,2),{mode:0o600});
  await writeFile(SECRET_FILE,`${signingSecret}\n`,{mode:0o600});
  await chmod(CONTEXT_FILE,0o600);
  await chmod(SECRET_FILE,0o600);
  console.log(JSON.stringify({
    ok:true,
    phase:'prepared',
    sender_domain:fromDomain,
    resend_domain_verified:true,
    dmarc_present:true,
    webhook_created:true,
    previous_webhooks_to_retire:context.previous_webhook_ids.length
  },null,2));
}

function confirmationTemplate(){
  return [
    '<h2>Confirm your McCoy email address</h2>',
    '<p>Confirm this email address to finish creating your McCoy account.</p>',
    '<p><a href="{{ .SiteURL }}/confirm-email.html?token_hash={{ .TokenHash }}&type=email&next=/">Confirm email address</a></p>',
    '<p>Or enter this one-time code on the McCoy confirmation page:</p>',
    '<p style="font-size:24px;font-weight:700;letter-spacing:4px">{{ .Token }}</p>',
    '<p>This confirmation is single-use. McCoy will never ask you to send this code to another person.</p>'
  ].join('');
}
async function listAllUsers(client){
  const users=[];
  for(let page=1;page<=20;page++){
    const {data,error}=await client.auth.admin.listUsers({page,perPage:1000});
    if(error)throw error;
    const batch=data?.users||[];
    users.push(...batch);
    if(batch.length<1000)break;
  }
  return users;
}
async function activate(){
  const fromEmail=lower(required('MCCOY_AUTH_FROM_EMAIL'));
  const senderName=String(process.env.MCCOY_AUTH_SENDER_NAME||'McCoy Platform').trim()||'McCoy Platform';
  const serviceRole=required('SUPABASE_SERVICE_ROLE_KEY');
  const context=JSON.parse(await readFile(CONTEXT_FILE,'utf8'));
  if(context.sender_email!==fromEmail)throw new Error('Prepared sender does not match MCCOY_AUTH_FROM_EMAIL.');

  const authConfig={
    site_url:PROD_SITE_URL,
    uri_allow_list:`${PROD_SITE_URL}/**,${PROD_CONFIRM_URL}`,
    external_email_enabled:true,
    mailer_autoconfirm:false,
    mailer_secure_email_change_enabled:true,
    smtp_admin_email:fromEmail,
    smtp_sender_name:senderName,
    smtp_host:'smtp.resend.com',
    smtp_port:'465',
    smtp_user:'resend',
    smtp_pass:required('RESEND_API_KEY'),
    mailer_subjects_confirmation:'Confirm your McCoy email address',
    mailer_templates_confirmation_content:confirmationTemplate()
  };
  await managementRequest(`/v1/projects/${PROJECT_REF}/config/auth`,{method:'PATCH',body:authConfig});
  const verifiedConfig=await managementRequest(`/v1/projects/${PROJECT_REF}/config/auth`);
  if(String(verifiedConfig.site_url||'').replace(/\/$/,'')!==PROD_SITE_URL)throw new Error('Supabase Site URL verification failed after activation.');
  if(!String(verifiedConfig.uri_allow_list||'').includes(PROD_CONFIRM_URL))throw new Error('Supabase redirect allow-list verification failed after activation.');
  if(String(verifiedConfig.smtp_host||'')!=='smtp.resend.com')throw new Error('Supabase custom SMTP verification failed after activation.');
  if(String(verifiedConfig.smtp_port||'')!=='465')throw new Error('Supabase SMTP port verification failed after activation.');

  const admin=createClient(SUPABASE_URL,serviceRole,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:organization,error:organizationError}=await admin.from('organizations')
    .select('id')
    .eq('slug',ORGANIZATION_SLUG)
    .single();
  if(organizationError)throw organizationError;

  const activatedAt=new Date().toISOString();
  const {error:settingsError}=await admin.from('auth_email_provider_settings').upsert({
    organization_id:organization.id,
    provider:'resend',
    sender_email:fromEmail,
    sender_name:senderName,
    site_url:PROD_SITE_URL,
    confirmation_redirect_url:PROD_CONFIRM_URL,
    custom_smtp_active:true,
    delivery_webhook_active:false,
    provider_webhook_id:context.resend_webhook_id,
    provider_domain:context.sender_domain,
    custom_smtp_activated_at:activatedAt,
    webhook_configured_at:activatedAt,
    last_verified_at:activatedAt,
    verification_detail:'Resend SMTP and production Auth URLs activated. Waiting for the first signed provider delivery event.',
    updated_at:activatedAt
  },{onConflict:'organization_id'});
  if(settingsError)throw settingsError;

  // Give the Auth service a brief propagation window before sending fresh confirmations.
  await new Promise(resolve=>setTimeout(resolve,5000));
  const users=await listAllUsers(admin);
  const accessResponse=await admin.from('app_user_access').select('email,organization_id').eq('organization_id',organization.id);
  if(accessResponse.error)throw accessResponse.error;
  const accessEmails=new Set((accessResponse.data||[]).map(row=>lower(row.email)));
  const membershipsResponse=await admin.from('organization_memberships').select('auth_user_id').eq('organization_id',organization.id).eq('active',true);
  if(membershipsResponse.error)throw membershipsResponse.error;
  const membershipIds=new Set((membershipsResponse.data||[]).map(row=>String(row.auth_user_id)));
  const requestsResponse=await admin.from('rep_access_requests').select('user_id');
  if(requestsResponse.error)throw requestsResponse.error;
  const requestedIds=new Set((requestsResponse.data||[]).map(row=>String(row.user_id)));

  const targets=users.filter(user=>{
    const email=lower(user.email);
    const belongs=accessEmails.has(email)||membershipIds.has(String(user.id))||requestedIds.has(String(user.id));
    return belongs&&email&&!user.email_confirmed_at&&!user.confirmed_at&&!user.deleted_at;
  });
  const resendResults=[];
  for(const user of targets){
    const email=lower(user.email);
    const requestedAt=new Date().toISOString();
    const {error}=await admin.auth.resend({type:'signup',email,options:{emailRedirectTo:PROD_CONFIRM_URL}});
    const audit={
      organization_id:organization.id,
      auth_user_id:user.id,
      target_email:email,
      event_type:'confirmation_requested',
      status:error?'failed':'accepted_by_auth',
      provider:'resend',
      request_source:'production_email_activation',
      redirect_url:PROD_CONFIRM_URL,
      detail:error?String(error.message||'Initial production confirmation failed.'):'Fresh confirmation requested immediately after production SMTP activation.',
      provider_payload:{source:'production_email_activation'},
      event_created_at:requestedAt,
      received_at:requestedAt
    };
    const {error:auditError}=await admin.from('auth_email_delivery_events').insert(audit);
    if(auditError)throw auditError;
    resendResults.push({ok:!error});
    if(error)throw new Error(`A fresh confirmation request failed for one unconfirmed account: ${error.message}`);
    await new Promise(resolve=>setTimeout(resolve,1000));
  }

  for(const webhookId of context.previous_webhook_ids||[]){
    try{await resendRequest(`/webhooks/${encodeURIComponent(webhookId)}`,{method:'DELETE'});}catch(error){
      console.warn(`Unable to retire previous Resend webhook ${webhookId}: ${error.message}`);
    }
  }

  const result={
    ok:true,
    phase:'activated',
    activated_at:activatedAt,
    project_ref:PROJECT_REF,
    site_url:PROD_SITE_URL,
    confirmation_redirect_url:PROD_CONFIRM_URL,
    provider:'resend',
    sender_domain:context.sender_domain,
    custom_smtp_active:true,
    webhook_configured:true,
    delivery_webhook_verified:false,
    fresh_confirmations_requested:resendResults.length,
    fresh_confirmation_failures:resendResults.filter(item=>!item.ok).length,
    note:'delivery_webhook_verified becomes true after the first signed Resend delivery event is received.'
  };
  await writeFile(RESULT_FILE,JSON.stringify(result,null,2));
  console.log(JSON.stringify(result,null,2));
}

const command=process.argv[2];
if(command==='prepare')await prepare();
else if(command==='activate')await activate();
else throw new Error('Usage: configure-production-auth-email.mjs <prepare|activate>');
