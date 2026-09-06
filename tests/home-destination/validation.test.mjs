import {test} from 'node:test'
import assert from 'node:assert/strict'
import {canManageHomes,destinationRequest,verifiedDestination} from '../../supabase/functions/_shared/home-destination.mjs'
const user='00000000-0000-4000-8000-000000000001'
const base=()=>({status:'OK',results:[{formatted_address:'100 Hotel Street, Test City, NY 10001, USA',place_id:'test-place',types:['lodging'],geometry:{location:{lat:40,lng:-74},location_type:'ROOFTOP'},address_components:['street_number','route','administrative_area_level_1','postal_code','country'].map(type=>({types:[type],short_name:type==='country'?'US':'test'}))}]})
test('active Admins, managers and trainers qualify; reps and inactive accounts do not',()=>{
 for(const role of ['admin','manager','trainer'])assert.equal(canManageHomes({active:true,role,organization_id:'org'}),true)
 for(const access of [{active:true,role:'rep',organization_id:'org'},{active:false,role:'manager',organization_id:'org'},{active:true,role:'manager'}])assert.equal(canManageHomes(access),false)
})
test('verified lodging and precise residential street addresses are accepted',()=>{
 assert.equal(verifiedDestination(base()).accuracy,20)
 const home=base();home.results[0].types=['street_address'];home.results[0].geometry.location_type='ROOFTOP'
 assert.equal(verifiedDestination(home).accuracy,20)
})
test('partial, ambiguous, approximate, missing-street and non-US results are rejected',()=>{
 for(const mutate of [
  x=>x.results.push(structuredClone(x.results[0])),
  x=>x.results[0].partial_match=true,
  x=>x.results[0].geometry.location_type='APPROXIMATE',
  x=>x.results[0].address_components=x.results[0].address_components.filter(c=>!c.types.includes('street_number')),
  x=>x.results[0].address_components.find(c=>c.types.includes('country')).short_name='CA',
  x=>x.results[0].types=['locality'],
  x=>x.results[0].geometry.location.lat=NaN
 ]){const data=base();mutate(data);assert.equal(verifiedDestination(data),null)}
})
test('batch requests deduplicate targets and require explicit valid destination timezone',()=>{
 const body={action:'set_homes',target_user_ids:[user,user],home_address:' 100  Hotel Street, Test City, NY 10001 ',workday_timezone:'America/New_York'}
 assert.deepEqual(destinationRequest(body).ids,[user])
 assert.equal(destinationRequest(body).address,'100 Hotel Street, Test City, NY 10001')
 for(const patch of [{target_user_ids:[]},{target_user_ids:['spoof']},{workday_timezone:''},{workday_timezone:'Mars/Test'}])assert.throws(()=>destinationRequest({...body,...patch}))
})
