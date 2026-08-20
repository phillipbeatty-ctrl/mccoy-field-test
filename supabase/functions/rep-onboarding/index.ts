import { createClient } from 'npm:@supabase/supabase-js@2.95.0'
import { corsHeaders } from 'npm:@supabase/supabase-js@2.95.0/cors'
const json=(body:any,status=200)=>new Response(JSON.stringify(body),{status,headers:{...corsHeaders,'Content-Type':'application/json','Cache-Control':'no-store'}})
const REGIONS=['Pacific Northwest','North Carolina','Texas','Midwest','South East','North East','California'] as const
const PAY_LEVELS=['trainee','experienced','active_manager_trainer'] as const
const payLevel=(value:any)=>PAY_LEVELS.includes(String(value||'') as any)?String(value):null
const displayName=(value:any)=>String(value??'').trim().replace(/\s+/g,' ')
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
    if(!callerAccess?.active||callerAccess.role!=='admin') return json({error:'admin_only'},403)
    if(action==='list_pending'){
      const {data,error}=await admin.from('rep_access_requests').select('*').eq('status','pending').order('created_at',{ascending:true}); if(error) throw error
      const {data:managerCandidates}=await admin.from('app_user_access').select('email,display_name,team_name,role,assigned_admin_email').eq('active',true).in('role',['manager','admin']).order('display_name')
      return json({ok:true,requests:data||[],managers:managerCandidates||[]})
    }
    if(action==='list_users'){
      const {data,error}=await admin.from('app_user_access').select('email,display_name,role,active,sales_classification,team_name,assigned_manager_email,assigned_manager_name,assigned_admin_email,assigned_admin_name').eq('active',true).order('display_name'); if(error) throw error
      return json({ok:true,users:data||[],pay_levels:PAY_LEVELS})
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
      const {data:m}=await admin.from('app_user_access').select('email,display_name,role,active,assigned_admin_email').eq('email',mgrEmail).maybeSingle()
      if(!m?.active||!['manager','admin'].includes(m.role)) throw new Error('invalid_manager')
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
    if(action==='assign_region_manager'){
      const region=String(body.region_name||'').trim();if(!REGIONS.includes(region as any))return json({error:'invalid_region'},400)
      const targetEmail=String(body.manager_email||'').trim().toLowerCase()||null
      const {data:teamRow,error:teamError}=await admin.from('teams').select('id,name,manager_user_id').eq('name',region).eq('active',true).maybeSingle();if(teamError)throw teamError;if(!teamRow)return json({error:'region_not_found'},404)
      if(!targetEmail){const {error:clearError}=await admin.from('teams').update({manager_user_id:null}).eq('id',teamRow.id);if(clearError)throw clearError;return json({ok:true,region_name:region,manager_email:null})}
      const {data:target,error:targetError}=await admin.from('app_user_access').select('email,display_name,role,active,team_name').eq('email',targetEmail).maybeSingle();if(targetError)throw targetError
      if(!target?.active)return json({error:'active_user_required'},404)
      const nextRole=target.role==='admin'?'admin':'manager'
      const primaryTeam=String(target.team_name||region).trim()||region
      await syncAppUserProfile(targetEmail,nextRole,primaryTeam,String(target.display_name||targetEmail),true)
      const {data:profile,error:profileError}=await admin.from('users').select('id').eq('email',targetEmail).eq('active',true).maybeSingle();if(profileError)throw profileError;if(!profile?.id)return json({error:'user_profile_not_found'},404)
      const accessPatch={role:nextRole,team_name:primaryTeam,assigned_manager_email:null,assigned_manager_name:null,assigned_admin_email:nextRole==='manager'?email:null,assigned_admin_name:nextRole==='manager'?(callerAccess.display_name||email):null}
      const {error:accessError}=await admin.from('app_user_access').update(accessPatch).eq('email',targetEmail);if(accessError)throw accessError
      const {error:assignError}=await admin.from('teams').update({manager_user_id:profile.id}).eq('id',teamRow.id);if(assignError)throw assignError
      return json({ok:true,region_name:region,manager_email:targetEmail,manager_name:target.display_name||targetEmail,manager_role:nextRole})
    }
    if(action==='approve'){
      const requestId=String(body.request_id||''); if(!requestId) return json({error:'request_id_required'},400)
      const {data:r}=await admin.from('rep_access_requests').select('*').eq('id',requestId).eq('status','pending').maybeSingle(); if(!r) return json({error:'pending_request_not_found'},404)
      const role=['rep','manager'].includes(String(body.role))?String(body.role):'rep'; const team=String(body.team_name||r.requested_team||'').trim().slice(0,120)||null
      const mgrRaw=String(body.assigned_manager_email||'').trim().toLowerCase()||null;let mgr={email:null as string|null,name:null as string|null}
      if(role==='rep'){try{mgr=await validateManager(mgrRaw)}catch{return json({error:'invalid_manager'},400)}}
      let owner={email:null as string|null,name:null as string|null};if(role==='manager'){const ownerRaw=String(body.assigned_admin_email||email).trim().toLowerCase();try{owner=await validateAdministrator(ownerRaw)}catch{return json({error:'invalid_administrator'},400)}}
      const displayName=String(body.display_name||r.display_name||r.email).trim().slice(0,120),targetEmail=r.email.toLowerCase()
      const requestedClassification=payLevel(body.sales_classification)
      if(body.sales_classification!==undefined&&body.sales_classification!==null&&String(body.sales_classification)!==''&&!requestedClassification)return json({error:'invalid_sales_classification',allowed:PAY_LEVELS},400)
      const classification=requestedClassification||(role==='rep'?'trainee':null)
      const {error:aerr}=await admin.from('app_user_access').upsert({email:targetEmail,role,active:true,display_name:displayName,sales_classification:classification,team_name:team,assigned_manager_email:role==='rep'?mgr.email:null,assigned_manager_name:role==='rep'?mgr.name:null,assigned_admin_email:role==='manager'?owner.email:null,assigned_admin_name:role==='manager'?owner.name:null},{onConflict:'email'});if(aerr)throw aerr
      await syncAppUserProfile(targetEmail,role,team,displayName,true)
      const {error:rerr}=await admin.from('rep_access_requests').update({status:'approved',reviewed_at:new Date().toISOString(),reviewed_by:email,notes:String(body.notes||'').slice(0,1000)}).eq('id',requestId);if(rerr)throw rerr
      return json({ok:true,approved_email:r.email,role,sales_classification:classification,team_name:team,assigned_manager_email:role==='rep'?mgr.email:null,assigned_admin_email:role==='manager'?owner.email:null})
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
      if(!targetAccess?.active||!['rep','manager'].includes(targetAccess.role))return json({error:'active_rep_or_manager_required'},404)
      const account=await findAuthAccountByEmail(target)
      if(!account?.id)return json({error:'user_not_found'},404)
      const {error:passwordError}=await admin.auth.admin.updateUserById(account.id,{password})
      if(passwordError)return json({error:'password_update_failed',detail:passwordError.message||'Unable to update this password.'},400)
      return json({ok:true,email:target,password_updated:true})
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
      const role=['rep','manager','admin'].includes(String(body.role))?String(body.role):current.role
      const classification=body.sales_classification===undefined?payLevel(current.sales_classification):payLevel(body.sales_classification)
      if(body.sales_classification!==undefined&&body.sales_classification!==null&&String(body.sales_classification)!==''&&!classification)return json({error:'invalid_sales_classification',allowed:PAY_LEVELS},400)
      const team=String(body.team_name??current.team_name??'').trim().slice(0,120)||null
      const mgrRaw=String(body.assigned_manager_email||'').trim().toLowerCase()||null;let mgr={email:null as string|null,name:null as string|null}
      if(role==='rep'){try{mgr=await validateManager(mgrRaw)}catch{return json({error:'invalid_manager'},400)}}
      const ownerValue=body.assigned_admin_email===undefined?current.assigned_admin_email:body.assigned_admin_email;const ownerRaw=String(ownerValue||'').trim().toLowerCase()||null;let owner={email:null as string|null,name:null as string|null}
      if(role==='manager'){try{owner=await validateAdministrator(ownerRaw)}catch{return json({error:'invalid_administrator'},400)}}
      const {error}=await admin.from('app_user_access').update({role,sales_classification:classification,team_name:team,assigned_manager_email:role==='rep'?mgr.email:null,assigned_manager_name:role==='rep'?mgr.name:null,assigned_admin_email:role==='manager'?owner.email:null,assigned_admin_name:role==='manager'?owner.name:null}).eq('email',target);if(error)throw error
      const account=await findAuthAccountByEmail(target);if(!account?.id)throw new Error('user_profile_account_not_found')
      let rename:any={changed:false,display_name:nextDisplayName},authMetadataSynced:null as boolean|null
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
      return json({ok:true,email:target,display_name:nextDisplayName,display_name_changed:nameChanged,auth_metadata_synced:authMetadataSynced,role,sales_classification:classification,team_name:team,assigned_manager_email:role==='rep'?mgr.email:null,assigned_admin_email:role==='manager'?owner.email:null})
    }
    if(action==='reject'){
      const requestId=String(body.request_id||''); if(!requestId) return json({error:'request_id_required'},400)
      const {error}=await admin.from('rep_access_requests').update({status:'rejected',reviewed_at:new Date().toISOString(),reviewed_by:email,notes:String(body.notes||'').slice(0,1000)}).eq('id',requestId).eq('status','pending'); if(error) throw error
      return json({ok:true})
    }
    return json({error:'unknown_action'},400)
  }catch(e){console.error(e);return json({error:'rep_onboarding_failed'},500)}
})
