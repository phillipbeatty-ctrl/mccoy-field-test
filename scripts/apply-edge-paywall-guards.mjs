#!/usr/bin/env node
import {readdir,readFile,writeFile} from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {edgePaywallExemptions,edgePaywallTargets} from './paywall-targets.mjs'

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const functionsRoot=path.join(root,'supabase','functions')
const importLine="import { serveWithOrganizationAccess } from '../_shared/organization-paywall.ts'"
const writeMode=process.argv.includes('--write')

const functionDirectories=(await readdir(functionsRoot,{withFileTypes:true}))
  .filter(entry=>entry.isDirectory()&&entry.name!=='_shared')
  .map(entry=>entry.name)
  .sort()
const missingTargets=[...edgePaywallTargets.keys()].filter(slug=>!functionDirectories.includes(slug))
const missingExemptions=[...edgePaywallExemptions.keys()].filter(slug=>!functionDirectories.includes(slug))
if(missingTargets.length)throw new Error(`missing protected Edge Functions: ${missingTargets.join(', ')}`)
if(missingExemptions.length)throw new Error(`missing exempt Edge Functions: ${missingExemptions.join(', ')}`)

const changed=[]
const unchanged=[]
const drift=[]

function replaceRequired(source,before,after,label){
  if(source.includes(after))return source
  if(!source.includes(before))throw new Error(`${label}: expected source marker was not found`)
  return source.replace(before,after)
}

async function applyDeterministicTransform(slug,label,transform){
  const file=path.join(functionsRoot,slug,'index.ts')
  const original=await readFile(file,'utf8')
  const source=transform(original)
  const reportLabel=`${slug}:${label}`
  if(source!==original){
    drift.push(reportLabel)
    if(writeMode){
      await writeFile(file,source)
      changed.push(reportLabel)
    }
  }else{
    unchanged.push(reportLabel)
  }
}

