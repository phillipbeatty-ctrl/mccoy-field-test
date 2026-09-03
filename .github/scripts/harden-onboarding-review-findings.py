from pathlib import Path
import json


def replace_once(text: str, before: str, after: str, label: str) -> str:
    if after in text:
        return text
    count = text.count(before)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one marker, found {count}")
    return text.replace(before, after, 1)


def replace_block(text: str, start_marker: str, end_marker: str, replacement: str, label: str) -> str:
    start = text.find(start_marker)
    if start < 0:
        raise SystemExit(f"{label}: start marker missing")
    end = text.find(end_marker, start)
    if end < 0:
        raise SystemExit(f"{label}: end marker missing")
    return text[:start] + replacement + text[end:]


pending_accounts_block = """    if(action==='list_pending_accounts'){
      const authUsers:any[]=[]
      for(let page=1;page<=20;page++){
        const {data:accountPage,error:accountError}=await admin.auth.admin.listUsers({page,perPage:1000});if(accountError)throw accountError
        const pageUsers=accountPage?.users||[];authUsers.push(...pageUsers);if(pageUsers.length<1000)break
      }
      const [{data:accessRows,error:accessError},{data:requestRows,error:requestError},{data:membershipRows,error:membershipError}]=await Promise.all([
        admin.from('app_user_access').select('email,display_name,role,active,created_at,organization_id').eq('organization_id',callerOrganizationId),
        admin.from('rep_access_requests').select('id,user_id,email,display_name,requested_role,requested_team,status,created_at,reviewed_at,organization_id').eq('organization_id',callerOrganizationId).order('created_at',{ascending:false}),
        admin.from('organization_memberships').select('auth_user_id,role,active,is_default,updated_at').eq('organization_id',callerOrganizationId)
      ])
      if(accessError)throw accessError;if(requestError)throw requestError;if(membershipError)throw membershipError
      const accessByEmail=new Map((accessRows||[]).map((row:any)=>[String(row.email||'').toLowerCase(),row]))
      const latestRequestByUser=new Map<string,any>()
      for(const row of requestRows||[]){const key=String(row.user_id||'');if(key&&!latestRequestByUser.has(key))latestRequestByUser.set(key,row)}
      const membershipByUser=new Map<string,any>()
      for(const row of membershipRows||[]){const key=String(row.auth_user_id||'');if(key&&!membershipByUser.has(key))membershipByUser.set(key,row)}
      const eligibleAuthUserIds=new Set<string>([
        ...(requestRows||[]).map((row:any)=>String(row.user_id||'')),
        ...(membershipRows||[]).map((row:any)=>String(row.auth_user_id||''))
      ].filter(Boolean))
      const eligibleEmails=new Set<string>((accessRows||[]).map((row:any)=>String(row.email||'').trim().toLowerCase()).filter(Boolean))
      const accounts=authUsers.filter((account:any)=>{
        const accountEmail=String(account.email||'').trim().toLowerCase();if(!accountEmail||account.is_anonymous||account.deleted_at)return false
        return eligibleAuthUserIds.has(String(account.id))||eligibleEmails.has(accountEmail)
      }).map((account:any)=>{
        const accountEmail=String(account.email||'').trim().toLowerCase(),access=accessByEmail.get(accountEmail) as any,request=latestRequestByUser.get(String(account.id)) as any,membership=membershipByUser.get(String(account.id)) as any
        const metadata=account.user_metadata||{},metadataName=String(metadata.full_name||metadata.name||[metadata.first_name,metadata.last_name].filter(Boolean).join(' ')||'').trim()
        const displayName=String(request?.display_name||access?.display_name||metadataName||accountEmail).trim()
        const emailConfirmedAt=account.email_confirmed_at||account.confirmed_at||null
        const accessActive=access?.active===true,membershipActive=membership?.active===true,requestPending=request?.status==='pending'
        if(emailConfirmedAt&&accessActive&&membershipActive&&!requestPending)return null
        const requiresMembershipRepair=accessActive&&!membershipActive
        const accessState=requiresMembershipRepair?'access_incomplete':!emailConfirmedAt?'email_unconfirmed':requestPending?'approval_requested':access?'access_inactive':'no_access_record'
        return {email:accountEmail,display_name:displayName,account_created_at:account.created_at||null,email_confirmed_at:emailConfirmedAt,last_sign_in_at:account.last_sign_in_at||null,access_state:accessState,access_active:accessActive,membership_active:membershipActive,requires_membership_repair:requiresMembershipRepair,auth_user_id:String(account.id),request:request?{id:request.id,status:request.status,requested_role:request.requested_role,requested_team:request.requested_team,created_at:request.created_at,reviewed_at:request.reviewed_at}:null}
      }).filter(Boolean).sort((left:any,right:any)=>String(right.account_created_at||'').localeCompare(String(left.account_created_at||'')))
      return json({ok:true,accounts})
    }
"""

