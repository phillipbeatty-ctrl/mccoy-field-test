import { createClient } from 'npm:@supabase/supabase-js@2.95.0'
import { corsHeaders } from 'npm:@supabase/supabase-js@2.95.0/cors'
const json=(body:any,status=200)=>new Response(JSON.stringify(body),{status,headers:{...corsHeaders,'Content-Type':'application/json','Cache-Control':'no-store'}})
const REGIONS=['Pacific Northwest','North Carolina','Texas','Midwest','South East','North East','California'] as const
const PAY_LEVELS=['trainee','experienced','active_manager_trainer'] as const
const payLevel=(value:any)=>PAY_LEVELS.includes(String(value||'') as any)?String(value):null
const displayName=(value:any)=>String(value??'').trim().replace(/\s+/g,' ')
const isTeamLeaderRole=(role:any)=>role==='manager'||role==='trainer'
Deno.serve(async(req)=>{
  if(req.method==='OPTIONS') return new Response('ok',{headers:corsHeaders})
  try{
    const auth=req.headers.get('Authorization')||''; const jwt=auth.replace(/^Bearer\s+/,''); if(!jwt) return json({error:'unauthorized'},401)
    const url=Deno.env.get('SUPABASE_URL')!; const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}})
    const {data:{user},error:uerr}=await admin.auth.getUser(jwt); if(uerr||!user?.email) return json({error:'unauthorized'},401)
    const email=user.email.toLowerCase(); const body=await req.json().catch(()=>({})); const action=String(body.action||'status')
    const {data:callerAccess}=await admin.from('app_user_access').select('email,role,active,display_name,sales_classification,team_name,assigned_manager_email,assigned_manager_name,assigned_admin_email,assigned_admin_name').eq('email',email).maybeSingle()
    if(action==='status'){
      const {data:reqRow}=await admin.from('rep_access_requests').select('*').eq('user_id',user.id).order('created_at',{ascending:false}).limit(1).maybeSingle()
      return json({ok:true,access:callerAccess?.active?callerAccess:null,request:reqRow||null,email})
    }
    if(action==='request_access'){
      if(callerAccess?.active) return json({ok:true,access:callerAccess,already_authorized:true})
      const displayName=String(body.display_name||'').trim().slice(0,120); const team=String(body.requested_team||'').trim().slice(0,120)||null
      if(displayName.length<2) return json({error:'display_name_required'},400)
      const {data:existing}=await admin.from('rep_access_requests').select('*').eq('user_id',user.id).in('status',['pending','approved']).order('created_at',{ascending:false}).limit(1).maybeSingle()
      if(existing?.status==='pending') return json({ok:true,request:existing,already_pending:true}); if(existing?.status==='approved') return json({ok:true,request:existing,already_approved:true})
      const {data:created,error}=await admin.from('rep_access_requests').insert({user_id:user.id,email,display_name:displayName,requested_role:'rep',requested_team:team,status:'pending'}).select('*').single(); if(error) throw error
      return json({ok:true,request:created})
    }
    if(action==='team_rosters'){
      if(!callerAccess?.active)return json({error:'forbidden'},403)
      const [{data:accounts,error:accountError},{data:profiles,error:profileError},{data:teamRows,error:teamError}]=await Promise.all([
        admin.from('app_user_access').select('email,display_name,role,sales_classification,team_name,assigned_manager_email,assigned_manager_name').eq('active',true).order('display_name'),
        admin.from('users').select('id,email').eq('active',true).not('email','is',null),
        admin.from('teams').select('name,manager_user_id').eq('active',true).in('name',[...REGIONS])
      ])
      if(accountError)throw accountError;if(profileError)throw profileError;if(teamError)throw teamError
      const accountRows=accounts||[],profilesById=new Map((profiles||[]).map((profile:any)=>[String(profile.id),String(profile.email||'').toLowerCase()]))
      const regionsByManager=new Map<string,string[]>()
      for(const teamRow of teamRows||[]){const managerEmail=profilesById.get(String(teamRow.manager_user_id||''));if(!managerEmail)continue;const assigned=regionsByManager.get(managerEmail)||[];assigned.push(String(teamRow.name));regionsByManager.set(managerEmail,assigned)}
      const managers=accountRows.filter((row:any)=>['manager','trainer','admin'].includes(row.role)),reps=accountRows.filter((row:any)=>row.role==='rep'),matched=new Set<string>()
      const rosters=managers.map((manager:any)=>{
        const managerEmail=String(manager.email||'').toLowerCase(),managerName=String(manager.display_name||manager.email||'Manager')
        const assignedReps=reps.filter((rep:any)=>{
          const repEmail=String(rep.email||'').toLowerCase(),byEmail=String(rep.assigned_manager_email||'').toLowerCase()===managerEmail,byLegacyName=!rep.assigned_manager_email&&rep.assigned_manager_name===managerName
          if(byEmail||byLegacyName){matched.add(repEmail);return true}return false
        }).map((rep:any)=>({display_name:rep.display_name||'Rep',region:rep.team_name||null,sales_classification:rep.sales_classification||null}))
        return {manager_name:managerName,manager_role:manager.role,regions:(regionsByManager.get(managerEmail)||[]).sort(),reps:assignedReps}
      }).filter((roster:any)=>roster.regions.length||roster.reps.length||isTeamLeaderRole(roster.manager_role))
      const unassigned_reps=reps.filter((rep:any)=>!matched.has(String(rep.email||'').toLowerCase())).map((rep:any)=>({display_name:rep.display_name||'Rep',region:rep.team_name||null,sales_classification:rep.sales_classification||null}))
      return json({ok:true,rosters,unassigned_reps:unassigned_reps,visibility:'active_users_no_emails'})
    }
    if(!callerAccess?.active||callerAccess.role!=='admin') return json({error:'admin_only'},403)
    if(action==='list_pending'){
      const {data,error}=await admin.from('rep_access_requests').select('*').eq('status','pending').order('created_at',{ascending:true}); if(error) throw error
      const {data:managerCandidates}=await admin.from('app_user_access').select('email,display_name,team_name,role,assigned_admin_email').eq('active',true).in('role',['manager','trainer','admin']).order('display_name')
      return json({ok:true,requests:data||[],managers:managerCandidates||[]})
    }
    if(action==='list_users'){
      const {data,error}=await admin.from('app_user_access').select('email,display_name,role,active,sales_classification,team_name,assigned_manager_email,assigned_manager_name,assigned_admin_email,assigned_admin_name').eq('active',true).order('display_name'); if(error) throw error
      const {data:secondary}=await admin.from('secondary_admin_assignments').select('secondary_email').eq('active',true).maybeSingle()
      const {data:removalHistory,error:removalHistoryError}=await admin.from('user_account_removal_history').select('id,target_email,target_display_name,target_role,reason,status,requested_by_email,requested_at,finalized_at').order('requested_at',{ascending:false}).limit(25);if(removalHistoryError)throw removalHistoryError
      return json({ok:true,users:data||[],removal_history:removalHistory||[],pay_levels:PAY_LEVELS,can_assign_secondary_admin:user.id==='f9053207-1af1-4ed1-be43-28f4bf5d7732'&&email==='phillip.beatty@gmail.com',secondary_admin_email:secondary?.secondary_email||null})
    }
    if(action==='list_pending_accounts'){
      const authUsers:any[]=[]
      for(let page=1;page<=20;page++){
        const {data:accountPage,error:accountError}=await admin.auth.admin.listUsers({page,perPage:1000});if(accountError)throw accountError
        const pageUsers=accountPage?.users||[];authUsers.push(...pageUsers);if(pageUsers.length<1000)break
      }
      const [{data:accessRows,error:accessError},{data:requestRows,error:requestError}]=await Promise.all([
        admin.from('app_user_access').select('email,display_name,role,active,created_at'),
        admin.from('rep_access_requests').select('id,user_id,email,display_name,requested_role,requested_team,status,created_at,reviewed_at').order('created_at',{ascending:false})
      ])
      if(accessError)throw accessError;if(requestError)throw requestError
      const accessByEmail=new Map((accessRows||[]).map((row:any)=>[String(row.email||'').toLowerCase(),row]))
      const latestRequestByUser=new Map<string,any>()
      for(const row of requestRows||[]){const key=String(row.user_id||'');if(key&&!latestRequestByUser.has(key))latestRequestByUser.set(key,row)}
      const accounts=authUsers.filter((account:any)=>{
        const accountEmail=String(account.email||'').trim().toLowerCase();if(!accountEmail||account.is_anonymous||account.deleted_at)return false
        return !accessByEmail.get(accountEmail)?.active
      }).map((account:any)=>{
        const accountEmail=String(account.email||'').trim().toLowerCase(),access=accessByEmail.get(accountEmail) as any,request=latestRequestByUser.get(String(account.id)) as any
        const metadata=account.user_metadata||{},metadataName=String(metadata.full_name||metadata.name||[metadata.first_name,metadata.last_name].filter(Boolean).join(' ')||'').trim()
        const displayName=String(request?.display_name||access?.display_name||metadataName||accountEmail).trim()
        const emailConfirmedAt=account.email_confirmed_at||account.confirmed_at||null
        const accessState=!emailConfirmedAt?'email_unconfirmed':request?.status==='pending'?'approval_requested':access?'access_inactive':'no_access_record'
        return {email:accountEmail,display_name:displayName,account_created_at:account.created_at||null,email_confirmed_at:emailConfirmedAt,last_sign_in_at:account.last_sign_in_at||null,access_state:accessState,access_active:!!access?.active,request:request?{id:request.id,status:request.status,requested_role:request.requested_role,requested_team:request.requested_team,created_at:request.created_at,reviewed_at:request.reviewed_at}:null}
      }).sort((left:any,right:any)=>String(right.account_created_at||'').localeCompare(String(left.account_created_at||'')))
      return json({ok:true,accounts})
    }
    if(action==='list_regions'){
      const {data:regionRows,error:regionError}=await admin.from('teams').select('id,name,active,manager_user_id').in('name',[...REGIONS]).eq('active',true);if(regionError)throw regionError
      const {data:accounts,error:accountError}=await admin.from('app_user_access').select('email,display_name,role,active,team_name').eq('active',true).order('display_name');if(accountError)throw accountError
      const {data:profiles,error:profileError}=await admin.from('users').select('id,email,role,active').eq('active',true).not('email','is',null);if(profileError)throw profileError
      const profilesByEmail=new Map((profiles||[]).map((profile:any)=>[String(profile.email||'').toLowerCase(),profile]))
      const candidates=(accounts||[]).map((account:any)=>{const profile=profilesByEmail.get(String(account.email||'').toLowerCase()) as any;return profile?{email:account.email,display_name:account.display_name||account.email,role:account.role,team_name:account.team_name,user_id:profile.id}:null}).filter(Boolean)
      const candidatesById=new Map(candidates.map((candidate:any)=>[String(candidate.user_id),candidate]))
      const rowsByName=new Map((regionRows||[]).map((row:any)=>[row.name,row]))
      const regions=REGIONS.map(name=>{const row=rowsByName.get(name) as any;const manager=row?.manager_user_id?candidatesById.get(String(row.manager_user_id)):null;return{id:row?.id||null,name,active:row?.active!==false,manager_user_id:row?.manager_user_id||null,manager_email:(manager as any)?.email||null,manager_name:(manager as any)?.display_name||null,manager_role:(manager as any)?.role||null}})
      return json({ok:true,regions,users:candidates})
    }
    async function validateManager(mgrEmail:string|null){
      if(!mgrEmail) return {email:null,name:null}
      const {data:m}=await admin.from('app_user_access').select('email,display_name,role,active,assigned_manager_email,assigned_admin_email').eq('email',mgrEmail).maybeSingle()
      if(!m?.active||!['manager','trainer','admin'].includes(m.role)) throw new Error('invalid_manager')
      if(isTeamLeaderRole(m.role)){
        const supervisorEmail=String(m.assigned_manager_email||'').trim().toLowerCase()
        if(!supervisorEmail||supervisorEmail!==String(m.assigned_admin_email||'').trim().toLowerCase())throw new Error('manager_requires_admin_manager')
        await validateAdministrator(supervisorEmail)
      }
      return {email:m.email,name:m.display_name||m.email}
    }
    async function validateAdministrator(adminEmail:string|null){
      if(!adminEmail)return {email:null,name:null}
      const {data:owner}=await admin.from('app_user_access').select('email,display_name,role,active').eq('email',adminEmail).maybeSingle()
      if(!owner?.active||owner.role!=='admin')throw new Error('invalid_administrator')
      return {email:owner.email,name:owner.display_name||owner.email}
    }
    async function findAuthAccountByEmail(targetEmail:string){
      const normalizedEmail=targetEmail.trim().toLowerCase()
      for(let page=1;page<=20;page++){
        const {data:accountPage,error:accountError}=await admin.auth.admin.listUsers({page,perPage:1000});if(accountError)throw accountError
        const pageUsers=accountPage?.users||[]
        const account=pageUsers.find((candidate:any)=>String(candidate.email||'').trim().toLowerCase()===normalizedEmail)
        if(account)return account
        if(pageUsers.length<1000)break
      }
      return null
    }
    async function syncAppUserProfile(targetEmail:string,role:string,team:string|null,displayName:string,active=true){
      const account=await findAuthAccountByEmail(targetEmail);if(!account?.id)throw new Error('user_profile_account_not_found')
      let teamId=null;if(team){const {data:teamRow,error:teamError}=await admin.from('teams').select('id').eq('name',team).maybeSingle();if(teamError)throw teamError;teamId=teamRow?.id||null}
      const parts=String(displayName||'').trim().split(/\s+/).filter(Boolean);const firstName=parts.shift()||null,lastName=parts.join(' ')||null
      const {error:profileError}=await admin.from('users').upsert({id:account.id,auth_user_id:account.id,email:targetEmail.toLowerCase(),first_name:firstName,last_name:lastName,role:role==='tester'?'rep':role,team_id:teamId,active},{onConflict:'auth_user_id'});if(profileError)throw profileError
    }
    if(action==='set_secondary_admin'){
      if(user.id!=='f9053207-1af1-4ed1-be43-28f4bf5d7732'||email!=='phillip.beatty@gmail.com')return json({error:'original_owner_only'},403)
      const scoped=createClient(url,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:auth}},auth:{persistSession:false,autoRefreshToken:false}})
      const {data,error}=await scoped.rpc('owner_set_secondary_admin',{p_target_email:String(body.email||'').trim().toLowerCase(),p_enabled:body.enabled!==false})
      if(error)return json({error:error.message||'secondary_admin_update_failed'},400)
      return json(data||{ok:true})
    }
    if(action==='assign_region_manager'){
      const region=String(body.region_name||'').trim();if(!REGIONS.includes(region as any))return json({error:'invalid_region'},400)
      const targetEmail=String(body.manager_email||'').trim().toLowerCase()||null
      const {data:teamRow,error:teamError}=await admin.from('teams').select('id,name,manager_user_id').eq('name',region).eq('active',true).maybeSingle();if(teamError)throw teamError;if(!teamRow)return json({error:'region_not_found'},404)
      if(!targetEmail){const {error:clearError}=await admin.from('teams').update({manager_user_id:null}).eq('id',teamRow.id);if(clearError)throw clearError;return json({ok:true,region_name:region,manager_email:null})}
      const {data:target,error:targetError}=await admin.from('app_user_access').select('email,display_name,role,active,team_name').eq('email',targetEmail).maybeSingle();if(targetError)throw targetError
      if(!target?.active)return json({error:'active_user_required'},404)
      const nextRole=target.role==='admin'?'admin':target.role==='trainer'?'trainer':'manager'
      const primaryTeam=String(target.team_name||region).trim()||region
      await syncAppUserProfile(targetEmail,nextRole,primaryTeam,String(target.display_name||targetEmail),true)
      const {data:profile,error:profileError}=await admin.from('users').select('id').eq('email',targetEmail).eq('active',true).maybeSingle();if(profileError)throw profileError;if(!profile?.id)return json({error:'user_profile_not_found'},404)
      const adminName=callerAccess.display_name||email
      const accessPatch={role:nextRole,team_name:primaryTeam,assigned_manager_email:isTeamLeaderRole(nextRole)?email:null,assigned_manager_name:isTeamLeaderRole(nextRole)?adminName:null,assigned_admin_email:isTeamLeaderRole(nextRole)?email:null,assigned_admin_name:isTeamLeaderRole(nextRole)?adminName:null}
      const {error:accessError}=await admin.from('app_user_access').update(accessPatch).eq('email',targetEmail);if(accessError)throw accessError
      const {error:assignError}=await admin.from('teams').update({manager_user_id:profile.id}).eq('id',teamRow.id);if(assignError)throw assignError
      return json({ok:true,region_name:region,manager_email:targetEmail,manager_name:target.display_name||targetEmail,manager_role:nextRole})
    }
    if(action==='approve'){
      const requestId=String(body.request_id||''); if(!requestId) return json({error:'request_id_required'},400)
      const {data:r}=await admin.from('rep_access_requests').select('*').eq('id',requestId).eq('status','pending').maybeSingle(); if(!r) return json({error:'pending_request_not_found'},404)
      const role=['rep','manager','trainer'].includes(String(body.role))?String(body.role):'rep'; const team=String(body.team_name||r.requested_team||'').trim().slice(0,120)||null
      const mgrRaw=String(body.assigned_manager_email||'').trim().toLowerCase()||null;let mgr={email:null as string|null,name:null as string|null}
      if(role==='rep'){try{mgr=await validateManager(mgrRaw)}catch{return json({error:'invalid_manager'},400)}}
      let owner={email:null as string|null,name:null as string|null};if(isTeamLeaderRole(role)){const ownerRaw=String(body.assigned_manager_email||body.assigned_admin_email||email).trim().toLowerCase();try{owner=await validateAdministrator(ownerRaw)}catch{return json({error:'invalid_administrator_team_leader'},400)};if(!owner.email)return json({error:'administrator_team_leader_required'},400)}
      const displayName=String(body.display_name||r.display_name||r.email).trim().slice(0,120),targetEmail=r.email.toLowerCase()
      const requestedClassification=payLevel(body.sales_classification)
      if(body.sales_classification!==undefined&&body.sales_classification!==null&&String(body.sales_classification)!==''&&!requestedClassification)return json({error:'invalid_sales_classification',allowed:PAY_LEVELS},400)
      const classification=requestedClassification||(role==='rep'?'trainee':null)
      const {error:aerr}=await admin.from('app_user_access').upsert({email:targetEmail,role,active:true,display_name:displayName,sales_classification:classification,team_name:team,assigned_manager_email:role==='rep'?mgr.email:isTeamLeaderRole(role)?owner.email:null,assigned_manager_name:role==='rep'?mgr.name:isTeamLeaderRole(role)?owner.name:null,assigned_admin_email:isTeamLeaderRole(role)?owner.email:null,assigned_admin_name:isTeamLeaderRole(role)?owner.name:null},{onConflict:'email'});if(aerr)throw aerr
      await syncAppUserProfile(targetEmail,role,team,displayName,true)
      const {error:rerr}=await admin.from('rep_access_requests').update({status:'approved',reviewed_at:new Date().toISOString(),reviewed_by:email,notes:String(body.notes||'').slice(0,1000)}).eq('id',requestId);if(rerr)throw rerr
      return json({ok:true,approved_email:r.email,role,sales_classification:classification,team_name:team,assigned_manager_email:role==='rep'?mgr.email:isTeamLeaderRole(role)?owner.email:null,assigned_admin_email:isTeamLeaderRole(role)?owner.email:null})
    }
    if(action==='grant_pending_account_access'){
      const target=String(body.email||'').trim().toLowerCase();if(!target)return json({error:'email_required'},400)
      const account=await findAuthAccountByEmail(target);if(!account?.id)return json({error:'user_not_found'},404)
      const {data:existingAccess,error:accessLookupError}=await admin.from('app_user_access').select('email,display_name,active').eq('email',target).maybeSingle();if(accessLookupError)throw accessLookupError
      if(existingAccess?.active)return json({error:'account_already_active'},409)
      const {data:request,error:requestError}=await admin.from('rep_access_requests').select('*').eq('user_id',account.id).order('created_at',{ascending:false}).limit(1).maybeSingle();if(requestError)throw requestError
      const metadata=account.user_metadata||{},metadataName=String(metadata.full_name||metadata.name||[metadata.first_name,metadata.last_name].filter(Boolean).join(' ')||'').trim()
      const displayName=String(request?.display_name||body.display_name||existingAccess?.display_name||metadataName||target).trim().slice(0,120)
      const team=String(request?.requested_team||'').trim().slice(0,120)||null
      const {error:accessError}=await admin.from('app_user_access').upsert({email:target,role:'rep',active:true,display_name:displayName,sales_classification:'trainee',team_name:team,assigned_manager_email:null,assigned_manager_name:null,assigned_admin_email:null,assigned_admin_name:null},{onConflict:'email'});if(accessError)throw accessError
      await syncAppUserProfile(target,'rep',team,displayName,true)
      if(request?.status==='pending'){
        const {error:reviewError}=await admin.from('rep_access_requests').update({status:'approved',reviewed_at:new Date().toISOString(),reviewed_by:email,notes:'Access granted from Pending Account Access.'}).eq('id',request.id).eq('status','pending');if(reviewError)throw reviewError
      }
      return json({ok:true,email:target,role:'rep',sales_classification:'trainee',team_name:team,access_granted:true})
    }
    if(action==='reset_pending_password'){
      const target=String(body.email||'').trim().toLowerCase(),password=typeof body.password==='string'?body.password:''
      if(!target)return json({error:'email_required'},400)
      if(password.length<8)return json({error:'password_must_be_at_least_8_characters'},400)
      if(password.length>128)return json({error:'password_too_long'},400)
      const {data:targetAccess,error:targetError}=await admin.from('app_user_access').select('email,active').eq('email',target).maybeSingle();if(targetError)throw targetError
      if(targetAccess?.active)return json({error:'account_is_already_active'},409)
      const account=await findAuthAccountByEmail(target);if(!account?.id)return json({error:'user_not_found'},404)
      const {error:passwordError}=await admin.auth.admin.updateUserById(account.id,{password})
      if(passwordError)return json({error:'password_update_failed',detail:passwordError.message||'Unable to update this password.'},400)
      return json({ok:true,email:target,password_updated:true,access_granted:false})
    }
    if(action==='reset_user_password'){
      const target=String(body.email||'').trim().toLowerCase()
      const password=typeof body.password==='string'?body.password:''
      if(!target)return json({error:'email_required'},400)
      if(password.length<8)return json({error:'password_must_be_at_least_8_characters'},400)
      if(password.length>128)return json({error:'password_too_long'},400)
      const {data:targetAccess,error:targetError}=await admin.from('app_user_access').select('email,role,active').eq('email',target).maybeSingle()
      if(targetError)throw targetError
      if(!targetAccess?.active||!['rep','manager','trainer'].includes(targetAccess.role))return json({error:'active_rep_manager_or_trainer_required'},404)
      const account=await findAuthAccountByEmail(target)
      if(!account?.id)return json({error:'user_not_found'},404)
      const {error:passwordError}=await admin.auth.admin.updateUserById(account.id,{password})
      if(passwordError)return json({error:'password_update_failed',detail:passwordError.message||'Unable to update this password.'},400)
      return json({ok:true,email:target,password_updated:true})
    }
    if(action==='preview_user_removal'||action==='remove_user_account'){
      const target=String(body.email||'').trim().toLowerCase()
      if(!target)return json({error:'email_required'},400)
      if(target===email)return json({error:'cannot_delete_own_account'},403)
      const account=await findAuthAccountByEmail(target)
      if(!account?.id||account.deleted_at)return json({error:'active_auth_account_not_found'},404)
      const {data:preview,error:previewError}=await admin.rpc('admin_user_account_removal_preview',{p_target_user_id:account.id,p_target_email:target})
      if(previewError)return json({error:'account_removal_preview_failed',detail:previewError.message||'Unable to inspect this account.'},400)
      if(preview?.protected_original_owner)return json({error:'original_owner_account_is_protected'},403)
      if(preview?.protected_admin)return json({error:'revoke_secondary_admin_before_account_removal'},403)
      if(preview?.blocked_by_storage)return json({error:'storage_objects_must_be_reassigned_before_account_removal',storage_objects:preview.storage_objects||0},409)
      if(action==='preview_user_removal')return json({ok:true,email:target,impact:preview})

      const confirmation=String(body.confirmation_email||'').trim().toLowerCase(),reason=String(body.reason||'').trim().replace(/\s+/g,' ')
      if(confirmation!==target)return json({error:'exact_email_confirmation_required'},400)
      if(reason.length<10||reason.length>500||/[\u0000-\u001f\u007f]/.test(reason))return json({error:'removal_reason_must_be_10_to_500_printable_characters'},400)
      const {data:prepared,error:prepareError}=await admin.rpc('admin_prepare_user_account_removal',{p_target_user_id:account.id,p_target_email:target,p_changed_by:user.id,p_changed_by_email:email,p_reason:reason})
      if(prepareError)return json({error:'account_removal_prepare_failed',detail:prepareError.message||'Unable to remove live McCoy access.'},400)
      const auditId=prepared?.audit_id
      const {error:deleteError}=await admin.auth.admin.deleteUser(account.id,true)
      const errorCode=deleteError?String(deleteError.code||deleteError.name||'auth_delete_failed').slice(0,200):null
      const {error:finalizeError}=await admin.rpc('admin_finalize_user_account_removal',{p_audit_id:auditId,p_changed_by:user.id,p_changed_by_email:email,p_auth_deleted:!deleteError,p_error_code:errorCode})
      if(deleteError)return json({error:'auth_account_delete_failed',detail:deleteError.message||'McCoy access was removed, but Auth deletion must be retried.',access_removed:true,audit_id:auditId},502)
      if(finalizeError){console.error('user removal audit finalization failed',finalizeError);return json({ok:true,email:target,auth_deleted:true,access_removed:true,audit_pending:true})}
      return json({ok:true,email:target,auth_deleted:true,access_removed:true,audit_id:auditId,impact:preview,cleanup:prepared?.cleanup||{}})
    }
    if(action==='update_user'){
      const target=String(body.email||'').trim().toLowerCase(); if(!target) return json({error:'email_required'},400)
      const {data:current}=await admin.from('app_user_access').select('*').eq('email',target).eq('active',true).maybeSingle(); if(!current) return json({error:'user_not_found'},404)
      if(target===email && String(body.role||current.role)!=='admin') return json({error:'cannot_demote_self'},400)
      const nextDisplayName=body.display_name===undefined?displayName(current.display_name||target):displayName(body.display_name)
      if(nextDisplayName.length<2)return json({error:'display_name_must_be_at_least_2_characters'},400)
      if(nextDisplayName.length>120)return json({error:'display_name_too_long'},400)
      if(/[\u0000-\u001f\u007f]/.test(nextDisplayName))return json({error:'display_name_contains_invalid_characters'},400)
      const nameChanged=nextDisplayName!==displayName(current.display_name||target)
      const role=['rep','manager','trainer','admin'].includes(String(body.role))?String(body.role):current.role
      if(role==='admin'&&current.role!=='admin')return json({error:'use_secondary_admin_control'},403)
      if(current.role==='admin'&&role!=='admin')return json({error:'use_secondary_admin_control'},403)
      if(target==='phillip.beatty@gmail.com'&&email!==target)return json({error:'original_owner_protected'},403)
      const classification=body.sales_classification===undefined?payLevel(current.sales_classification):payLevel(body.sales_classification)
      if(body.sales_classification!==undefined&&body.sales_classification!==null&&String(body.sales_classification)!==''&&!classification)return json({error:'invalid_sales_classification',allowed:PAY_LEVELS},400)
      const team=String(body.team_name??current.team_name??'').trim().slice(0,120)||null
      const mgrRaw=String(body.assigned_manager_email||'').trim().toLowerCase()||null;let mgr={email:null as string|null,name:null as string|null}
      if(role==='rep'){try{mgr=await validateManager(mgrRaw)}catch{return json({error:'invalid_manager'},400)}}
      const ownerValue=body.assigned_manager_email!==undefined?body.assigned_manager_email:body.assigned_admin_email!==undefined?body.assigned_admin_email:current.assigned_manager_email||current.assigned_admin_email||email;const ownerRaw=String(ownerValue||'').trim().toLowerCase()||null;let owner={email:null as string|null,name:null as string|null}
      if(isTeamLeaderRole(role)){try{owner=await validateAdministrator(ownerRaw)}catch{return json({error:'invalid_administrator_team_leader'},400)};if(!owner.email)return json({error:'administrator_team_leader_required'},400)}
      const {error}=await admin.from('app_user_access').update({role,sales_classification:classification,team_name:team,assigned_manager_email:role==='rep'?mgr.email:isTeamLeaderRole(role)?owner.email:null,assigned_manager_name:role==='rep'?mgr.name:isTeamLeaderRole(role)?owner.name:null,assigned_admin_email:isTeamLeaderRole(role)?owner.email:null,assigned_admin_name:isTeamLeaderRole(role)?owner.name:null}).eq('email',target);if(error)throw error
      const account=await findAuthAccountByEmail(target);if(!account?.id)throw new Error('user_profile_account_not_found')
      let rename:any={changed:false,display_name:nextDisplayName}
      let authMetadataSynced:boolean|null=null
      if(nameChanged){
        const {data:renameData,error:renameError}=await admin.rpc('admin_rename_app_user',{p_target_email:target,p_new_display_name:nextDisplayName,p_changed_by:user.id,p_changed_by_email:email,p_target_user_id:account.id})
        if(renameError)throw renameError
        rename=renameData||rename
      }
      await syncAppUserProfile(target,role,team,nextDisplayName,true)
      if(nameChanged){
        const parts=nextDisplayName.split(/\s+/),firstName=parts.shift()||'',lastName=parts.join(' ')
        const metadata={...(account.user_metadata||{}),full_name:nextDisplayName,name:nextDisplayName,first_name:firstName,last_name:lastName}
        const {error:metadataError}=await admin.auth.admin.updateUserById(account.id,{user_metadata:metadata})
        authMetadataSynced=!metadataError
        if(rename?.audit_id){
          await admin.from('user_display_name_changes').update({auth_metadata_synced:!metadataError,auth_metadata_error:metadataError?'auth_metadata_sync_failed':null}).eq('id',rename.audit_id)
        }
      }
      return json({ok:true,email:target,display_name:nextDisplayName,display_name_changed:nameChanged,auth_metadata_synced:authMetadataSynced,role,sales_classification:classification,team_name:team,assigned_manager_email:role==='rep'?mgr.email:isTeamLeaderRole(role)?owner.email:null,assigned_admin_email:isTeamLeaderRole(role)?owner.email:null})
    }
    if(action==='reject'){
      const requestId=String(body.request_id||''); if(!requestId) return json({error:'request_id_required'},400)
      const {error}=await admin.from('rep_access_requests').update({status:'rejected',reviewed_at:new Date().toISOString(),reviewed_by:email,notes:String(body.notes||'').slice(0,1000)}).eq('id',requestId).eq('status','pending'); if(error) throw error
      return json({ok:true})
    }
    return json({error:'unknown_action'},400)
  }catch(e){console.error(e);return json({error:'rep_onboarding_failed'},500)}
})
