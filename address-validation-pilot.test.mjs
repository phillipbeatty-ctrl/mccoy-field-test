import assert from 'node:assert/strict'
import test from 'node:test'
import {
  addressValidationRequest,
  comparisonRow,
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
  const row=comparisonRow(lead,{result:{address:{formattedAddress:'413 SW 6th Cir, Battle Ground, WA 98604-0000, USA'},geocode:{placeId:'place-1',location:{latitude:45.781,longitude:-122.541}},verdict:{addressComplete:true,possibleNextAction:'ACCEPT',validationGranularity:'PREMISE',geocodeGranularity:'PREMISE'},uspsData:{dpvConfirmation:'Y'}}})
  assert.equal(row.place_id,'place-1')
  assert.equal(row.address_complete,true)
  assert.ok(row.old_to_google_meters>0)
})

test('deployed pilot source contains no lead mutation operations', async() => {
  const source=await import('node:fs/promises').then(fs=>fs.readFile(new URL('./supabase/functions/address-validation-pilot/index.ts',import.meta.url),'utf8'))
  assert.doesNotMatch(source,/\.insert\s*\(|\.update\s*\(|\.delete\s*\(|\.upsert\s*\(|\.rpc\s*\(/)
  assert.match(source,/read_only:true/)
  assert.match(source,/run_read_only_pilot/)
})