grant_block = """    if(action==='grant_pending_account_access'){
      const target=String(body.email||'').trim().toLowerCase();if(!target)return json({error:'email_required'},400)
      const account=await findAuthAccountByEmail(target);if(!account?.id)return json({error:'user_not_found'},404)
      const [{data:existingAccess,error:accessLookupError},{data:request,error:requestError}]=await Promise.all([
        admin.from('app_user_access').select('email,display_name,active,organization_id').eq('email',target).maybeSingle(),
        admin.from('rep_access_requests').select('*').eq('organization_id',callerOrganizationId).eq('user_id',account.id).in('status',['pending','approved']).order('created_at',{ascending:false}).limit(1).maybeSingle()
      ])
      if(accessLookupError)throw accessLookupError;if(requestError)throw requestError
      if(existingAccess&&existingAccess.organization_id!==callerOrganizationId)return json({error:'account_belongs_to_another_organization'},409)
      if(existingAccess?.active)return json({error:'account_already_active'},409)
      if(!request&&!existingAccess)return json({error:'pending_account_not_found'},404)
      const metadata=account.user_metadata||{},metadataName=String(metadata.full_name||metadata.name||[metadata.first_name,metadata.last_name].filter(Boolean).join(' ')||'').trim()
      const displayName=String(request?.display_name||body.display_name||existingAccess?.display_name||metadataName||target).trim().slice(0,120)
      const team=String(request?.requested_team||'').trim().slice(0,120)||null
      const {error:accessError}=await admin.from('app_user_access').upsert({organization_id:callerOrganizationId,email:target,role:'rep',active:true,display_name:displayName,sales_classification:'trainee',team_name:team,assigned_manager_email:null,assigned_manager_name:null,assigned_admin_email:null,assigned_admin_name:null},{onConflict:'email'});if(accessError)throw accessError
      await syncAppUserProfile(target,'rep',team,displayName,true)
      if(request?.status==='pending'){
        const {error:reviewError}=await admin.from('rep_access_requests').update({status:'approved',reviewed_at:new Date().toISOString(),reviewed_by:email,notes:'Access granted from Pending Account Access.'}).eq('organization_id',callerOrganizationId).eq('id',request.id).eq('status','pending');if(reviewError)throw reviewError
      }
      return json({ok:true,email:target,role:'rep',sales_classification:'trainee',team_name:team,access_granted:true})
    }
"""

