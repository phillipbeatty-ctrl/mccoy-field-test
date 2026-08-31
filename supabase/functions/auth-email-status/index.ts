// @ts-nocheck
import { createClient } from 'npm:@supabase/supabase-js@2.95.0'

const corsHeaders={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':'GET, POST, OPTIONS'
}
const json=(body,status=200)=>new Response(JSON.stringify(body),{
  status,
  headers:{...corsHeaders,'Content-Type':'application/json','Cache-Control':'no-store'}
})

Deno.serve(async request=>{
  if(request.method==='OPTIONS')return new Response('ok',{headers:corsHeaders})
  if(!['GET','POST'].includes(request.method))return json({error:'method_not_allowed'},405)
  try{
    const url=Deno.env.get('SUPABASE_URL')
    const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if(!url||!serviceKey)return json({error:'server_configuration_missing'},500)
    const admin=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}})
    const {data:organization,error:organizationError}=await admin.from('organizations')
      .select('id')
      .eq('slug','mccoy-platform-llc')
      .maybeSingle()
    if(organizationError)throw organizationError
    if(!organization)return json({error:'organization_not_found'},404)
    const {data:settings,error:settingsError}=await admin.from('auth_email_provider_settings')
      .select('provider,sender_email,sender_name,site_url,confirmation_redirect_url,custom_smtp_active,delivery_webhook_active,last_verified_at,verification_detail,updated_at')
      .eq('organization_id',organization.id)
      .maybeSingle()
    if(settingsError)throw settingsError
    const state=settings||{}
    const productionUrlReady=String(state.site_url||'').replace(/\/$/,'')==='https://mccoy-field-test.vercel.app'
      &&String(state.confirmation_redirect_url||'').startsWith('https://mccoy-field-test.vercel.app/confirm-email.html')
    return json({
      ok:true,
      provider:state.provider||'unconfigured',
      sender_email:state.sender_email||null,
      sender_name:state.sender_name||null,
      production_url_ready:productionUrlReady,
      custom_smtp_active:state.custom_smtp_active===true,
      delivery_webhook_active:state.delivery_webhook_active===true,
      production_ready:Boolean(state.custom_smtp_active&&state.sender_email&&productionUrlReady),
      fully_observable:Boolean(state.custom_smtp_active&&state.delivery_webhook_active&&state.sender_email&&productionUrlReady),
      last_verified_at:state.last_verified_at||null,
      verification_detail:state.verification_detail||'Production SMTP has not been activated.',
      updated_at:state.updated_at||null
    })
  }catch(error){
    console.error('auth-email-status failed',error)
    return json({error:'email_status_unavailable'},500)
  }
})
