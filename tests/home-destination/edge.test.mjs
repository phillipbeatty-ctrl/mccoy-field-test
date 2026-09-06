import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {stripTypeScriptTypes} from 'node:module'
import vm from 'node:vm'
import {canManageHomes,destinationRequest,verifiedDestination} from '../../supabase/functions/_shared/home-destination.mjs'
const source=stripTypeScriptTypes(readFileSync(new URL('../../supabase/functions/admin-workday/index.ts',import.meta.url),'utf8').replace(/^import .*\n/gm,''))
const actor='00000000-0000-4000-8000-000000000001',target='00000000-0000-4000-8000-000000000002'
function setup(role='manager',{saveError,geocodeStatus='OK'}={}){
 let handler,geocodes=0
 const calls=[]
 const client={auth:{getUser:async()=>({data:{user:{id:actor,email:'manager@example.test'}}})},from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{active:true,role,organization_id:'org'}})})})}),rpc:async(name,args)=>{
  calls.push({name,args})
  return name==='get_managed_sph_home_settings'?{data:{ok:true,users:[{user_id:target}]}}:{error:saveError,data:saveError?null:{ok:true,updated_count:args.p_target_user_ids.length,home_label:args.p_home_label,workday_timezone:args.p_workday_timezone}}
 }}
 const sandbox={Request,Response,console:{error(){}},canManageHomes,destinationRequest,verifiedDestination,corsHeaders:{},Deno:{env:{get:()=> 'test-only'}},createClient:()=>client,serveWithOrganizationAccess:(_entitlement,h)=>handler=h,GoogleMapsClient:class{async geocode(){geocodes++;return{data:{status:geocodeStatus,results:[{types:['lodging'],formatted_address:'100 Hotel Street, Test City, NY 10001',place_id:'test-place',geometry:{location:{lat:40,lng:-74},location_type:'ROOFTOP'},address_components:['street_number','route','administrative_area_level_1','postal_code','country'].map(type=>({types:[type],short_name:type==='country'?'US':'test'}))}]}}}}}
 vm.runInNewContext(source,sandbox)
 return{calls,geocodes:()=>geocodes,request:body=>handler(new Request('https://example.test/admin-workday',{method:'POST',headers:{Authorization:'Bearer test-token','Content-Type':'application/json'},body:JSON.stringify({action:'set_homes',target_user_ids:[target],home_address:'100 Hotel Street, Test City, NY 10001',workday_timezone:'America/New_York',...body})}))}
}
test('Admin, manager and trainer Edge requests use the validated actor and server geocode',async()=>{
 for(const role of ['admin','manager','trainer']){
  const h=setup(role),response=await h.request({p_actor_user_id:'forged',latitude:0,longitude:0})
  assert.equal(response.status,200)
  const save=h.calls.find(c=>c.name==='set_managed_sph_home_locations')
  assert.equal(save.args.p_actor_user_id,actor)
  assert.equal(save.args.p_latitude,40)
  assert.equal(h.geocodes(),1)
 }
})
test('rep and unauthorized target are rejected before geocoding or saving',async()=>{
 const rep=setup('rep');assert.equal((await rep.request({})).status,403);assert.equal(rep.calls.length,0)
 const other=setup();assert.equal((await other.request({target_user_ids:[actor]})).status,403);assert.equal(other.geocodes(),0)
 assert.equal(other.calls.some(c=>c.name==='set_managed_sph_home_locations'),false)
})
test('assignment revoked after roster read is returned as a clear failed save',async()=>{
 const h=setup('manager',{saveError:{code:'42501'}}),response=await h.request({})
 assert.equal(response.status,403)
 assert.match((await response.json()).detail,/no addresses were saved/)
})
test('failed geocoding leaves every selected user unchanged',async()=>{
 const h=setup('manager',{geocodeStatus:'ZERO_RESULTS'}),response=await h.request({})
 assert.equal(response.status,422)
 assert.equal(h.calls.some(c=>c.name==='set_managed_sph_home_locations'),false)
})
