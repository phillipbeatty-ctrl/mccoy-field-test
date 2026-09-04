import { serveWithOrganizationAccess } from '../_shared/organization-paywall.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.95.0'
import { corsHeaders } from 'npm:@supabase/supabase-js@2.95.0/cors'

const json=(body:any,status=200)=>Response.json(body,{status,headers:{...corsHeaders,'Cache-Control':'no-store'}})

serveWithOrganizationAccess('analytics',async req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders})
  try{
    const jwt=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/,'')
    if(!jwt)return json({error:'unauthorized'},401)

    const admin=createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      {auth:{persistSession:false,autoRefreshToken:false}}
    )
    const {data:{user},error:userError}=await admin.auth.getUser(jwt)
    if(userError||!user?.email)return json({error:'unauthorized'},401)

    const viewerEmail=user.email.toLowerCase()
    const {data:viewer,error:viewerError}=await admin
      .from('app_user_access')
      .select('email,active,role,display_name')
      .eq('email',viewerEmail)
      .maybeSingle()
    if(viewerError)throw viewerError
    if(!viewer?.active||viewer.role!=='admin')return json({error:'admin_required'},403)

    if(req.method==='GET'){
      const [{data:global,error:globalError},{data:users,error:usersError},{data:visibility,error:visibilityError}]=await Promise.all([
        admin.from('metrics_visibility_settings').select('*').order('id').limit(1).maybeSingle(),
        admin.from('app_user_access').select('email,display_name,role,active,team_name,assigned_manager_email,assigned_manager_name').eq('active',true).order('display_name'),
        admin.from('rep_metrics_visibility').select('*')
      ])
      if(globalError)throw globalError
      if(usersError)throw usersError
      if(visibilityError)throw visibilityError

      const byEmail=new Map((visibility||[]).map((row:any)=>[String(row.rep_email||'').toLowerCase(),row]))
      const activeUsers=(users||[]).map((entry:any)=>{
        const email=String(entry.email||'').toLowerCase()
        const isAdmin=entry.role==='admin'
        return {
          ...entry,
          email,
          admin_always_visible:isAdmin,
          visibility:isAdmin
            ?{rep_email:email,rep_metrics_enabled:true,manager_metrics_enabled:true,admin_always_visible:true}
            :(byEmail.get(email)||{rep_email:email,rep_metrics_enabled:true,manager_metrics_enabled:true})
        }
      })
      return json({ok:true,global,users:activeUsers,reps:activeUsers,admin_all_users_access:true})
    }

    if(req.method!=='POST')return json({error:'method_not_allowed'},405)
    const body=await req.json().catch(()=>({}))
    const action=String(body.action||'')
    if(action==='set_global'){
      const {error}=await admin.from('metrics_visibility_settings').update({
        global_rep_metrics_enabled:!!body.rep_enabled,
        global_manager_metrics_enabled:!!body.manager_enabled,
        updated_at:new Date().toISOString(),
        updated_by:viewerEmail
      }).not('id','is',null)
      if(error)throw error
      return json({ok:true,admin_all_users_access:true})
    }

    if(action==='set_rep'){
      const targetEmail=String(body.rep_email||'').trim().toLowerCase()
      if(!targetEmail)return json({error:'user_email_required'},400)
      const {data:target,error:targetError}=await admin.from('app_user_access').select('email,active,role').eq('email',targetEmail).maybeSingle()
      if(targetError)throw targetError
      if(!target?.active)return json({error:'active_user_required'},404)
      if(target.role==='admin')return json({ok:true,admin_always_visible:true})

      const {error}=await admin.from('rep_metrics_visibility').upsert({
        rep_email:targetEmail,
        rep_metrics_enabled:!!body.rep_metrics_enabled,
        manager_metrics_enabled:!!body.manager_metrics_enabled,
        updated_at:new Date().toISOString(),
        updated_by:viewerEmail
      },{onConflict:'rep_email'})
      if(error)throw error
      return json({ok:true})
    }

    return json({error:'unsupported_action'},400)
  }catch(error){
    console.error('metrics-visibility',error)
    return json({error:'metrics_visibility_failed'},500)
  }
})
