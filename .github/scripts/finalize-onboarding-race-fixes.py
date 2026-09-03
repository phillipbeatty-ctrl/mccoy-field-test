from pathlib import Path


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


access_helper = """    async function writeOrganizationAccess(record:any){
      const targetEmail=String(record?.email||'').trim().toLowerCase()
      if(!targetEmail)return {ok:false,error:'email_required'}
      const scopedRecord={...record,organization_id:callerOrganizationId,email:targetEmail}
      const {data:existing,error:lookupError}=await admin.from('app_user_access').select('email,organization_id').eq('email',targetEmail).maybeSingle()
      if(lookupError)throw lookupError
      if(existing&&String(existing.organization_id)!==String(callerOrganizationId))return {ok:false,error:'account_belongs_to_another_organization'}
      if(existing){
        const {data:updated,error:updateError}=await admin.from('app_user_access').update(scopedRecord).eq('email',targetEmail).eq('organization_id',callerOrganizationId).select('email').maybeSingle()
        if(updateError)throw updateError
        return updated?{ok:true}:{ok:false,error:'account_access_claim_conflict'}
      }
      const {data:inserted,error:insertError}=await admin.from('app_user_access').insert(scopedRecord).select('email').maybeSingle()
      if(insertError){
        if(String(insertError.code||'')==='23505')return {ok:false,error:'account_belongs_to_another_organization'}
        throw insertError
      }
      return inserted?{ok:true}:{ok:false,error:'account_access_claim_conflict'}
    }
"""

approve_block = """    if(action==='approve'){
      const requestId=String(body.request_id||''); if(!requestId) return json({error:'request_id_required'},400)
      const {data:r}=await admin.from('rep_access_requests').select('*').eq('organization_id',callerOrganizationId).eq('id',requestId).eq('status','pending').maybeSingle(); if(!r) return json({error:'pending_request_not_found'},404)
      const role=['rep','manager','trainer'].includes(String(body.role))?String(body.role):'rep'; const team=String(body.team_name||r.requested_team||'').trim().slice(0,120)||null
      const mgrRaw=String(body.assigned_manager_email||'').trim().toLowerCase()||null;let mgr={email:null as string|null,name:null as string|null}
      if(role==='rep'){try{mgr=await validateManager(mgrRaw)}catch{return json({error:'invalid_manager'},400)}}
      let owner={email:null as string|null,name:null as string|null};if(isTeamLeaderRole(role)){const ownerRaw=String(body.assigned_manager_email||body.assigned_admin_email||email).trim().toLowerCase();try{owner=await validateAdministrator(ownerRaw)}catch{return json({error:'invalid_administrator_team_leader'},400)};if(!owner.email)return json({error:'administrator_team_leader_required'},400)}
      const displayName=String(body.display_name||r.display_name||r.email).trim().slice(0,120),targetEmail=r.email.toLowerCase()
      const requestedClassification=payLevel(body.sales_classification)
      if(body.sales_classification!==undefined&&body.sales_classification!==null&&String(body.sales_classification)!==''&&!requestedClassification)return json({error:'invalid_sales_classification',allowed:PAY_LEVELS},400)
      const classification=requestedClassification||(role==='rep'?'trainee':null)
      const accessWrite=await writeOrganizationAccess({organization_id:callerOrganizationId,email:targetEmail,role,active:true,display_name:displayName,sales_classification:classification,team_name:team,assigned_manager_email:role==='rep'?mgr.email:isTeamLeaderRole(role)?owner.email:null,assigned_manager_name:role==='rep'?mgr.name:isTeamLeaderRole(role)?owner.name:null,assigned_admin_email:isTeamLeaderRole(role)?owner.email:null,assigned_admin_name:isTeamLeaderRole(role)?owner.name:null})
      if(!accessWrite.ok)return json({error:accessWrite.error||'account_access_claim_conflict'},409)
      const {error:rerr}=await admin.from('rep_access_requests').update({status:'approved',reviewed_at:new Date().toISOString(),reviewed_by:email,notes:String(body.notes||'').slice(0,1000)}).eq('organization_id',callerOrganizationId).eq('id',requestId).eq('status','pending');if(rerr)throw rerr
      return json({ok:true,approved_email:r.email,role,sales_classification:classification,team_name:team,assigned_manager_email:role==='rep'?mgr.email:isTeamLeaderRole(role)?owner.email:null,assigned_admin_email:isTeamLeaderRole(role)?owner.email:null})
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
      const accessWrite=await writeOrganizationAccess({organization_id:callerOrganizationId,email:target,role:'rep',active:true,display_name:displayName,sales_classification:'trainee',team_name:team,assigned_manager_email:null,assigned_manager_name:null,assigned_admin_email:null,assigned_admin_name:null})
      if(!accessWrite.ok)return json({error:accessWrite.error||'account_access_claim_conflict'},409)
      if(request?.status==='pending'){
        const {error:reviewError}=await admin.from('rep_access_requests').update({status:'approved',reviewed_at:new Date().toISOString(),reviewed_by:email,notes:'Access granted from Pending Account Access.'}).eq('organization_id',callerOrganizationId).eq('id',request.id).eq('status','pending');if(reviewError)throw reviewError
      }
      return json({ok:true,email:target,role:'rep',sales_classification:'trainee',team_name:team,access_granted:true})
    }
"""

