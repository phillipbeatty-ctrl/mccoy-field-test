#!/usr/bin/env node
import {readdir,readFile,writeFile} from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {edgePaywallExemptions,edgePaywallTargets} from './paywall-targets.mjs'

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const functionsRoot=path.join(root,'supabase','functions')
const importLine="import { serveWithOrganizationAccess } from '../_shared/organization-paywall.ts'"
const writeMode=process.argv.includes('--write')

const changed=[]
const unchanged=[]
const drift=[]

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

const functionDirectories=(await readdir(functionsRoot,{withFileTypes:true}))
  .filter(entry=>entry.isDirectory()&&entry.name!=='_shared')
  .map(entry=>entry.name)
  .sort()
const uncategorized=functionDirectories.filter(slug=>!edgePaywallTargets.has(slug)&&!edgePaywallExemptions.has(slug))
const missingTargets=[...edgePaywallTargets.keys()].filter(slug=>!functionDirectories.includes(slug))
const missingExemptions=[...edgePaywallExemptions.keys()].filter(slug=>!functionDirectories.includes(slug))

if(uncategorized.length)throw new Error(`uncategorized Edge Functions: ${uncategorized.join(', ')}`)
if(missingTargets.length)throw new Error(`missing protected Edge Functions: ${missingTargets.join(', ')}`)
if(missingExemptions.length)throw new Error(`missing exempt Edge Functions: ${missingExemptions.join(', ')}`)

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
  console.error('Run node scripts/apply-edge-paywall-guards.mjs --write and commit the generated guard changes.')
  process.exitCode=1
}
