#!/usr/bin/env node
import {readdir,readFile,writeFile} from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {edgePaywallExemptions,edgePaywallTargets} from './paywall-targets.mjs'

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const functionsRoot=path.join(root,'supabase','functions')
const importLine="import { serveWithOrganizationAccess } from '../_shared/organization-paywall.ts'"
const writeMode=process.argv.includes('--write')

// Fail with the complete protected and exempt source inventory before wrapper edits.
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

// rep-onboarding mixes two pre-membership actions with organization-authorized
// roster and Admin actions. A blanket wrapper would block the exact users who need
// status/request_access. Keep those two JWT-authenticated actions reachable, then
// assert field_coach_access or admin_controls inside the handler before business data.
await applyDeterministicTransform('rep-onboarding','mixed_pre_membership_admin',source=>{
  source=source.replace(`${importLine}\n`,'')
  source=source.replace(/serveWithOrganizationAccess\(\s*['"]admin_controls['"]\s*,/,'Deno.serve(')

  source=replaceRequired(
    source,
    ".select('email,role,active,display_name,sales_classification,team_name,assigned_manager_email,assigned_manager_name,assigned_admin_email,assigned_admin_name')",
    ".select('email,role,active,display_name,sales_classification,team_name,assigned_manager_email,assigned_manager_name,assigned_admin_email,assigned_admin_name,organization_id')",
    'rep-onboarding caller organization selection'
  )

  const callerAccessLine="    const {data:callerAccess}=await admin.from('app_user_access').select('email,role,active,display_name,sales_classification,team_name,assigned_manager_email,assigned_manager_name,assigned_admin_email,assigned_admin_name,organization_id').eq('email',email).maybeSingle()"
  const accessHelper=`${callerAccessLine}\n    async function requireOrganizationAccess(entitlement:string){\n      const {error}=await admin.rpc('service_assert_organization_access',{p_auth_user_id:user.id,p_entitlement:entitlement})\n      if(!error)return null\n      const reason=String(error.message||'').match(/organization_access_denied:([a-z0-9_]+)/i)?.[1]||'organization_access_denied'\n      return json({error:'organization_access_denied',reason,organization_access:{access_allowed:false,denial_reason:reason,entitlement_key:entitlement,purchase_model:'organization_managed_external',purchase_action_available:false}},403)\n    }`
  if(!source.includes('async function requireOrganizationAccess(entitlement:string)')){
    source=replaceRequired(source,callerAccessLine,accessHelper,'rep-onboarding mixed access helper')
  }

  const teamBefore="    if(action==='team_rosters'){\n      if(!callerAccess?.active)return json({error:'forbidden'},403)"
  const teamAfter="    if(action==='team_rosters'){\n      if(!callerAccess?.active)return json({error:'forbidden'},403)\n      const teamAccessDenied=await requireOrganizationAccess('field_coach_access')\n      if(teamAccessDenied)return teamAccessDenied"
  source=replaceRequired(source,teamBefore,teamAfter,'rep-onboarding roster access assertion')

  const adminBefore="    if(!callerAccess?.active||callerAccess.role!=='admin') return json({error:'admin_only'},403)"
  const adminAfter="    if(!callerAccess?.active||callerAccess.role!=='admin') return json({error:'admin_only'},403)\n    const adminAccessDenied=await requireOrganizationAccess('admin_controls')\n    if(adminAccessDenied)return adminAccessDenied"
  source=replaceRequired(source,adminBefore,adminAfter,'rep-onboarding Admin entitlement assertion')

  source=replaceRequired(
    source,
    "admin.from('teams').select('id').eq('name',team).maybeSingle()",
    "admin.from('teams').select('id').eq('organization_id',callerAccess.organization_id).eq('name',team).maybeSingle()",
    'rep-onboarding team organization scope'
  )
  source=replaceRequired(
    source,
    "admin.from('users').upsert({id:account.id,auth_user_id:account.id,email:targetEmail.toLowerCase()",
    "admin.from('users').upsert({id:account.id,auth_user_id:account.id,organization_id:callerAccess.organization_id,email:targetEmail.toLowerCase()",
    'rep-onboarding profile organization scope'
  )
  source=replaceRequired(
    source,
    "admin.from('app_user_access').upsert({email:targetEmail,role,active:true",
    "admin.from('app_user_access').upsert({organization_id:callerAccess.organization_id,email:targetEmail,role,active:true",
    'rep-onboarding approval organization scope'
  )
  source=replaceRequired(
    source,
    "admin.from('app_user_access').upsert({email:target,role:'rep',active:true",
    "admin.from('app_user_access').upsert({organization_id:callerAccess.organization_id,email:target,role:'rep',active:true",
    'rep-onboarding pending grant organization scope'
  )

  if(source.includes(importLine)||source.includes("serveWithOrganizationAccess('admin_controls',")){
    throw new Error('rep-onboarding: blanket organization wrapper remains')
  }
  if(!source.includes('Deno.serve(async(req)=>{'))throw new Error('rep-onboarding: Deno handler was not restored')
  return source
})

// The service-role client bypasses RLS. Bind the captureFor lookup specifically to
// the verified organization as well as the signed-in user before exposing or mutating it.
await applyDeterministicTransform('provider-sale-photo-stage','organization_capture_scope',source=>{
  const before="      const { data, error } = await admin\n        .from('provider_sale_captures')\n        .select('id,client_request_id,rep_user_id,rep_email,provider,status,service_address')\n        .eq('id', id)\n        .eq('rep_user_id', user.id)"
  const after="      const { data, error } = await admin\n        .from('provider_sale_captures')\n        .select('id,client_request_id,rep_user_id,rep_email,provider,status,service_address')\n        .eq('id', id)\n        .eq('organization_id', organizationId)\n        .eq('rep_user_id', user.id)"
  return replaceRequired(source,before,after,'provider-sale-photo-stage capture tenant scope')
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

  if(guardedMatches.length>1){
    throw new Error(`${slug}: expected at most one organization wrapper, found ${guardedMatches.length}`)
  }

  if(guardedMatches.length===1){
    source=source.replace(guardedPattern,desiredCall)
  }else{
    if(denoMatches.length!==1){
      throw new Error(`${slug}: expected exactly one Deno.serve call before wrapping, found ${denoMatches.length}`)
    }
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