rep_path = Path('supabase/functions/rep-onboarding/index.ts')
rep = rep_path.read_text()
helper_marker = "      const {error:profileError}=await admin.from('users').upsert({id:account.id,auth_user_id:account.id,organization_id:callerOrganizationId,email:targetEmail.toLowerCase(),first_name:firstName,last_name:lastName,role:role==='tester'?'rep':role,team_id:teamId,active},{onConflict:'auth_user_id'});if(profileError)throw profileError\n    }\n"
if 'async function writeOrganizationAccess(record:any)' not in rep:
    rep = replace_once(rep, helper_marker, helper_marker + access_helper, 'atomic access helper insertion')
rep = replace_block(rep, "    if(action==='approve'){", "    if(action==='grant_pending_account_access'){", approve_block, 'atomic approval block')
rep = replace_block(rep, "    if(action==='grant_pending_account_access'){", "    if(action==='reset_pending_password'){", grant_block, 'atomic pending grant block')
rep_path.write_text(rep)

generator_path = Path('scripts/apply-edge-paywall-guards.mjs')
generator = generator_path.read_text()
generator = '\n'.join(line for line in generator.splitlines() if "'approval access organization'" not in line) + '\n'
generator = replace_once(
    generator,
    "  if(!source.includes('existingTargetAccessError'))source=replaceRequired(source,approveTargetLine,approveGuard,'rep-onboarding approval cross-organization guard')",
    "  if(!source.includes('writeOrganizationAccess')&&!source.includes('existingTargetAccessError'))source=replaceRequired(source,approveTargetLine,approveGuard,'rep-onboarding approval cross-organization guard')",
    'skip superseded approval guard transform',
)
invariant_anchor = "  if(source.includes(importLine)||source.includes(\"serveWithOrganizationAccess('admin_controls',\"))throw new Error('rep-onboarding: blanket organization wrapper remains')"
atomic_invariants = """  if(!source.includes('async function writeOrganizationAccess(record:any)'))throw new Error('rep-onboarding: atomic organization access writer missing')
  const approveAtomicBlock=source.slice(source.indexOf("if(action==='approve')"),source.indexOf("if(action==='grant_pending_account_access')"))
  const grantAtomicBlock=source.slice(source.indexOf("if(action==='grant_pending_account_access')"),source.indexOf("if(action==='reset_pending_password')"))
  if(!approveAtomicBlock.includes('writeOrganizationAccess(')||approveAtomicBlock.includes(".from('app_user_access').upsert("))throw new Error('rep-onboarding: approval access claim is not atomic')
  if(!grantAtomicBlock.includes('writeOrganizationAccess(')||grantAtomicBlock.includes(".from('app_user_access').upsert("))throw new Error('rep-onboarding: pending grant access claim is not atomic')
  if(!source.includes("String(insertError.code||'')==='23505'"))throw new Error('rep-onboarding: competing organization claim is not rejected')

"""
if 'approval access claim is not atomic' not in generator:
    generator = replace_once(generator, invariant_anchor, atomic_invariants + invariant_anchor, 'atomic access generator invariants')
