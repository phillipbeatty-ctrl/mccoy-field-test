import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  databasePatchForAssessment,
  googleResultAssessment,
  isGoogleVerifiedLead
} from './supabase/functions/_shared/lead-geocode-core.mjs'

const baseLead={
  id:'lead-1',address1:'413 SW 6th Circle',city:'Battle Ground',state:'WA',zip:'98604',
  latitude:45.775,longitude:-122.55,geocode_status:'matched'
}

function result({lat=45.777,lng=-122.553,locationType='ROOFTOP',partial=false,house='413',zip='98604',route='SW 6th Cir',locality='Battle Ground',types=['street_address']}={}){
  return {
    partial_match:partial,
    types,
    formatted_address:`${house} ${route}, ${locality}, WA ${zip}, USA`,
    place_id:'google-place-1',
    geometry:{location:{lat,lng},location_type:locationType},
    address_components:[
      {short_name:house,long_name:house,types:['street_number']},
      {short_name:route,long_name:route,types:['route']},
      {short_name:locality,long_name:locality,types:['locality']},
      {short_name:'WA',long_name:'Washington',types:['administrative_area_level_1']},
      {short_name:zip,long_name:zip,types:['postal_code']},
      {short_name:'US',long_name:'United States',types:['country']}
    ]
  }
}

test('only an exact, non-partial Google rooftop address may replace an untrusted pin',()=>{
  const assessment=googleResultAssessment(baseLead,result())
  assert.equal(assessment.precise,true)
  assert.equal(assessment.addressMatch,true)
  assert.equal(assessment.decision,'google_rooftop_applied')
  const patch=databasePatchForAssessment(baseLead,assessment,'2026-08-24T00:00:00.000Z')
  assert.equal(patch.geocode_status,'google_rooftop')
  assert.equal(patch.latitude,45.777)
  assert.equal(patch.longitude,-122.553)
  assert.equal(isGoogleVerifiedLead({...patch}),true)
})

test('interpolated and approximate Google results are evidence, not verified replacements',()=>{
  for(const locationType of ['RANGE_INTERPOLATED','GEOMETRIC_CENTER','APPROXIMATE']){
    const assessment=googleResultAssessment(baseLead,result({locationType}))
    assert.equal(assessment.precise,false)
    assert.equal(assessment.decision,'google_low_precision')
    const patch=databasePatchForAssessment(baseLead,assessment)
    assert.equal('latitude' in patch,false)
    assert.equal('longitude' in patch,false)
  }
})

test('partial, wrong-house, and wrong-ZIP results never move a pin',()=>{
  for(const candidate of [result({partial:true}),result({house:'415'}),result({zip:'98605'})]){
    const assessment=googleResultAssessment(baseLead,candidate)
    assert.equal(assessment.precise,false)
    assert.equal(assessment.decision,'google_address_mismatch')
    const patch=databasePatchForAssessment(baseLead,assessment)
    assert.equal('latitude' in patch,false)
    assert.equal('longitude' in patch,false)
  }
})

test('trusted manual and Google My Maps coordinates are preserved when Google disagrees',()=>{
  for(const status of ['manual','google_mymaps']){
    const lead={...baseLead,geocode_status:status,latitude:45,longitude:-122}
    const assessment=googleResultAssessment(lead,result())
    assert.equal(assessment.decision,'google_conflict_preserved')
    const patch=databasePatchForAssessment(lead,assessment)
    assert.equal('latitude' in patch,false)
    assert.equal('longitude' in patch,false)
  }
})

test('known centroid pins are quarantined when Google cannot verify them',()=>{
  const lead={...baseLead,geocode_status:'approx_zip'}
  const patch=databasePatchForAssessment(lead,googleResultAssessment(lead,null))
  assert.equal(patch.latitude,null)
  assert.equal(patch.longitude,null)
  assert.equal(patch.geocode_status,'google_no_match')
})

test('strict Address Validation repairs are treated as verified by every map and status consumer',()=>{
  assert.equal(isGoogleVerifiedLead({geocode_status:'google_address_validation',geocode_verification_status:'google_address_validation_applied'}),true)
  const map=fs.readFileSync(new URL('./app-lead-map.js',import.meta.url),'utf8')
  const edge=fs.readFileSync(new URL('./supabase/functions/lead-geocode/index.ts',import.meta.url),'utf8')
  assert.match(map,/google_address_validation_applied/)
  assert.match(edge,/google_address_validation_applied/)
  assert.match(edge,/address_validation_admin_review/)
})

test('browser workflow uses bounded Google verification and never restores centroid fallback',()=>{
  const map=fs.readFileSync(new URL('./app-lead-map.js',import.meta.url),'utf8')
  const resume=fs.readFileSync(new URL('./app-lead-geocode-resume.js',import.meta.url),'utf8')
  const real=fs.readFileSync(new URL('./app-real-leads.js',import.meta.url),'utf8')
  assert.match(map,/VERIFY NEXT 25 WITH GOOGLE/)
  assert.match(map,/action:'verify_next',limit:25/)
  assert.doesNotMatch(map,/while\s*\(loops/)
  assert.doesNotMatch(resume,/while\s*\(Number\(status\.remaining/)
  assert.doesNotMatch(real,/resolve_missing_locations/)
  assert.doesNotMatch(real,/approx_zip/)
  assert.doesNotMatch(real,/approx_city/)
})

test('Google credential stays server-only',()=>{
  const html=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8')
  const map=fs.readFileSync(new URL('./app-lead-map.js',import.meta.url),'utf8')
  const edge=fs.readFileSync(new URL('./supabase/functions/lead-geocode/index.ts',import.meta.url),'utf8')
  assert.doesNotMatch(html,/GOOGLE_MAPS_API_KEY/)
  assert.doesNotMatch(map,/GOOGLE_MAPS_API_KEY/)
  assert.match(edge,/Deno\.env\.get\('GOOGLE_MAPS_API_KEY'\)/)
  assert.match(edge,/@googlemaps\/google-maps-services-js@3\.4\.2/)
})

test('database repair is audited, bounded, concurrency-safe, and reversible at the row level',()=>{
  const migration=fs.readFileSync(new URL('./supabase/migrations/20260824224500_google_verified_lead_geocoding.sql',import.meta.url),'utf8')
  assert.match(migration,/lead_geocode_verifications/)
  assert.match(migration,/enable row level security/)
  assert.match(migration,/revoke all on public\.lead_geocode_verifications from public, anon, authenticated/)
  assert.match(migration,/for update skip locked/)
  assert.match(migration,/least\(greatest\(coalesce\(p_limit,25\),1\),25\)/)
  assert.match(migration,/quarantined_approximate_pin/)
  assert.match(migration,/latitude=null,\s*longitude=null/)
  assert.match(migration,/unsafe_google_coordinate_application/)
  assert.match(migration,/p_decision<>'google_rooftop_applied'/)
})
