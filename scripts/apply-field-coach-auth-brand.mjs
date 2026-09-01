#!/usr/bin/env node
import {writeFile} from 'node:fs/promises';
import {createClient} from '@supabase/supabase-js';

const PROJECT_REF='athxxrfqxwlfnuvbqadp';
const SUPABASE_URL=`https://${PROJECT_REF}.supabase.co`;
const PRODUCT_NAME='Field Coach';
const LEGAL_NAME='McCoy Platform LLC';
const ORGANIZATION_SLUG='mccoy-platform-llc';
const RESULT_FILE=process.env.FIELD_COACH_BRAND_RESULT_FILE||'/tmp/field-coach-production-brand.json';

function required(name){
  const value=String(process.env[name]||'').trim();
  if(!value)throw new Error(`Missing required environment variable: ${name}`);
  return value;
}
async function requestJson(path,{method='GET',body}={}){
  const response=await fetch(`https://api.supabase.com${path}`,{
    method,
    headers:{Authorization:`Bearer ${required('SUPABASE_ACCESS_TOKEN')}`,Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},
    body:body?JSON.stringify(body):undefined
  });
  const text=await response.text();
  let data={};
  try{data=text?JSON.parse(text):{};}catch{data={raw:text};}
  if(!response.ok)throw new Error(data?.message||data?.error||`${response.status} ${response.statusText}`);
  return data;
}
function confirmationTemplate(){
  return [
    '<h2>Confirm your Field Coach email address</h2>',
    '<p>Confirm this email address to finish creating your Field Coach account.</p>',
    '<p><a href="{{ .SiteURL }}/confirm-email.html?token_hash={{ .TokenHash }}&type=email&next=/">Confirm email address</a></p>',
    '<p>Or enter this one-time code on the Field Coach confirmation page:</p>',
    '<p style="font-size:24px;font-weight:700;letter-spacing:4px">{{ .Token }}</p>',
    '<p>This confirmation is single-use. Field Coach will never ask you to send this code to another person.</p>',
    `<p style="font-size:12px;color:#6b7280">Field Coach is operated by ${LEGAL_NAME}.</p>`
  ].join('');
}

const patch={
  smtp_sender_name:PRODUCT_NAME,
  mailer_subjects_confirmation:'Confirm your Field Coach email address',
  mailer_templates_confirmation_content:confirmationTemplate()
};
await requestJson(`/v1/projects/${PROJECT_REF}/config/auth`,{method:'PATCH',body:patch});
const authConfig=await requestJson(`/v1/projects/${PROJECT_REF}/config/auth`);
if(authConfig.smtp_sender_name!==PRODUCT_NAME)throw new Error('Supabase did not retain the Field Coach sender name.');
if(authConfig.mailer_subjects_confirmation!==patch.mailer_subjects_confirmation)throw new Error('Supabase did not retain the Field Coach confirmation subject.');
if(!String(authConfig.mailer_templates_confirmation_content||'').includes('Field Coach'))throw new Error('Supabase did not retain the Field Coach confirmation template.');

const serviceKey=required('SUPABASE_SERVICE_ROLE_KEY');
const admin=createClient(SUPABASE_URL,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
const {data:organization,error:organizationError}=await admin.from('organizations')
  .update({display_name:PRODUCT_NAME,updated_at:new Date().toISOString()})
  .eq('slug',ORGANIZATION_SLUG)
  .select('id,slug,legal_name,display_name')
  .single();
if(organizationError)throw organizationError;
const {error:mailSettingsError}=await admin.from('auth_email_provider_settings')
  .update({sender_name:PRODUCT_NAME,updated_at:new Date().toISOString()})
  .eq('organization_id',organization.id);
if(mailSettingsError)throw mailSettingsError;

const result={
  ok:true,
  applied_at:new Date().toISOString(),
  product_name:PRODUCT_NAME,
  legal_name:organization.legal_name,
  organization_slug:organization.slug,
  stable_app_id:'com.mccoyplatform.app',
  stable_deep_link_scheme:'mccoy',
  sender_name:authConfig.smtp_sender_name,
  confirmation_subject:authConfig.mailer_subjects_confirmation,
  confirmation_template_branded:true,
  confirmation_emails_sent:0,
  access_records_changed:0
};
await writeFile(RESULT_FILE,JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
