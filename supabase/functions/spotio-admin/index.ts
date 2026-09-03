import { serveWithOrganizationAccess } from '../_shared/organization-paywall.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.95.0'
import { corsHeaders } from 'npm:@supabase/supabase-js@2.95.0/cors'
const json=(body:any,status=200)=>new Response(JSON.stringify(body),{status,headers:{...corsHeaders,'Content-Type':'application/json','Cache-Control':'no-store'}})
serveWithOrganizationAccess('provider_integrations',async(req)=>{
 if(req.method==='OPTIONS') return new Response('ok',{headers:corsHeaders})
 try{
  const token=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/,''); if(!token) return json({error:'unauthorized'},401)
  const url=Deno.env.get('SUPABASE_URL')!, key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}})
  const {data:{user},error:uerr}=await admin.auth.getUser(token); if(uerr||!user?.email) return json({error:'unauthorized'},401)
  const authUserId=user.id,email=user.email.toLowerCase()
  const {data:membership,error:membershipError}=await admin.from('organization_memberships').select('organization_id,role,active,is_default').eq('auth_user_id',authUserId).eq('active',true).eq('is_default',true).maybeSingle();if(membershipError)throw membershipError
  if(!membership?.organization_id)return json({error:'organization_membership_required'},403)
  const [{data:organization,error:organizationError},{data:access,error:accessError}]=await Promise.all([
   admin.from('organizations').select('id,slug,active').eq('id',membership.organization_id).eq('slug','mccoy-platform-llc').eq('active',true).maybeSingle(),
   admin.from('app_user_access').select('role,active,organization_id').eq('organization_id',membership.organization_id).eq('email',email).maybeSingle()
  ])
  if(organizationError)throw organizationError;if(accessError)throw accessError
  if(!organization||!access?.active||access.role!=='admin')return json({error:'admin_only'},403)
  const body=await req.json().catch(()=>({})); const action=String(body.action||'status')
  if(action==='status'){
   const {data,error}=await admin.from('spotio_connection_status').select('configured,connected,configured_at,configured_by,last_sync_at,last_sync_status,last_sync_count,last_error').eq('singleton',true).maybeSingle(); if(error) throw error
   return json({ok:true,status:data||{configured:false,connected:false}})
  }
  if(action==='save_credentials'){
   const clientId=String(body.client_id||'').trim(),clientSecret=String(body.client_secret||'').trim()
   if(clientId.length<4||clientSecret.length<4)return json({error:'credentials_required'},400)
   const {error}=await admin.rpc('store_spotio_credentials',{p_client_id:clientId,p_client_secret:clientSecret,p_configured_by:email});if(error)throw error
   return json({ok:true,configured:true,message:'SPOTIO API credentials saved securely.'})
  }
  return json({error:'unknown_action'},400)
 }catch(e){console.error(e);return json({error:'spotio_admin_failed'},500)}
})
