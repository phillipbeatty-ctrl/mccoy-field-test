#!/usr/bin/env node
import {readFile,writeFile} from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const file=path.join(root,'supabase','functions','rep-onboarding','index.ts')
const writeMode=process.argv.includes('--write')
let source=await readFile(file,'utf8')

const requireHelper=`    async function requireOrganizationAccess(entitlement:string){
      const {error}=await admin.rpc('service_assert_organization_access',{p_auth_user_id:user.id,p_entitlement:entitlement})
      if(!error)return null
      const reason=String(error.message||'').match(/organization_access_denied:([a-z0-9_]+)/i)?.[1]||'organization_access_denied'
      return json({error:'organization_access_denied',reason,organization_access:{access_allowed:false,denial_reason:reason,entitlement_key:entitlement,purchase_model:'organization_managed_external',purchase_action_available:false}},403)
    }`
const resolveHelper=`    async function resolveRequestOrganizationId(){
      if(callerAccess?.organization_id)return callerAccess.organization_id
      const {data:organization,error}=await admin.from('organizations').select('id').eq('slug','mccoy-platform-llc').eq('active',true).maybeSingle()
      if(error)throw error
      if(!organization?.id)throw new Error('request_organization_not_configured')
      return organization.id
    }`

const duplicate=`${requireHelper}
${resolveHelper}
${requireHelper}`
const normalized=`${requireHelper}
${resolveHelper}`
if(source.includes(duplicate))source=source.replace(duplicate,normalized)

const requireCount=(source.match(/async function requireOrganizationAccess\(/g)||[]).length
const resolveCount=(source.match(/async function resolveRequestOrganizationId\(/g)||[]).length
if(requireCount!==1)throw new Error(`rep-onboarding must contain exactly one requireOrganizationAccess helper; found ${requireCount}`)
if(resolveCount!==1)throw new Error(`rep-onboarding must contain exactly one resolveRequestOrganizationId helper; found ${resolveCount}`)

const original=await readFile(file,'utf8')
if(source!==original){
  if(!writeMode)throw new Error('rep-onboarding generated helpers require normalization')
  await writeFile(file,source)
  console.log('Normalized rep-onboarding generated helpers.')
}else{
  console.log('rep-onboarding generated helpers are normalized.')
}
