import { serveWithOrganizationAccess } from '../_shared/organization-paywall.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.95.0'
import { corsHeaders } from 'npm:@supabase/supabase-js@2.95.0/cors'

const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{...corsHeaders,'Cache-Control':'no-store'}})

// Session-control no longer infers that stationary, outside-area, or missing
// telemetry means a rep stopped working. The database closes sessions only at
// the rep's local midnight; SPH derives breaks/gaps/homeward travel separately.
serveWithOrganizationAccess('native_background_location',async request=>{
  if(request.method==='OPTIONS')return new Response('ok',{headers:corsHeaders})
  if(request.method!=='POST')return json({error:'method_not_allowed'},405)
  try{
    const jwt=(request.headers.get('Authorization')||'').replace(/^Bearer\s+/,'')
    if(!jwt)return json({error:'unauthorized'},401)
    const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}})
    const {data:{user},error:userError}=await admin.auth.getUser(jwt)
    if(userError||!user)return json({error:'unauthorized'},401)
    const body=await request.json().catch(()=>({}))
    const sessionId=String(body.session_id||'')
    if(!sessionId)return json({error:'session_id_required'},400)
    const {data:session,error}=await admin.from('test_sessions').select('id,ended_at').eq('id',sessionId).eq('tester_user_id',user.id).maybeSingle()
    if(error)throw error
    if(!session)return json({error:'session_not_found'},404)
    if(session.ended_at)return json({ok:true,action:'stop',reason:'local_midnight'})
    return json({ok:true,action:'continue',policy:'automatic_daily_workday',manual_stop_required:false})
  }catch(error){
    console.error('session-control',error)
    return json({error:'session_control_failed',detail:String((error as Error)?.message||error).slice(0,300)},500)
  }
})