reset_pending_block = """    if(action==='reset_pending_password'){
      const target=String(body.email||'').trim().toLowerCase(),password=typeof body.password==='string'?body.password:''
      if(!target)return json({error:'email_required'},400)
      if(password.length<8)return json({error:'password_must_be_at_least_8_characters'},400)
      if(password.length>128)return json({error:'password_too_long'},400)
      const [{data:globalAccess,error:globalAccessError},{data:targetRequest,error:requestError}]=await Promise.all([
        admin.from('app_user_access').select('email,active,organization_id').eq('email',target).maybeSingle(),
        admin.from('rep_access_requests').select('id,user_id,status').eq('organization_id',callerOrganizationId).eq('email',target).in('status',['pending','approved']).order('created_at',{ascending:false}).limit(1).maybeSingle()
      ])
      if(globalAccessError)throw globalAccessError;if(requestError)throw requestError
      if(globalAccess&&globalAccess.organization_id!==callerOrganizationId)return json({error:'pending_account_not_found'},404)
      if(globalAccess?.active)return json({error:'account_is_already_active'},409)
      if(!globalAccess&&!targetRequest)return json({error:'pending_account_not_found'},404)
      const account=await findAuthAccountByEmail(target);if(!account?.id)return json({error:'user_not_found'},404)
      if(targetRequest?.user_id&&String(targetRequest.user_id)!==String(account.id))return json({error:'pending_account_identity_mismatch'},409)
      const {error:passwordError}=await admin.auth.admin.updateUserById(account.id,{password})
      if(passwordError)return json({error:'password_update_failed',detail:passwordError.message||'Unable to update this password.'},400)
      return json({ok:true,email:target,password_updated:true,access_granted:false})
    }
"""

rep_path = Path('supabase/functions/rep-onboarding/index.ts')
rep = rep_path.read_text()
rep = replace_block(rep, "    if(action==='list_pending_accounts'){", "    if(action==='list_regions'){", pending_accounts_block, 'legacy pending account tenant boundary')
rep = replace_block(rep, "    if(action==='grant_pending_account_access'){", "    if(action==='reset_pending_password'){", grant_block, 'pending access grant relationship boundary')
rep = replace_block(rep, "    if(action==='reset_pending_password'){", "    if(action==='reset_user_password'){", reset_pending_block, 'pending password relationship boundary')
rep_path.write_text(rep)

spotio_path = Path('supabase/functions/spotio-admin/index.ts')
spotio_path.write_text("""import { serveWithOrganizationAccess } from '../_shared/organization-paywall.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.95.0'
import { corsHeaders } from 'npm:@supabase/supabase-js@2.95.0/cors'
const json=(body:any,status=200)=>new Response(JSON.stringify(body),{status,headers:{...corsHeaders,'Content-Type':'application/json','Cache-Control':'no-store'}})
serveWithOrganizationAccess('provider_integrations',async(req)=>{
 if(req.method==='OPTIONS') return new Response('ok',{headers:corsHeaders})
 try{
  const token=(req.headers.get('Authorization')||'').replace(/^Bearer\\s+/,''); if(!token) return json({error:'unauthorized'},401)
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
""")

generator_path = Path('scripts/apply-edge-paywall-guards.mjs')
generator = generator_path.read_text()
anchor = "  if(source.includes(importLine)||source.includes(\"serveWithOrganizationAccess('admin_controls',\"))throw new Error('rep-onboarding: blanket organization wrapper remains')"
security_transform = f"""
  const replaceActionBlock=(input,startMarker,endMarker,replacement,label)=>{{
    const start=input.indexOf(startMarker)
    const end=start<0?-1:input.indexOf(endMarker,start)
    if(start<0||end<0)throw new Error(`rep-onboarding ${{label}} markers missing`)
    return input.slice(0,start)+replacement+input.slice(end)
  }}
  const pendingAccountsSafe={json.dumps(pending_accounts_block)}
  if(!source.includes('const eligibleAuthUserIds=new Set<string>'))source=replaceActionBlock(source,\"    if(action==='list_pending_accounts'){{\",\"    if(action==='list_regions'){{\",pendingAccountsSafe,'legacy pending account boundary')
  const grantSafe={json.dumps(grant_block)}
  if(!source.includes(\"if(!request&&!existingAccess)return json({{error:'pending_account_not_found'}},404)\"))source=replaceActionBlock(source,\"    if(action==='grant_pending_account_access'){{\",\"    if(action==='reset_pending_password'){{\",grantSafe,'pending grant relationship boundary')
  const resetPendingSafe={json.dumps(reset_pending_block)}
  if(!source.includes(\"if(!globalAccess&&!targetRequest)return json({{error:'pending_account_not_found'}},404)\"))source=replaceActionBlock(source,\"    if(action==='reset_pending_password'){{\",\"    if(action==='reset_user_password'){{\",resetPendingSafe,'pending password relationship boundary')

"""
if 'const pendingAccountsSafe=' not in generator:
    generator = replace_once(generator, anchor, security_transform + anchor, 'generator onboarding tenant hardening insertion')
