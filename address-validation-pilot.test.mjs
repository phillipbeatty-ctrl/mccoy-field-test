import assert from 'node:assert/strict'
import test from 'node:test'
import {
  addressValidationRequest,
  comparisonRow,
  cohortSnapshotPayload,
  countSuspiciousCoordinateStacks,
  fieldPlacementForLead,
  selectSuspiciousCohort
} from './supabase/functions/_shared/address-validation-pilot-core.mjs'

test('selects one deterministic pending Census lead from each genuinely different-address coordinate stack', () => {
  const leads = []
  for (let index = 0; index < 110; index++) {
    const latitude = 40 + index / 1000, longitude = -120 - index / 1000
    leads.push({id:`a-${index}`,address1:`${index} MAIN ST`,city:'TEST',state:'OR',zip:'97000',latitude,longitude,geocode_status:'matched',geocode_verification_status:'pending_google'})
    leads.push({id:`b-${index}`,address1:`${index + 1000} MAIN ST`,city:'TEST',state:'OR',zip:'97000',latitude,longitude,geocode_status:'matched',geocode_verification_status:'pending_google'})
  }
  const first = selectSuspiciousCohort(leads, 100)
  const second = selectSuspiciousCohort([...leads].reverse(), 100)
  assert.equal(first.length, 100)
  assert.deepEqual(first.map(row => row.id), second.map(row => row.id))
  assert.equal(new Set(first.map(row => row.suspicious_coordinate_key)).size, 100)
})

test('does not flag separate units at the same base street address as a suspicious stack', () => {
  const leads = [
    {id:'1',address1:'10 MAIN ST',address2:'APT 1',city:'TEST',state:'OR',zip:'97000',latitude:45,longitude:-122,geocode_status:'matched',geocode_verification_status:'pending_google'},
    {id:'2',address1:'10 MAIN ST',address2:'APT 2',city:'TEST',state:'OR',zip:'97000',latitude:45,longitude:-122,geocode_status:'matched',geocode_verification_status:'pending_google'}
  ]
  assert.deepEqual(selectSuspiciousCohort(leads, 100), [])
  assert.equal(countSuspiciousCoordinateStacks(leads),0)
})

test('fills a 100-stack pilot with pending Google My Maps leads without admitting applied or mismatch rows', () => {
  const leads=[]
  const addStack=(index,status,verification='pending_google')=>{
    const latitude=44+index/1000,longitude=-121-index/1000
    leads.push({id:`${index}-a`,address1:`${index} OAK ST`,city:'TEST',state:'OR',zip:'97000',latitude,longitude,geocode_status:status,geocode_verification_status:verification})
    leads.push({id:`${index}-b`,address1:`${index+500} OAK ST`,city:'TEST',state:'OR',zip:'97000',latitude,longitude,geocode_status:status,geocode_verification_status:verification})
  }
  for(let index=0;index<83;index++)addStack(index,'matched')
  for(let index=83;index<131;index++)addStack(index,'google_mymaps')
  addStack(131,'google_rooftop','google_rooftop_applied')
  addStack(132,'matched','google_address_mismatch')
  const cohort=selectSuspiciousCohort(leads,100)
  assert.equal(countSuspiciousCoordinateStacks(leads),133)
  assert.equal(cohort.length,100)
  assert.equal(cohort.filter(row=>row.pilot_cohort_tier==='census_matched_pending_google').length,83)
  assert.equal(cohort.filter(row=>row.pilot_cohort_tier==='google_mymaps_pending_google').length,17)
  assert.ok(cohort.every(row=>['pending_google','trusted_pending_google_comparison'].includes(row.geocode_verification_status)))
})

test('requires verified field GPS with reported accuracy of 35 meters or better', () => {
  const lead = {geocode_verification_status:'pending_google'}
  const rejected = fieldPlacementForLead(lead,[{gps_verified_at_arrival:true,arrival_latitude:45,arrival_longitude:-122,arrival_accuracy_meters:50}])
  const accepted = fieldPlacementForLead(lead,[{gps_verified_at_disposition:true,disposition_latitude:45.1,disposition_longitude:-122.1,disposition_accuracy_meters:12,disposition_at:'2026-08-24T12:00:00Z'}])
  assert.equal(rejected,null)
  assert.equal(accepted.source,'verified_disposition_gps')
})

test('builds structured Address Validation input and complete comparison rows without writes', () => {
  const lead={id:'lead-1',source_id:'source-1',address1:'413 SW 6th Circle',city:'Battle Ground',state:'WA',zip:'98604',latitude:45.78,longitude:-122.54,suspicious_coordinate_stack_size:2,suspicious_distinct_base_addresses:2}
  const request=addressValidationRequest(lead)
  assert.deepEqual(request.address.regionCode,'US')
  assert.deepEqual(request.address.addressLines,['413 SW 6th Circle'])
  const row=comparisonRow(lead,{result:{address:{formattedAddress:'413 SW 6th Cir, Battle Ground, WA 98604-0000, USA',postalAddress:{regionCode:'US',administrativeArea:'WA',postalCode:'98604-0000',addressLines:['413 SW 6th Cir']},addressComponents:[{componentType:'street_number',componentName:{text:'413'},confirmationLevel:'CONFIRMED'}],missingComponentTypes:[],unresolvedTokens:[]},geocode:{placeId:'place-1',location:{latitude:45.7801,longitude:-122.5401}},verdict:{addressComplete:true,possibleNextAction:'ACCEPT',validationGranularity:'PREMISE',geocodeGranularity:'PREMISE'},uspsData:{dpvConfirmation:'Y'}}})
  assert.equal(row.place_id,'place-1')
  assert.equal(row.address_complete,true)
  assert.equal(row.address_identity_match,true)
  assert.equal(row.automatic_repair_eligible,true)
  assert.equal(row.repair_decision,'apply_google_address_validation')
  assert.ok(row.old_to_google_meters>0)
})