generator_path.write_text(generator)

tenant_path = Path('onboarding-tenant-boundary.test.mjs')
tenant = tenant_path.read_text()
extra = """

test('approval and pending grants cannot atomically claim another organization account',()=>{
  assert.match(repOnboarding,/async function writeOrganizationAccess\(record:any\)/)
  assert.match(repOnboarding,/\.update\(scopedRecord\)\.eq\('email',targetEmail\)\.eq\('organization_id',callerOrganizationId\)/)
  assert.match(repOnboarding,/\.from\('app_user_access'\)\.insert\(scopedRecord\)/)
  assert.match(repOnboarding,/String\(insertError\.code\|\|'\'\)==='23505'/)
  const approve=repOnboarding.slice(repOnboarding.indexOf("if(action==='approve')"),repOnboarding.indexOf("if(action==='grant_pending_account_access')"))
  const grant=repOnboarding.slice(repOnboarding.indexOf("if(action==='grant_pending_account_access')"),repOnboarding.indexOf("if(action==='reset_pending_password')"))
  assert.match(approve,/writeOrganizationAccess\(/)
  assert.match(grant,/writeOrganizationAccess\(/)
  assert.doesNotMatch(approve,/\.from\('app_user_access'\)\.upsert\(/)
  assert.doesNotMatch(grant,/\.from\('app_user_access'\)\.upsert\(/)
})
"""
if "approval and pending grants cannot atomically claim another organization account" not in tenant:
    tenant += extra
tenant_path.write_text(tenant)

paywall_path = Path('paywall-phase2.test.mjs')
paywall = paywall_path.read_text()
paywall = replace_once(
    paywall,
    "  assert.match(repOnboarding,/organization_id:callerAccess\\.organization_id,email:targetEmail/)",
    "  assert.match(repOnboarding,/organization_id:callerOrganizationId,email:targetEmail/)",
    'paywall approval organization assertion',
)
paywall_path.write_text(paywall)

membership_path = Path('onboarding-membership-integrity.test.mjs')
membership = membership_path.read_text()
membership = replace_once(
    membership,
    "const requestScope=readFileSync(new URL('./supabase/migrations/20260903015716_scope_rep_access_requests_to_organization.sql',import.meta.url),'utf8')",
    "const requestScope=readFileSync(new URL('./supabase/migrations/20260903015716_scope_rep_access_requests_to_organization.sql',import.meta.url),'utf8')\nconst softDeleteCleanup=readFileSync(new URL('./supabase/migrations/20260903034000_deactivate_soft_deleted_auth_identity.sql',import.meta.url),'utf8')",
    'load soft-delete cleanup migration',
)
soft_test = """

test('deactivation survives Auth soft deletion without allowing deleted accounts to reactivate',()=>{
  assert.match(softDeleteCleanup,/select lower\(u\.email\),u\.deleted_at[\s\S]*where u\.id=p_auth_user_id/)
  assert.match(softDeleteCleanup,/if coalesce\(p_active,false\) and \(v_auth_email is null or v_auth_deleted_at is not null\)/)
  assert.match(softDeleteCleanup,/from public\.organization_memberships m[\s\S]*m\.organization_id=old\.organization_id[\s\S]*lower\(m\.email\)=lower\(old\.email\)/)
  assert.match(softDeleteCleanup,/from public\.users p[\s\S]*p\.organization_id=new\.organization_id[\s\S]*lower\(p\.email\)=lower\(new\.email\)/)
  assert.match(softDeleteCleanup,/revoke all on function private\.sync_app_access_identity/)
})
"""
if "deactivation survives Auth soft deletion" not in membership:
    membership += soft_test
membership_path.write_text(membership)
