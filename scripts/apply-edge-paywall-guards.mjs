#!/usr/bin/env node
import {readFile,writeFile} from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const simpleImport="import { serveWithOrganizationAccess } from '../_shared/organization-paywall.ts'"
const actionImport="import { serveWithOrganizationAccessByAction } from '../_shared/organization-paywall.ts'"

// These endpoints all validate the caller's JWT themselves. The shared wrapper
// adds a current server-side organization and entitlement decision before any
// service-role read or write can occur.
const simpleTargets=new Map([
  ['accounting-records','accounting'],
  ['accounting-sales','accounting'],
  ['admin-session-history','analytics'],
  ['company-leaders','analytics'],
  ['compensation-settings','admin_controls'],
  ['field-analytics','analytics'],
  ['lead-admin','lead_management'],
  ['lead-field-actions','lead_management'],
  ['lead-geocode','lead_management'],
  ['lead-map-address-search','lead_management'],
  ['metrics-visibility','analytics'],
  ['pay-progress','sales_tracking'],
  ['pending-account-access','admin_controls'],
  ['provider-reconcile','provider_integrations'],
  ['provider-sale-capture','sales_tracking'],
  ['rep-coach-summary','analytics'],
  ['sale-approvals','sales_tracking'],
  ['sale-order-photo-pilot','provider_integrations'],
  ['sale-order-photo','sales_tracking'],
  ['sale-submit','sales_tracking'],
  ['session-control','native_background_location'],
  ['spotio-import','lead_management']
])

const changed=[]
const unchanged=[]

async function updateSource(slug,transform,description){
  const file=path.join(root,'supabase','functions',slug,'index.ts')
  let source=await readFile(file,'utf8')
  const original=source
  source=transform(source)
  const remaining=[...source.matchAll(/Deno\.serve\s*\(/g)].length
  if(remaining!==0)throw new Error(`${slug}: ${remaining} unguarded Deno.serve call(s) remain`)
  if(source!==original){
    await writeFile(file,source)
    changed.push(description)
  }else{
    unchanged.push(description)
  }
}

for(const [slug,entitlement] of simpleTargets){
  await updateSource(slug,source=>{
    if(!source.includes(simpleImport))source=`${simpleImport}\n${source}`
    const guardedCall=`serveWithOrganizationAccess('${entitlement}',`
    const existing=/serveWithOrganizationAccess\('[a-z0-9_]+'\s*,/
    if(existing.test(source))source=source.replace(existing,guardedCall)
    else{
      const matches=[...source.matchAll(/Deno\.serve\s*\(/g)]
      if(matches.length!==1)throw new Error(`${slug}: expected exactly one Deno.serve call, found ${matches.length}`)
      source=source.replace(/Deno\.serve\s*\(/,guardedCall)
    }
    if(!source.includes(guardedCall))throw new Error(`${slug}: ${entitlement} guard was not installed`)
    return source
  },`${slug}:${entitlement}`)
}

// Account creation, status, confirmation, and recovery must remain reachable
// before an organization membership exists. Every roster or administrative
// action is nevertheless checked against current server-side access.
await updateSource('rep-onboarding',source=>{
  if(!source.includes(actionImport))source=`${actionImport}\n${source}`
  const guardedCall="serveWithOrganizationAccessByAction({defaultEntitlement:'admin_controls',exemptActions:['status','request_access'],actionEntitlements:{team_rosters:'field_coach_access'}},"
  if(/serveWithOrganizationAccessByAction\s*\(/.test(source)){
    source=source.replace(/serveWithOrganizationAccessByAction\s*\(\{[^\n]*\},/,guardedCall)
  }else{
    const matches=[...source.matchAll(/Deno\.serve\s*\(/g)]
    if(matches.length!==1)throw new Error(`rep-onboarding: expected exactly one Deno.serve call, found ${matches.length}`)
    source=source.replace(/Deno\.serve\s*\(/,guardedCall)
  }
  if(!source.includes("exemptActions:['status','request_access']"))throw new Error('rep-onboarding: recovery exemptions missing')
  if(!source.includes("team_rosters:'field_coach_access'"))throw new Error('rep-onboarding: roster entitlement missing')
  return source
},'rep-onboarding:action-aware')

// Signed URLs are bearer credentials. Keep private order-photo links short lived
// so a suspended organization cannot keep using a copied URL for 10-15 minutes.
for(const slug of ['sale-order-photo','sale-order-photo-pilot']){
  const file=path.join(root,'supabase','functions',slug,'index.ts')
  const original=await readFile(file,'utf8')
  const source=original.replace(/createSignedUrl\(([^,]+),\s*(?:600|900)\)/g,'createSignedUrl($1,60)')
  if(!/createSignedUrl\([^,]+,60\)/.test(source))throw new Error(`${slug}: sixty-second signed URL was not installed`)
  if(/createSignedUrl\([^,]+,\s*(?:600|900)\)/.test(source))throw new Error(`${slug}: long-lived signed URL remains`)
  if(source!==original){
    await writeFile(file,source)
    changed.push(`${slug}:signed-url-60s`)
  }else{
    unchanged.push(`${slug}:signed-url-60s`)
  }
}

console.log(JSON.stringify({changed,unchanged,total:simpleTargets.size+3},null,2))