generator_path.write_text(generator)

workflow_path = Path('.github/workflows/deploy-onboarding-integrity.yml')
workflow = workflow_path.read_text()
workflow = replace_once(
    workflow,
    "(github.event_name == 'workflow_dispatch' && github.event.inputs.confirmation == 'DEPLOY') ||",
    "(github.event_name == 'workflow_dispatch' && github.actor == 'phillipbeatty-ctrl' && github.event.inputs.confirmation == 'DEPLOY') ||",
    'owner gate manual deployment',
)
workflow_path.write_text(workflow)

tenant_test_path = Path('onboarding-tenant-boundary.test.mjs')
tenant_test = tenant_test_path.read_text()
tenant_test = replace_once(
    tenant_test,
    "const photoStage=readFileSync(new URL('./supabase/functions/provider-sale-photo-stage/index.ts',import.meta.url),'utf8')",
    "const photoStage=readFileSync(new URL('./supabase/functions/provider-sale-photo-stage/index.ts',import.meta.url),'utf8')\nconst spotioAdmin=readFileSync(new URL('./supabase/functions/spotio-admin/index.ts',import.meta.url),'utf8')",
    'load SPOTIO Admin source for tenant tests',
)
extra_tests = """

test('legacy pending-account actions require an existing caller-organization relationship',()=>{
  assert.match(repOnboarding,/const eligibleAuthUserIds=new Set<string>/)
  assert.match(repOnboarding,/\.from\('organization_memberships'\)\.select\('auth_user_id,role,active,is_default,updated_at'\)\.eq\('organization_id',callerOrganizationId\)/)
  assert.match(repOnboarding,/eligibleAuthUserIds\.has\(String\(account\.id\)\)\|\|eligibleEmails\.has\(accountEmail\)/)
  assert.match(repOnboarding,/if\(!request&&!existingAccess\)return json\(\{error:'pending_account_not_found'\},404\)/)
  assert.match(repOnboarding,/if\(!globalAccess&&!targetRequest\)return json\(\{error:'pending_account_not_found'\},404\)/)
  assert.match(repOnboarding,/pending_account_identity_mismatch/)
})

test('SPOTIO credentials require the default McCoy membership and matching Admin access',()=>{
  assert.match(spotioAdmin,/\.from\('organization_memberships'\)[\s\S]*\.eq\('auth_user_id',authUserId\)[\s\S]*\.eq\('is_default',true\)/)
  assert.match(spotioAdmin,/\.from\('organizations'\)[\s\S]*\.eq\('slug','mccoy-platform-llc'\)/)
  assert.match(spotioAdmin,/\.from\('app_user_access'\)[\s\S]*\.eq\('organization_id',membership\.organization_id\)[\s\S]*\.eq\('email',email\)/)
  assert.match(spotioAdmin,/!access\?\.active\|\|access\.role!=='admin'/)
})
"""
if "legacy pending-account actions require an existing caller-organization relationship" not in tenant_test:
    tenant_test += extra_tests
tenant_test_path.write_text(tenant_test)

membership_test_path = Path('onboarding-membership-integrity.test.mjs')
membership_test = membership_test_path.read_text()
membership_test = replace_once(
    membership_test,
    "  assert.match(deploymentWorkflow,/github\\.event\\.comment\\.body == 'DEPLOY_ONBOARDING_INTEGRITY_PR116'/)",
    "  assert.match(deploymentWorkflow,/github\\.event\\.comment\\.body == 'DEPLOY_ONBOARDING_INTEGRITY_PR116'/)\n  assert.match(deploymentWorkflow,/github\\.event_name == 'workflow_dispatch' && github\\.actor == 'phillipbeatty-ctrl'/)",
    'deployment manual owner assertion',
)
membership_test_path.write_text(membership_test)
