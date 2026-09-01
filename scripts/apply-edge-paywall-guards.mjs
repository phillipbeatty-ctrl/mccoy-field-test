#!/usr/bin/env node
import {readFile,writeFile} from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const importLine="import { serveWithOrganizationAccess } from '../_shared/organization-paywall.ts'"

const targets=new Map([
  ['accounting-records','admin_controls'],
  ['accounting-sales','admin_controls'],
  ['admin-session-history','analytics'],
  ['company-leaders','rankings'],
  ['compensation-settings','admin_controls'],
  ['field-analytics','analytics'],
  ['lead-admin','lead_management'],
  ['lead-field-actions','lead_management'],
  ['lead-geocode','lead_management'],
  ['lead-map-address-search','lead_management'],
  ['metrics-visibility','admin_controls'],
  ['pay-progress','sales_tracking'],
  ['pending-account-access','admin_controls'],
  ['provider-reconcile','provider_integrations'],
  ['provider-sale-capture','provider_integrations'],
  ['rep-coach-summary','analytics'],
  ['sale-approvals','sales_tracking'],
  ['sale-order-photo-pilot','admin_controls'],
  ['sale-order-photo','sales_tracking'],
  ['sale-submit','sales_tracking'],
  ['session-control','native_background_location'],
  ['spotio-import','lead_management']
])

const changed=[]
const unchanged=[]

for(const [slug,entitlement] of targets){
  const file=path.join(root,'supabase','functions',slug,'index.ts')
  let source=await readFile(file,'utf8')
  const original=source

  if(!source.includes(importLine))source=`${importLine}\n${source}`

  const guardedCall=`serveWithOrganizationAccess('${entitlement}',`
  if(!source.includes(guardedCall)){
    const matches=[...source.matchAll(/Deno\.serve\s*\(/g)]
    if(matches.length!==1){
      throw new Error(`${slug}: expected exactly one Deno.serve call, found ${matches.length}`)
    }
    source=source.replace(/Deno\.serve\s*\(/,guardedCall)
  }

  const remaining=[...source.matchAll(/Deno\.serve\s*\(/g)].length
  if(remaining!==0)throw new Error(`${slug}: unguarded Deno.serve call remains`)
  if(!source.includes(guardedCall))throw new Error(`${slug}: entitlement guard was not installed`)

  if(source!==original){
    await writeFile(file,source)
    changed.push(`${slug}:${entitlement}`)
  }else{
    unchanged.push(`${slug}:${entitlement}`)
  }
}

console.log(JSON.stringify({changed,unchanged,total:targets.size},null,2))