test('quarantines movements over 100 meters even when Google returns strict ACCEPT signals',()=>{
  const lead={id:'lead-2',address1:'10 Main St',city:'Test',state:'WA',zip:'98604',latitude:45,longitude:-122}
  const response={result:{address:{formattedAddress:'10 Main St, Test, WA 98604, USA',postalAddress:{regionCode:'US',administrativeArea:'WA',postalCode:'98604',addressLines:['10 Main St']},addressComponents:[{componentType:'street_number',componentName:{text:'10'},confirmationLevel:'CONFIRMED'}],missingComponentTypes:[],unresolvedTokens:[]},geocode:{placeId:'place-2',location:{latitude:45.01,longitude:-122.01}},verdict:{addressComplete:true,possibleNextAction:'ACCEPT',validationGranularity:'PREMISE',geocodeGranularity:'PREMISE'},uspsData:{dpvConfirmation:'Y'}}}
  const row=comparisonRow(lead,response)
  assert.ok(row.old_to_google_meters>100)
  assert.equal(row.automatic_repair_eligible,false)
  assert.equal(row.repair_decision,'admin_review_large_movement')
})

test('never auto-moves field-confirmed pins and rejects changed address identity',()=>{
  const lead={id:'lead-3',address1:'10 Main St',city:'Test',state:'WA',zip:'98604',latitude:45,longitude:-122}
  const response={result:{address:{formattedAddress:'11 Main St, Test, WA 98604, USA',postalAddress:{regionCode:'US',administrativeArea:'WA',postalCode:'98604',addressLines:['11 Main St']},addressComponents:[{componentType:'street_number',componentName:{text:'11'},confirmationLevel:'CONFIRMED'}],missingComponentTypes:[],unresolvedTokens:[]},geocode:{placeId:'place-3',location:{latitude:45.0001,longitude:-122.0001}},verdict:{addressComplete:true,possibleNextAction:'ACCEPT',validationGranularity:'PREMISE',geocodeGranularity:'PREMISE'},uspsData:{dpvConfirmation:'Y'}}}
  const mismatch=comparisonRow(lead,response)
  assert.equal(mismatch.address_identity_match,false)
  assert.equal(mismatch.repair_decision,'admin_review_address_identity')
  const protectedRow=comparisonRow(lead,{result:{...response.result,address:{...response.result.address,postalAddress:{...response.result.address.postalAddress,addressLines:['10 Main St']}}}},{latitude:45,longitude:-122,source:'verified_arrival_gps'})
  assert.equal(protectedRow.repair_decision,'protected_field_confirmed')
})

test('pilot snapshot changes when any address, coordinate, or verification state changes',()=>{
  const lead={id:'lead-4',address1:'10 Main St',city:'Test',state:'WA',zip:'98604',latitude:45,longitude:-122,geocode_status:'matched',geocode_verification_status:'pending_google'}
  const first=cohortSnapshotPayload([lead])
  assert.equal(first,cohortSnapshotPayload([{...lead}]))
  assert.notEqual(first,cohortSnapshotPayload([{...lead,longitude:-122.1}]))
  assert.notEqual(first,cohortSnapshotPayload([{...lead,address1:'11 Main St'}]))
  assert.notEqual(first,cohortSnapshotPayload([{...lead,geocode_verification_status:'manual_door_verified'}]))
})

test('deployed pilot source contains no lead mutation operations', async() => {
  const source=await import('node:fs/promises').then(fs=>fs.readFile(new URL('./supabase/functions/address-validation-pilot/index.ts',import.meta.url),'utf8'))
  assert.doesNotMatch(source,/\.insert\s*\(|\.update\s*\(|\.delete\s*\(|\.upsert\s*\(|\.rpc\s*\(/)
  assert.match(source,/read_only:true/)
  assert.match(source,/run_read_only_pilot/)
})

test('repair function revalidates the exact snapshot before its only database mutation call',async()=>{
  const source=await import('node:fs/promises').then(fs=>fs.readFile(new URL('./supabase/functions/address-validation-repair/index.ts',import.meta.url),'utf8'))
  assert.match(source,/stale_pilot_snapshot/)
  assert.match(source,/apply_address_validation_pilot_repair/)
  assert.match(source,/Google failed \$\{errors\.length\} of 100 comparisons\. No lead data was changed\./)
  assert.ok(source.indexOf('validateAddress(googleKey, lead)')<source.indexOf("admin.rpc('apply_address_validation_pilot_repair'"))
  assert.doesNotMatch(source,/\.from\(['"]leads['"]\)\.update|\.from\(['"]leads['"]\)\.insert|\.from\(['"]leads['"]\)\.delete/)
})
