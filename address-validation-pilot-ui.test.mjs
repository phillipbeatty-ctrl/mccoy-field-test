import assert from 'node:assert/strict'
import test from 'node:test'
import {readFile} from 'node:fs/promises'

const source=await readFile(new URL('./app-address-validation-pilot.js',import.meta.url),'utf8')
const html=await readFile(new URL('./index.html',import.meta.url),'utf8')
const standaloneHtml=await readFile(new URL('./address-validation-pilot.html',import.meta.url),'utf8')
const standaloneSource=await readFile(new URL('./address-validation-pilot-standalone.js',import.meta.url),'utf8')

test('Admin pilot invokes exactly 100 read-only Address Validation comparisons',()=>{
  assert.match(source,/address-validation-pilot/)
  assert.match(source,/action:'run_read_only_pilot',limit:100/)
  assert.match(source,/No lead fields will be changed/)
  assert.match(source,/MCCOY_ACCESS\?\.access\?\.role!=='admin'/)
})

test('pilot UI exposes every requested comparison field and downloadable CSV',()=>{
  for(const key of ['original_address','standardized_address','place_id','old_latitude','old_longitude','google_latitude','google_longitude','field_confirmed_latitude','field_confirmed_longitude'])assert.match(source,new RegExp(key))
  assert.match(source,/DOWNLOAD CSV/)
  assert.match(source,/Raw JSON comparison/)
})

test('pilot UI never mutates a lead or calls a lead-writing API',()=>{
  assert.doesNotMatch(source,/lead-admin|lead-geocode|\.from\(['"]leads['"]\)|\.update\s*\(|\.insert\s*\(|\.delete\s*\(|\.upsert\s*\(|\.rpc\s*\(/)
})

test('guarded repair requires the exact pilot snapshot and a second destructive-action confirmation',()=>{
  assert.match(source,/address-validation-repair/)
  assert.match(source,/action:'apply_safest_pilot_repair',limit:100,pilot_snapshot_token:latestSnapshotToken/)
  assert.match(source,/Only strict ACCEPT results at premise\/subpremise quality/)
  assert.match(source,/Original coordinates will be audited/)
  assert.match(source,/APPLY SAFEST 100-LEAD REPAIR/)
})

test('production HTML loads the cache-busted pilot UI after the map controls',()=>{
  assert.match(html,/app-lead-map\.js[^>]*><\/script><script src="app-address-validation-pilot\.js\?v=2026082502"/)
})

test('standalone pilot page is Admin-gated and preserves the exact read-only contract',()=>{
  assert.match(standaloneHtml,/100-lead Address Validation pilot/)
  assert.match(standaloneSource,/access\.role!=='admin'/)
  assert.match(standaloneSource,/address-validation-pilot/)
  assert.match(standaloneSource,/action:'run_read_only_pilot',limit:100/)
  assert.match(standaloneSource,/address-validation-repair/)
  assert.match(standaloneSource,/pilot_snapshot_token:latestSnapshotToken/)
  assert.doesNotMatch(standaloneSource,/lead-admin|lead-geocode|\.from\(['"]leads['"]\)|\.update\s*\(|\.insert\s*\(|\.delete\s*\(|\.upsert\s*\(|\.rpc\s*\(/)
})
