// @ts-nocheck
import { createClient } from 'npm:@supabase/supabase-js@2.95.0'

const corsHeaders={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS'
}
const json=(body,status=200)=>new Response(JSON.stringify(body),{
  status,
  headers:{...corsHeaders,'Content-Type':'application/json','Cache-Control':'no-store'}
})
const lower=value=>String(value||'').trim().toLowerCase()

Deno.serve(async request=>{
  if(request.method==='OPTIONS')return new Response('ok',{headers:corsHeaders})
  if(request.method!=='POST')return json({error:'method_not_allowed'},405)
  try{
    const jwt=(request.headers.get('Authorization')||'').replace(/^Bearer\s+/,'')
    if(!jwt)return json({error:'unauthorized'},401)
    const url=Deno.env.get('SUPABASE_URL')
    const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if(!url||!serviceKey)return json({error:'server_configuration_missing'},500)
    const admin=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}})
    const {data:{user},error:userError}=await admin.auth.getUser(jwt)
    if(userError||!user?.email)return json({error:'unauthorized'},401)
    if(!(user.email_confirmed_at||user.confirmed_at))return json({error:'email_not_confirmed'},409)

    const email=lower(user.email)
    const {data:access,error:accessError}=await admin.from('app_user_access')
      .select('organization_id')
      .eq('email',email)
      .maybeSingle()
    if(accessError)throw accessError
    let organizationId=access?.organization_id||null
    if(!organizationId){
      const {data:membership,error:membershipError}=await admin.from('organization_memberships')
        .select('organization_id')
        .eq('auth_user_id',user.id)
        .eq('active',true)
        .order('is_default',{ascending:false})
        .limit(1)
        .maybeSingle()
      if(membershipError)throw membershipError
      organizationId=membership?.organization_id||null
    }
    if(!organizationId)return json({error:'organization_not_found'},403)

    const since=new Date(Date.now()-10*60_000).toISOString()
    const {data:existing,error:existingError}=await admin.from('auth_email_delivery_events')
      .select('id')
      .eq('organization_id',organizationId)
      .eq('target_email',email)
      .eq('event_type','confirmed')
      .gte('created_at',since)
      .limit(1)
      .maybeSingle()
    if(existingError)throw existingError
    if(!existing){
      const now=new Date().toISOString()
      const {error:insertError}=await admin.from('auth_email_delivery_events').insert({
        organization_id:organizationId,
        auth_user_id:user.id,
        target_email:email,
        event_type:'confirmed',
        status:'confirmed',
        provider:'supabase_auth',
        detail:'The authenticated user completed email ownership confirmation.',
        provider_payload:{source:'production_confirmation_page'},
        event_created_at:user.email_confirmed_at||user.confirmed_at||now,
        received_at:now
      })
      if(insertError)throw insertError
    }
    return json({ok:true,confirmed:true,email})
  }catch(error){
    console.error('auth-email-confirmed failed',error)
    return json({error:'confirmation_audit_failed'},500)
  }
})