// rep-onboarding deliberately keeps status and request_access available before a
// membership exists. Every roster/Admin action is entitlement checked internally,
// and every service-role query is explicitly constrained to the caller organization.
await applyDeterministicTransform('rep-onboarding','mixed_pre_membership_admin',source=>{
  source=source.replace(`${importLine}\n`,'')
  source=source.replace(/serveWithOrganizationAccess\(\s*['"]admin_controls['"]\s*,/,'Deno.serve(')

  source=replaceRequired(
    source,
    ".select('email,role,active,display_name,sales_classification,team_name,assigned_manager_email,assigned_manager_name,assigned_admin_email,assigned_admin_name')",
    ".select('email,role,active,display_name,sales_classification,team_name,assigned_manager_email,assigned_manager_name,assigned_admin_email,assigned_admin_name,organization_id')",
    'rep-onboarding caller organization selection'
  )

  source=replaceRequired(
  source,
  "    const {data:{user},error:uerr}=await admin.auth.getUser(jwt); if(uerr||!user?.email) return json({error:'unauthorized'},401)\n    const email=user.email.toLowerCase(); const body=await req.json().catch(()=>({})); const action=String(body.action||'status')",
  "    const {data:{user},error:uerr}=await admin.auth.getUser(jwt); if(uerr||!user?.email) return json({error:'unauthorized'},401)\n    const authUserId=user.id\n    const email=user.email.toLowerCase(); const body=await req.json().catch(()=>({})); const action=String(body.action||'status')",
  'rep-onboarding stable Auth identity capture'
)

  const callerAccessLine="    const {data:callerAccess}=await admin.from('app_user_access').select('email,role,active,display_name,sales_classification,team_name,assigned_manager_email,assigned_manager_name,assigned_admin_email,assigned_admin_name,organization_id').eq('email',email).maybeSingle()"
  const accessHelpers=`${callerAccessLine}\n    async function requireOrganizationAccess(entitlement:string){\n      const {error}=await admin.rpc('service_assert_organization_access',{p_auth_user_id:authUserId,p_entitlement:entitlement})\n      if(!error)return null\n      const reason=String(error.message||'').match(/organization_access_denied:([a-z0-9_]+)/i)?.[1]||'organization_access_denied'\n      return json({error:'organization_access_denied',reason,organization_access:{access_allowed:false,denial_reason:reason,entitlement_key:entitlement,purchase_model:'organization_managed_external',purchase_action_available:false}},403)\n    }\n    async function resolveRequestOrganizationId(){\n      if(callerAccess?.organization_id)return callerAccess.organization_id\n      const {data:organization,error}=await admin.from('organizations').select('id').eq('slug','mccoy-platform-llc').eq('active',true).maybeSingle()\n      if(error)throw error\n      if(!organization?.id)throw new Error('request_organization_not_configured')\n      return organization.id\n    }`
  if(!source.includes('async function resolveRequestOrganizationId()')){
    source=replaceRequired(source,callerAccessLine,accessHelpers,'rep-onboarding access helpers')
  }

  source=replaceRequired(
    source,
    "    if(action==='status'){\n      const {data:reqRow}=await admin.from('rep_access_requests').select('*').eq('user_id',user.id).order('created_at',{ascending:false}).limit(1).maybeSingle()",
    "    if(action==='status'){\n      const requestOrganizationId=await resolveRequestOrganizationId()\n      const {data:reqRow}=await admin.from('rep_access_requests').select('*').eq('organization_id',requestOrganizationId).eq('user_id',user.id).order('created_at',{ascending:false}).limit(1).maybeSingle()",
    'rep-onboarding status request organization scope'
  )

  source=replaceRequired(
    source,
    "    if(action==='request_access'){\n      if(callerAccess?.active) return json({ok:true,access:callerAccess,already_authorized:true})\n      const displayName=String(body.display_name||'').trim().slice(0,120); const team=String(body.requested_team||'').trim().slice(0,120)||null",
    "    if(action==='request_access'){\n      if(callerAccess?.active) return json({ok:true,access:callerAccess,already_authorized:true})\n      const requestOrganizationId=await resolveRequestOrganizationId()\n      const displayName=String(body.display_name||'').trim().slice(0,120); const team=String(body.requested_team||'').trim().slice(0,120)||null",
    'rep-onboarding request organization resolution'
  )
  source=replaceRequired(
    source,
    "admin.from('rep_access_requests').select('*').eq('user_id',user.id).in('status',['pending','approved'])",
    "admin.from('rep_access_requests').select('*').eq('organization_id',requestOrganizationId).eq('user_id',user.id).in('status',['pending','approved'])",
    'rep-onboarding request duplicate organization scope'
  )
  source=replaceRequired(
    source,
    "admin.from('rep_access_requests').insert({user_id:user.id,email,display_name:displayName,requested_role:'rep',requested_team:team,status:'pending'})",
    "admin.from('rep_access_requests').insert({organization_id:requestOrganizationId,user_id:user.id,email,display_name:displayName,requested_role:'rep',requested_team:team,status:'pending'})",
    'rep-onboarding request insert organization scope'
  )

  const teamBefore="    if(action==='team_rosters'){\n      if(!callerAccess?.active)return json({error:'forbidden'},403)"
  const teamAfter="    if(action==='team_rosters'){\n      if(!callerAccess?.active)return json({error:'forbidden'},403)\n      const teamAccessDenied=await requireOrganizationAccess('field_coach_access')\n      if(teamAccessDenied)return teamAccessDenied"
  source=replaceRequired(source,teamBefore,teamAfter,'rep-onboarding roster access assertion')

  const adminBefore="    if(!callerAccess?.active||callerAccess.role!=='admin') return json({error:'admin_only'},403)"
  const adminAfter="    if(!callerAccess?.active||callerAccess.role!=='admin') return json({error:'admin_only'},403)\n    const callerOrganizationId=callerAccess.organization_id\n    const adminAccessDenied=await requireOrganizationAccess('admin_controls')\n    if(adminAccessDenied)return adminAccessDenied"
  source=replaceRequired(source,adminBefore,adminAfter,'rep-onboarding Admin entitlement assertion')

  const replacements=[
    ["admin.from('app_user_access').select('email,display_name,role,sales_classification,team_name,assigned_manager_email,assigned_manager_name').eq('active',true)","admin.from('app_user_access').select('email,display_name,role,sales_classification,team_name,assigned_manager_email,assigned_manager_name').eq('organization_id',callerAccess.organization_id).eq('active',true)",'team roster access rows'],
    ["admin.from('users').select('id,email').eq('active',true)","admin.from('users').select('id,email').eq('organization_id',callerAccess.organization_id).eq('active',true)",'team roster profiles'],
    ["admin.from('teams').select('name,manager_user_id').eq('active',true)","admin.from('teams').select('name,manager_user_id').eq('organization_id',callerAccess.organization_id).eq('active',true)",'team roster teams'],
    ["admin.from('rep_access_requests').select('*').eq('status','pending')","admin.from('rep_access_requests').select('*').eq('organization_id',callerAccess.organization_id).eq('status','pending')",'pending request list'],
    ["admin.from('app_user_access').select('email,display_name,team_name,role,assigned_admin_email').eq('active',true)","admin.from('app_user_access').select('email,display_name,team_name,role,assigned_admin_email').eq('organization_id',callerAccess.organization_id).eq('active',true)",'manager candidates'],
    ["admin.from('app_user_access').select('email,display_name,role,active,sales_classification,team_name,assigned_manager_email,assigned_manager_name,assigned_admin_email,assigned_admin_name').eq('active',true)","admin.from('app_user_access').select('email,display_name,role,active,sales_classification,team_name,assigned_manager_email,assigned_manager_name,assigned_admin_email,assigned_admin_name').eq('organization_id',callerAccess.organization_id).eq('active',true)",'Admin user list'],
    ["admin.from('app_user_access').select('email,display_name,role,active,created_at')","admin.from('app_user_access').select('email,display_name,role,active,created_at').eq('organization_id',callerAccess.organization_id)",'pending account access rows'],
    ["admin.from('rep_access_requests').select('id,user_id,email,display_name,requested_role,requested_team,status,created_at,reviewed_at').order('created_at',{ascending:false})","admin.from('rep_access_requests').select('id,user_id,email,display_name,requested_role,requested_team,status,created_at,reviewed_at,organization_id').eq('organization_id',callerAccess.organization_id).order('created_at',{ascending:false})",'pending account requests'],
    ["admin.from('teams').select('id,name,active,manager_user_id').in('name',[...REGIONS])","admin.from('teams').select('id,name,active,manager_user_id').eq('organization_id',callerAccess.organization_id).in('name',[...REGIONS])",'region teams'],
    ["admin.from('app_user_access').select('email,display_name,role,active,team_name').eq('active',true)","admin.from('app_user_access').select('email,display_name,role,active,team_name').eq('organization_id',callerAccess.organization_id).eq('active',true)",'region accounts'],
    ["admin.from('users').select('id,email,role,active').eq('active',true)","admin.from('users').select('id,email,role,active').eq('organization_id',callerAccess.organization_id).eq('active',true)",'region profiles'],
    ["admin.from('app_user_access').select('email,display_name,role,active,assigned_manager_email,assigned_admin_email').eq('email',mgrEmail)","admin.from('app_user_access').select('email,display_name,role,active,assigned_manager_email,assigned_admin_email').eq('organization_id',callerOrganizationId).eq('email',mgrEmail)",'manager validation'],
    ["admin.from('app_user_access').select('email,display_name,role,active').eq('email',adminEmail)","admin.from('app_user_access').select('email,display_name,role,active').eq('organization_id',callerOrganizationId).eq('email',adminEmail)",'administrator validation'],
    ["admin.from('teams').select('id').eq('name',team).maybeSingle()","admin.from('teams').select('id').eq('organization_id',callerOrganizationId).eq('name',team).maybeSingle()",'profile team scope'],
    ["admin.from('users').upsert({id:account.id,auth_user_id:account.id,email:targetEmail.toLowerCase()","admin.from('users').upsert({id:account.id,auth_user_id:account.id,organization_id:callerOrganizationId,email:targetEmail.toLowerCase()",'profile organization scope'],
    ["admin.from('teams').select('id,name,manager_user_id').eq('name',region)","admin.from('teams').select('id,name,manager_user_id').eq('organization_id',callerAccess.organization_id).eq('name',region)",'region manager team scope'],
    ["admin.from('app_user_access').select('email,display_name,role,active,team_name').eq('email',targetEmail)","admin.from('app_user_access').select('email,display_name,role,active,team_name').eq('organization_id',callerAccess.organization_id).eq('email',targetEmail)",'region manager target scope'],
    ["admin.from('users').select('id').eq('email',targetEmail).eq('active',true)","admin.from('users').select('id').eq('organization_id',callerAccess.organization_id).eq('email',targetEmail).eq('active',true)",'region manager profile scope'],
    ["admin.from('app_user_access').update(accessPatch).eq('email',targetEmail)","admin.from('app_user_access').update(accessPatch).eq('organization_id',callerAccess.organization_id).eq('email',targetEmail)",'region manager access update scope'],
    ["admin.from('rep_access_requests').select('*').eq('id',requestId).eq('status','pending')","admin.from('rep_access_requests').select('*').eq('organization_id',callerAccess.organization_id).eq('id',requestId).eq('status','pending')",'approval request scope'],
    ["admin.from('app_user_access').upsert({email:targetEmail,role,active:true","admin.from('app_user_access').upsert({organization_id:callerAccess.organization_id,email:targetEmail,role,active:true",'approval access organization'],
    ["admin.from('rep_access_requests').update({status:'approved',reviewed_at:new Date().toISOString(),reviewed_by:email,notes:String(body.notes||'').slice(0,1000)}).eq('id',requestId)","admin.from('rep_access_requests').update({status:'approved',reviewed_at:new Date().toISOString(),reviewed_by:email,notes:String(body.notes||'').slice(0,1000)}).eq('organization_id',callerAccess.organization_id).eq('id',requestId)",'approval update scope'],
    ["admin.from('rep_access_requests').select('*').eq('user_id',account.id).order('created_at',{ascending:false})","admin.from('rep_access_requests').select('*').eq('organization_id',callerAccess.organization_id).eq('user_id',account.id).order('created_at',{ascending:false})",'grant request scope'],
    ["admin.from('app_user_access').upsert({email:target,role:'rep',active:true","admin.from('app_user_access').upsert({organization_id:callerAccess.organization_id,email:target,role:'rep',active:true",'grant access organization'],
    ["admin.from('rep_access_requests').update({status:'approved',reviewed_at:new Date().toISOString(),reviewed_by:email,notes:'Access granted from Pending Account Access.'}).eq('id',request.id)","admin.from('rep_access_requests').update({status:'approved',reviewed_at:new Date().toISOString(),reviewed_by:email,notes:'Access granted from Pending Account Access.'}).eq('organization_id',callerAccess.organization_id).eq('id',request.id)",'grant request update scope'],
    ["admin.from('app_user_access').select('email,active').eq('email',target)","admin.from('app_user_access').select('email,active').eq('organization_id',callerAccess.organization_id).eq('email',target)",'pending password access scope'],
    ["admin.from('app_user_access').select('email,role,active').eq('email',target)","admin.from('app_user_access').select('email,role,active').eq('organization_id',callerAccess.organization_id).eq('email',target)",'active password access scope'],
    ["admin.from('app_user_access').select('*').eq('email',target).eq('active',true)","admin.from('app_user_access').select('*').eq('organization_id',callerAccess.organization_id).eq('email',target).eq('active',true)",'update user target scope'],
    ["admin.from('app_user_access').update({role,sales_classification:classification,team_name:team,assigned_manager_email:role==='rep'?mgr.email:isTeamLeaderRole(role)?owner.email:null,assigned_manager_name:role==='rep'?mgr.name:isTeamLeaderRole(role)?owner.name:null,assigned_admin_email:isTeamLeaderRole(role)?owner.email:null,assigned_admin_name:isTeamLeaderRole(role)?owner.name:null}).eq('email',target)","admin.from('app_user_access').update({role,sales_classification:classification,team_name:team,assigned_manager_email:role==='rep'?mgr.email:isTeamLeaderRole(role)?owner.email:null,assigned_manager_name:role==='rep'?mgr.name:isTeamLeaderRole(role)?owner.name:null,assigned_admin_email:isTeamLeaderRole(role)?owner.email:null,assigned_admin_name:isTeamLeaderRole(role)?owner.name:null}).eq('organization_id',callerAccess.organization_id).eq('email',target)",'update user write scope'],
    ["admin.from('rep_access_requests').update({status:'rejected',reviewed_at:new Date().toISOString(),reviewed_by:email,notes:String(body.notes||'').slice(0,1000)}).eq('id',requestId)","admin.from('rep_access_requests').update({status:'rejected',reviewed_at:new Date().toISOString(),reviewed_by:email,notes:String(body.notes||'').slice(0,1000)}).eq('organization_id',callerAccess.organization_id).eq('id',requestId)",'reject request scope']
  ]
  for(const [before,after,label] of replacements)source=replaceRequired(source,before,after,`rep-onboarding ${label}`)

  const approveTargetLine="      const displayName=String(body.display_name||r.display_name||r.email).trim().slice(0,120),targetEmail=r.email.toLowerCase()"
  const approveGuard=`${approveTargetLine}\n      const {data:existingTargetAccess,error:existingTargetAccessError}=await admin.from('app_user_access').select('organization_id').eq('email',targetEmail).maybeSingle()\n      if(existingTargetAccessError)throw existingTargetAccessError\n      if(existingTargetAccess&&existingTargetAccess.organization_id!==callerAccess.organization_id)return json({error:'account_belongs_to_another_organization'},409)`
  if(!source.includes('existingTargetAccessError'))source=replaceRequired(source,approveTargetLine,approveGuard,'rep-onboarding approval cross-organization guard')

  const grantLookup="      const {data:existingAccess,error:accessLookupError}=await admin.from('app_user_access').select('email,display_name,active').eq('email',target).maybeSingle();if(accessLookupError)throw accessLookupError\n      if(existingAccess?.active)return json({error:'account_already_active'},409)"
  const grantGuard="      const {data:existingAccess,error:accessLookupError}=await admin.from('app_user_access').select('email,display_name,active,organization_id').eq('email',target).maybeSingle();if(accessLookupError)throw accessLookupError\n      if(existingAccess&&existingAccess.organization_id!==callerAccess.organization_id)return json({error:'account_belongs_to_another_organization'},409)\n      if(existingAccess?.active)return json({error:'account_already_active'},409)"
  source=replaceRequired(source,grantLookup,grantGuard,'rep-onboarding grant cross-organization guard')

  const removalSelfCheck="      if(target===email)return json({error:'cannot_delete_own_account'},403)"
  const removalScope=`${removalSelfCheck}\n      const {data:targetAccess,error:targetAccessError}=await admin.from('app_user_access').select('email,active').eq('organization_id',callerAccess.organization_id).eq('email',target).maybeSingle()\n      if(targetAccessError)throw targetAccessError\n      if(!targetAccess)return json({error:'active_auth_account_not_found'},404)`
  if(!source.includes('targetAccessError'))source=replaceRequired(source,removalSelfCheck,removalScope,'rep-onboarding removal organization scope')

  if(source.includes(importLine)||source.includes("serveWithOrganizationAccess('admin_controls',"))throw new Error('rep-onboarding: blanket organization wrapper remains')
  if(!source.includes('Deno.serve(async(req)=>{'))throw new Error('rep-onboarding: Deno handler was not restored')
  return source
})

await applyDeterministicTransform('pending-account-access','request_organization_scope',source=>{
  source=replaceRequired(source,`${importLine}\n// @ts-nocheck\n`,`// @ts-nocheck\n${importLine}\n`,'pending-account-access TypeScript directive position')
  const before="  const requestsPromise=admin.from('rep_access_requests')\n    .select('id,user_id,email,display_name,requested_role,requested_team,status,created_at,reviewed_at')\n    .order('created_at',{ascending:false})"
  const after="  const requestsPromise=admin.from('rep_access_requests')\n    .select('id,user_id,email,display_name,requested_role,requested_team,status,created_at,reviewed_at,organization_id')\n    .eq('organization_id',caller.organization_id)\n    .order('created_at',{ascending:false})"
  return replaceRequired(source,before,after,'pending-account-access request organization scope')
})

await applyDeterministicTransform('provider-sale-photo-stage','organization_capture_scope_and_atomic_finalize',source=>{
const authBefore="    const { data: { user }, error: userError } = await admin.auth.getUser(jwt)\n    if (userError || !user?.email) return json({ error: 'unauthorized' }, 401)\n\n    const email = user.email.toLowerCase()"
const authAfter="    const { data: { user }, error: userError } = await admin.auth.getUser(jwt)\n    if (userError || !user?.email) return json({ error: 'unauthorized' }, 401)\n    const authUserId = user.id\n\n    const email = user.email.toLowerCase()"
source=replaceRequired(source,authBefore,authAfter,'provider-sale-photo-stage stable Auth identity capture')
  const captureBefore="      const { data, error } = await admin\n        .from('provider_sale_captures')\n        .select('id,client_request_id,rep_user_id,rep_email,provider,status,service_address')\n        .eq('id', id)\n        .eq('rep_user_id', user.id)"
  const captureLegacyAfter="      const { data, error } = await admin\n        .from('provider_sale_captures')\n        .select('id,client_request_id,rep_user_id,rep_email,provider,status,service_address')\n        .eq('id', id)\n        .eq('organization_id', organizationId)\n        .eq('rep_user_id', user.id)"
  const captureAfter="      const { data, error } = await admin\n        .from('provider_sale_captures')\n        .select('id,client_request_id,rep_user_id,rep_email,provider,status,service_address')\n        .eq('id', id)\n        .eq('organization_id', organizationId)\n        .eq('rep_user_id', authUserId)"
  if(source.includes(captureLegacyAfter))source=replaceRequired(source,captureLegacyAfter,captureAfter,'provider-sale-photo-stage stable capture identity')
  else source=replaceRequired(source,captureBefore,captureAfter,'provider-sale-photo-stage capture tenant scope')


const nestedIdentityReplacements=[
  ["        .eq('organization_id', organizationId)\n        .eq('uploaded_by', user.id)\n        .in('status', ['uploading', 'staged', 'failed'])","        .eq('organization_id', organizationId)\n        .eq('uploaded_by', authUserId)\n        .in('status', ['uploading', 'staged', 'failed'])",'expired query identity'],
  ["          .delete()\n          .in('id', (expired || []).map(row => row.id))\n          .eq('uploaded_by', user.id)","          .delete()\n          .in('id', (expired || []).map(row => row.id))\n          .eq('uploaded_by', authUserId)",'expired delete identity'],
  ["        .eq('id', id)\n        .eq('organization_id', organizationId)\n        .eq('uploaded_by', user.id)\n        .maybeSingle()","        .eq('id', id)\n        .eq('organization_id', organizationId)\n        .eq('uploaded_by', authUserId)\n        .maybeSingle()",'staged photo identity'],
  ["        .eq('id', id)\n        .eq('organization_id', organizationId)\n        .eq('rep_user_id', user.id)\n        .eq('provider_capture_id', captureId)","        .eq('id', id)\n        .eq('organization_id', organizationId)\n        .eq('rep_user_id', authUserId)\n        .eq('provider_capture_id', captureId)",'completed sale identity']
]
for(const [before,after,label] of nestedIdentityReplacements)source=replaceRequired(source,before,after,`provider-sale-photo-stage ${label}`)
  const oldBlock=`        if (!['staged', 'attaching', 'failed'].includes(row.status)) continue

        const salePhotoId = row.attached_sale_photo_id || crypto.randomUUID()
        const targetPath = \`${'${organizationId}'}/${'${saleId}'}/${'${salePhotoId}'}.${'${ext(row.mime_type)}'}\`
        await admin.from('provider_sale_capture_photos').update({
          status: 'attaching',
          attached_sale_id: saleId,
          attached_sale_photo_id: salePhotoId,
          attachment_error: null,
          updated_at: new Date().toISOString()
        }).eq('id', row.id).eq('uploaded_by', user.id)

        try {
          const { data: file, error: downloadError } = await admin.storage.from(STAGING_BUCKET).download(row.storage_path)
          if (downloadError || !file) throw downloadError || new Error('staged_photo_download_failed')
          const { error: uploadError } = await admin.storage.from(SALE_BUCKET).upload(targetPath, file, {
            contentType: row.mime_type,
            upsert: true,
            cacheControl: '0'
          })
          if (uploadError) throw uploadError

          const { error: photoInsertError } = await admin.from('sale_order_photos').upsert({
            id: salePhotoId,
            sale_id: saleId,
            organization_id: organizationId,
            uploaded_by: user.id,
            uploaded_by_email: email,
            storage_path: targetPath,
            mime_type: row.mime_type,
            file_size_bytes: row.file_size_bytes,
            extraction_status: 'uploaded',
            extracted_fields: {}
          }, { onConflict: 'id' })
          if (photoInsertError) throw photoInsertError

          const now = new Date().toISOString()
          const { error: attachedError } = await admin.from('provider_sale_capture_photos').update({
            status: 'attached',
            attached_sale_id: saleId,
            attached_sale_photo_id: salePhotoId,
            attached_at: now,
            updated_at: now,
            attachment_error: null
          }).eq('id', row.id).eq('uploaded_by', user.id)
          if (attachedError) throw attachedError

          // Mark the database attachment first. If object cleanup fails, the
          // completed sale still owns the evidence and the operation remains
          // idempotent on retry.
          const { error: removeError } = await admin.storage.from(STAGING_BUCKET).remove([row.storage_path])
          if (removeError) console.error('provider-sale-photo-stage staged object cleanup', removeError)
          salePhotoIds.push(salePhotoId)
        } catch (attachError) {
          const detail = text((attachError as Error)?.message || attachError).slice(0, 300)
          failures.push(\`${'${row.id}'}:${'${detail}'}\`)
          await admin.from('provider_sale_capture_photos').update({
            status: 'failed',
            attached_sale_id: saleId,
            attached_sale_photo_id: salePhotoId,
            attachment_error: detail,
            updated_at: new Date().toISOString()
          }).eq('id', row.id).eq('uploaded_by', user.id)
        }`

  const newBlock=`        if (!['staged', 'attaching', 'failed'].includes(row.status)) continue

        const salePhotoId = row.attached_sale_photo_id || crypto.randomUUID()
        const claimTime = new Date().toISOString()
        const staleBefore = new Date(Date.now() - 5 * 60_000).toISOString()
        let claimQuery = admin.from('provider_sale_capture_photos').update({
          status: 'attaching',
          attached_sale_id: saleId,
          attached_sale_photo_id: salePhotoId,
          attachment_error: null,
          updated_at: claimTime
        })
          .eq('id', row.id)
          .eq('organization_id', organizationId)
          .eq('uploaded_by', user.id)
          .eq('provider_capture_id', capture.id)
        if (row.status === 'attaching') claimQuery = claimQuery.eq('status', 'attaching').lt('updated_at', staleBefore)
        else claimQuery = claimQuery.in('status', ['staged', 'failed'])
        const { data: claimed, error: claimError } = await claimQuery.select('*').maybeSingle()
        if (claimError) throw claimError

        if (!claimed) {
          const { data: current, error: currentError } = await admin
            .from('provider_sale_capture_photos')
            .select('status,attached_sale_id,attached_sale_photo_id')
            .eq('id', row.id)
            .eq('organization_id', organizationId)
            .eq('uploaded_by', user.id)
            .eq('provider_capture_id', capture.id)
            .maybeSingle()
          if (currentError) throw currentError
          if (current?.status === 'attached' && current.attached_sale_id === saleId && current.attached_sale_photo_id) {
            salePhotoIds.push(current.attached_sale_photo_id)
            continue
          }
          failures.push(\`${'${row.id}'}:photo_attachment_in_progress\`)
          continue
        }

        const targetPath = \`${'${organizationId}'}/${'${saleId}'}/${'${salePhotoId}'}.${'${ext(claimed.mime_type)}'}\`
        try {
          const { data: file, error: downloadError } = await admin.storage.from(STAGING_BUCKET).download(claimed.storage_path)
          if (downloadError || !file) throw downloadError || new Error('staged_photo_download_failed')
          const { error: uploadError } = await admin.storage.from(SALE_BUCKET).upload(targetPath, file, {
            contentType: claimed.mime_type,
            upsert: true,
            cacheControl: '0'
          })
          if (uploadError) throw uploadError

          const { error: photoInsertError } = await admin.from('sale_order_photos').upsert({
            id: salePhotoId,
            sale_id: saleId,
            organization_id: organizationId,
            uploaded_by: user.id,
            uploaded_by_email: email,
            storage_path: targetPath,
            mime_type: claimed.mime_type,
            file_size_bytes: claimed.file_size_bytes,
            extraction_status: 'uploaded',
            extracted_fields: {}
          }, { onConflict: 'id' })
          if (photoInsertError) throw photoInsertError

          const now = new Date().toISOString()
          const { data: attached, error: attachedError } = await admin.from('provider_sale_capture_photos').update({
            status: 'attached',
            attached_sale_id: saleId,
            attached_sale_photo_id: salePhotoId,
            attached_at: now,
            updated_at: now,
            attachment_error: null
          })
            .eq('id', row.id)
            .eq('organization_id', organizationId)
            .eq('uploaded_by', user.id)
            .eq('provider_capture_id', capture.id)
            .eq('status', 'attaching')
            .eq('attached_sale_id', saleId)
            .eq('attached_sale_photo_id', salePhotoId)
            .select('id')
            .maybeSingle()
          if (attachedError) throw attachedError
          if (!attached) throw new Error('photo_attachment_claim_lost')

          const { error: removeError } = await admin.storage.from(STAGING_BUCKET).remove([claimed.storage_path])
          if (removeError) console.error('provider-sale-photo-stage staged object cleanup', removeError)
          salePhotoIds.push(salePhotoId)
        } catch (attachError) {
          const detail = text((attachError as Error)?.message || attachError).slice(0, 300)
          failures.push(\`${'${row.id}'}:${'${detail}'}\`)
          await admin.from('provider_sale_capture_photos').update({
            status: 'failed',
            attached_sale_id: saleId,
            attached_sale_photo_id: salePhotoId,
            attachment_error: detail,
            updated_at: new Date().toISOString()
          })
            .eq('id', row.id)
            .eq('organization_id', organizationId)
            .eq('uploaded_by', user.id)
            .eq('provider_capture_id', capture.id)
            .eq('status', 'attaching')
            .eq('attached_sale_id', saleId)
            .eq('attached_sale_photo_id', salePhotoId)
        }`
  if(!source.includes('photo_attachment_in_progress'))source=replaceRequired(source,oldBlock,newBlock,'provider-sale-photo-stage atomic attachment claim')
  return source
})

for(const [slug,entitlement] of edgePaywallTargets){
  const file=path.join(functionsRoot,slug,'index.ts')
  let source=await readFile(file,'utf8')
  const original=source

  if(!source.includes(importLine))source=`${importLine}\n${source}`

  const desiredCall=`serveWithOrganizationAccess('${entitlement}',`
  const guardedPattern=/serveWithOrganizationAccess\(\s*['"][a-z0-9_]+['"]\s*,/g
  const guardedMatches=[...source.matchAll(guardedPattern)]
  const denoMatches=[...source.matchAll(/Deno\.serve\s*\(/g)]

  if(guardedMatches.length>1)throw new Error(`${slug}: expected at most one organization wrapper, found ${guardedMatches.length}`)

  if(guardedMatches.length===1){
    source=source.replace(guardedPattern,desiredCall)
  }else{
    if(denoMatches.length!==1)throw new Error(`${slug}: expected exactly one Deno.serve call before wrapping, found ${denoMatches.length}`)
    source=source.replace(/Deno\.serve\s*\(/,desiredCall)
  }

  const remaining=[...source.matchAll(/Deno\.serve\s*\(/g)].length
  const finalWrappers=[...source.matchAll(guardedPattern)]
  if(remaining!==0)throw new Error(`${slug}: unguarded Deno.serve call remains`)
  if(finalWrappers.length!==1)throw new Error(`${slug}: expected one organization wrapper, found ${finalWrappers.length}`)
  if(!source.includes(desiredCall))throw new Error(`${slug}: ${entitlement} guard was not installed`)

  if(source!==original){
    drift.push(`${slug}:${entitlement}`)
    if(writeMode){
      await writeFile(file,source)
      changed.push(`${slug}:${entitlement}`)
    }
  }else{
    unchanged.push(`${slug}:${entitlement}`)
  }
}

const uncategorized=functionDirectories.filter(slug=>!edgePaywallTargets.has(slug)&&!edgePaywallExemptions.has(slug))
if(uncategorized.length)throw new Error(`uncategorized Edge Functions: ${uncategorized.join(', ')}`)

const report={
  mode:writeMode?'write':'check',
  changed,
  unchanged,
  drift,
  protected_count:edgePaywallTargets.size,
  exempt_count:edgePaywallExemptions.size,
  total_function_count:functionDirectories.length
}
console.log(JSON.stringify(report,null,2))

if(!writeMode&&drift.length){
  console.error('Run node scripts/apply-edge-paywall-guards.mjs --write and commit the generated source changes.')
  process.exitCode=1
}
