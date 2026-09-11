import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

// The same transaction tests run locally in PostgreSQL WASM and in CI against
// separate PostgreSQL connections. Never connect this suite to a real project.
let db,close;
const real=process.env.GPS_POSTGRES_TEST==='1';
if(real){
  assert.ok(['127.0.0.1','localhost'].includes(process.env.PGHOST));
  assert.equal(process.env.PGDATABASE,'gps_placement_test');
  const {Pool}=await import('pg');const pool=new Pool({max:5});
  db={query:(...args)=>pool.query(...args),exec:sql=>pool.query(sql),transaction:async fn=>{
    const c=await pool.connect();try{await c.query('begin');const value=await fn(c);await c.query('commit');return value;}
    catch(error){await c.query('rollback');throw error;}finally{c.release();}
  }};close=()=>pool.end();
}else{
  const {PGlite}=await import('@electric-sql/pglite');db=new PGlite();close=()=>db.close();
}
const org=randomUUID(),otherOrg=randomUUID();
const actor=role=>({id:randomUUID(),auth:randomUUID(),email:role+'@gps-test.invalid',role});
const admin=actor('admin'),rep=actor('rep'),manager=actor('manager'),trainer=actor('trainer'),tester=actor('tester'),other=actor('other');
other.role='admin';
const actors=[admin,rep,manager,trainer,tester,other];
const query=(sql,params=[])=>db.query(sql,params);
const first=async(sql,params=[])=>((await query(sql,params)).rows[0]);
const address=(street='100 Test St',unit='')=>({address1:street,address2:unit,city:'Portland',state:'OR',zip:'97201'});
const gps=(accuracy=80,latitude=45.5,longitude=-122.6)=>({latitude,longitude,accuracy_meters:accuracy,captured_at:new Date().toISOString()});
const input=(a=address(),g=gps())=>({request_id:randomUUID(),address:a,gps:g,contact:{}});
const call=(who,action,value={})=>db.transaction(async tx=>{
  await tx.query('set local role service_role');
  return(await tx.query('select public.field_gps_placement($1,$2,$3,$4::jsonb) as result',[who.auth,who.email,action,JSON.stringify(value)])).rows[0].result;
});
async function lead({a=address(),owner=rep,orgId=org,lat=40,lng=-120,source='SPOTIO',deleted=false}={}){
  return(await first(`insert into public.leads(organization_id,address1,address2,city,state,zip,latitude,longitude,assigned_rep_id,assigned_manager_id,source_system,customer_name,notes,pin_location_updated_at,deleted_at)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'Keep customer','Keep notes','2000-01-01',case when $12 then now() end) returning id`,
    [orgId,a.address1,a.address2,a.city,a.state,a.zip,lat,lng,owner.id,manager.id,source,deleted])).id;
}
async function started(who,body,{leadId=null,status='active',source='typed_address',sessionOwner=who.auth,ended=false}={}){
  const session=randomUUID(),v=randomUUID(),a=body.address||address();
  await query('insert into public.test_sessions(id,tester_user_id,started_at,ended_at) values($1,$2,clock_timestamp(),case when $3 then clock_timestamp() end)',[session,sessionOwner,ended]);
  await query(`insert into public.door_visits(id,organization_id,lead_id,rep_id,session_id,selection_source,status,service_address)
    values($1,$2,$3,$4,$5,$6,$7,$8)`,[v,who===other?otherOrg:org,leadId,who.id,session,source,status,[a.address1,a.address2,a.city,a.state,a.zip].filter(Boolean).join(', ')]);
  body.visit_id=v;return body;
}
async function knock(who,body){if(!body.visit_id)await started(who,body);return call(who,'knock_door',body);}
before(async()=>{
  await db.exec(await readFile(new URL('./test-support/gps-placement-schema.sql',import.meta.url),'utf8'));
  await db.exec(await readFile(new URL('./supabase/migrations/20260911222724_field_gps_placement_pilot.sql',import.meta.url),'utf8'));
  await db.exec(await readFile(new URL('./supabase/migrations/20260911225650_knock_door_gps_placement.sql',import.meta.url),'utf8'));
  await query('insert into public.organizations values($1),($2)',[org,otherOrg]);
  await query("insert into public.app_config(key,value) values('privacy_notice_version','test-notice')");
  let n=0;
  for(const a of actors){
    const o=a===other?otherOrg:org;
    await query('insert into public.users(id,auth_user_id,email,role,organization_id) values($1,$2,$3,$4,$5)',[a.id,a.auth,a.email,a.role,o]);
    await query('insert into public.app_user_access(email,role,organization_id,assigned_manager_email) values($1,$2,$3,$4)',[a.email,a.role,o,manager.email]);
    await query("insert into public.privacy_acceptances(id,user_id,email,notice_version,precise_location_consent,work_activity_analytics_consent) values($1,$2,$3,'test-notice',true,true)",[n++,a.auth,a.email]);
  }
});
after(async()=>close());

test('default off, service-role-only RPC, and Admin self-enrollment',async()=>{
  assert.equal((await call(admin,'status')).enabled,false);
  await assert.rejects(knock(admin,input()),/gps_pilot_not_enabled/);
  await assert.rejects(call(rep,'set_pilot',{enabled:true}),/admin_required/);
  assert.equal((await first("select has_function_privilege('authenticated','public.field_gps_placement(uuid,text,text,jsonb)','execute') as allowed")).allowed,false);
  assert.equal((await first("select has_table_privilege('authenticated','private.field_gps_audit','select') as allowed")).allowed,false);
  assert.equal((await call(admin,'set_pilot',{enabled:true})).enabled,true);
  for(const a of [rep,manager,trainer,tester,other])await query("insert into private.field_gps_pilot values($1,$2,now()+interval '1 hour',$3,now())",[a===other?otherOrg:org,a.id,admin.id]);
});
test('all duplicate units move, no arbitrary door is selected, poor GPS is accepted',async()=>{
  const a=address(),id1=await lead({a:address(a.address1,'Apt 1')}),id2=await lead({a:address(a.address1,'Apt 2')});
  const r=await knock(admin,input(a,gps(350,47,-123)));
  assert.equal(r.moved_count,2);assert.equal(r.created,false);assert.equal(r.lead,null);assert.equal(r.requires_door_selection,true);assert.equal(r.low_accuracy,true);
  const pins=(await query('select latitude,longitude,customer_name,notes,address2,geocode_verified_at,geocode_verification_status from public.leads where id=any($1::uuid[]) order by address2',[[id1,id2]])).rows;
  assert.deepEqual(pins.map(p=>p.latitude),[47,47]);assert.deepEqual(pins.map(p=>p.address2),['Apt 1','Apt 2']);
  assert.ok(pins.every(p=>p.customer_name==='Keep customer'&&p.notes==='Keep notes'&&p.geocode_verified_at===null&&p.geocode_verification_status==='gps_reported_door_low_accuracy'));
  assert.equal(Number((await first('select count(*) n from private.field_gps_audit where lead_id=any($1::uuid[])',[[id1,id2]])).n),2);
});
test('same full-address duplicates are both placed and stay distinct',async()=>{
  const a=address('101 Test St','Unit 4');const ids=[await lead({a}),await lead({a})];
  const r=await knock(admin,input(a));assert.equal(r.moved_count,2);assert.equal(r.lead,null);
  assert.equal(Number((await first('select count(*) n from public.leads where id=any($1::uuid[])',[ids])).n),2);
});
test('standard street abbreviations and inline apartments join the same group without merging doors',async()=>{
  const ids=[await lead({a:address('123 Main Street Apt 1')}),await lead({a:address('123 Main St.','Unit 2')}),await lead({a:address('123 Main St #3')})];
  const r=await knock(admin,input(address('123 MAIN ST','Apt 2')));
  assert.equal(r.moved_count,3);assert.equal(r.created,false);assert.equal(r.lead.id,ids[1]);
  assert.equal(Number((await first('select count(*) n from public.leads where id=any($1::uuid[])',[ids])).n),3);
  await assert.rejects(knock(admin,input(address('123 Main St Apt 1','Unit 2'))),/complete_valid_address_required/);
  const keys=(await query("select private.field_gps_address_key(street,'Portland','OR','97201') k from (values('12-14 Main St'),('1214 Main St'),('12 1/2 Main St')) v(street)")).rows;
  assert.equal(new Set(keys.map(x=>x.k)).size,3);
});
test('city, state, ZIP, deleted and demo boundaries are retained',async()=>{
  const a=address('102 Test St');const chosen=await lead({a});const untouched=[];
  for(const patch of [{city:'Salem'},{state:'WA'},{zip:'97202'}])untouched.push(await lead({a:{...a,...patch}}));
  untouched.push(await lead({a,orgId:otherOrg}),await lead({a,source:'DEMO'}),await lead({a,deleted:true}));
  const r=await knock(admin,input(a));assert.deepEqual(r.lead_ids,[chosen]);
  assert.ok((await query('select latitude from public.leads where id=any($1::uuid[])',[untouched])).rows.every(x=>x.latitude===40));
});
test('permissions reject the whole mixed-assignment group with no partial audit',async()=>{
  const a=address('103 Test St');const ids=[await lead({a}),await lead({a,owner:tester})];
  await assert.rejects(knock(rep,input(a)),/address_group_not_authorized/);
  assert.ok((await query('select latitude from public.leads where id=any($1::uuid[])',[ids])).rows.every(x=>x.latitude===40));
  assert.equal(Number((await first('select count(*) n from private.field_gps_audit where lead_id=any($1::uuid[])',[ids])).n),0);
});
test('new address creation, assigned ownership, unit creation and replay are atomic',async()=>{
  const a=address('104 Test St','Apt 1'),body=input(a);const r=await knock(rep,body);
  assert.equal(r.created,true);assert.equal(r.moved_count,1);
  const l=await first('select * from public.leads where id=$1',[r.lead.id]);assert.equal(l.assigned_rep_id,rep.id);assert.equal(l.assigned_manager_id,manager.id);assert.equal(l.created_by_user_id,rep.auth);
  assert.equal((await knock(rep,body)).replayed,true);
  await assert.rejects(knock(rep,{...body,gps:gps(90)}),/request_payload_changed/);
  const second=await knock(rep,input(address(a.address1,'Apt 2')));assert.equal(second.created,true);assert.equal(second.moved_count,2);
});
test('a stale concurrent pin stops the entire address placement',async()=>{
  const a=address('105 Test St');const id=await lead({a});const body=input(a);
  await query("update public.leads set pin_location_updated_at=now()+interval '1 second' where id=$1",[id]);
  await assert.rejects(knock(admin,body),/stale_location/);
  assert.equal((await first('select latitude from public.leads where id=$1',[id])).latitude,40);
});
test('missing, stale and invalid GPS never creates a pin; denied consent has no writes',async()=>{
  const a=address('106 Test St');
  for(const g of [{...gps(),latitude:null},{...gps(),accuracy_meters:-1},{...gps(),latitude:91},{...gps(),captured_at:null},{...gps(),captured_at:new Date(Date.now()-60000).toISOString()}]){
    await assert.rejects(knock(admin,input(a,g)),/valid_gps_required|fresh_gps_required/);
  }
  await query("update public.app_config set value='new-notice' where key='privacy_notice_version'");
  await assert.rejects(knock(admin,input(a)),/current_location_consent_required/);
  await query("update public.app_config set value='test-notice' where key='privacy_notice_version'");
  assert.equal(Number((await first('select count(*) n from public.leads where address1=$1',[a.address1])).n),0);
});
test('forced audit failure rolls back coordinates, new lead and request record',async()=>{
  const a=address('107 Test St');
  await db.exec("create function private.fail_gps_audit() returns trigger language plpgsql as $$begin raise exception 'forced_audit_failure'; end$$; create trigger force_failure before insert on private.field_gps_audit for each row execute function private.fail_gps_audit();");
  const body=input(a);await assert.rejects(knock(admin,body),/forced_audit_failure/);
  assert.equal(Number((await first('select count(*) n from public.leads where address1=$1',[a.address1])).n),0);
  assert.equal(Number((await first('select count(*) n from private.field_gps_requests where request_id=$1',[body.request_id])).n),0);
  await db.exec('drop trigger force_failure on private.field_gps_audit;drop function private.fail_gps_audit();');
});
test('retired ADD ADDRESS GPS and disposition endpoints cannot move pins',async()=>{
  const a=address('108 Test St');const id=await lead({a});
  for(const action of ['place_address','refine_disposition'])await assert.rejects(call(admin,action,input(a)),/unsupported_action/);
  assert.equal((await first('select latitude from public.leads where id=$1',[id])).latitude,40);
});
test('ADD ADDRESS resolves all duplicates without GPS, coordinate writes or audit rows',async()=>{
  const a=address('108 Add St');const ids=[await lead({a}),await lead({a})];
  const before=(await query('select latitude,longitude,pin_location_updated_at from public.leads where id=any($1::uuid[]) order by id',[ids])).rows;
  const body={request_id:randomUUID(),address:a};const result=await call(admin,'add_address',body);
  assert.equal(result.source,'address_only');assert.equal(result.moved_count,0);assert.equal(result.lead,null);
  assert.equal(result.requires_door_selection,true);
  assert.deepEqual((await query('select latitude,longitude,pin_location_updated_at from public.leads where id=any($1::uuid[]) order by id',[ids])).rows,before);
  assert.equal(Number((await first('select count(*) n from private.field_gps_audit where lead_id=any($1::uuid[])',[ids])).n),0);
  assert.equal((await call(admin,'add_address',body)).replayed,true);
});
test('adding a new address requires no GPS and its first knock creates the location audit',async()=>{
  const a=address('108 New St'),added=await call(rep,'add_address',{request_id:randomUUID(),address:a});
  const before=await first('select latitude,longitude from public.leads where id=$1',[added.lead.id]);
  assert.equal(before.latitude,null);assert.equal(before.longitude,null);
  const body=await started(rep,input(a),{leadId:added.lead.id,source:'manual_lead'});
  const result=await call(rep,'knock_door',body);assert.equal(result.moved_count,1);assert.equal(result.created,false);
  assert.equal((await first('select visit_id from private.field_gps_audit where lead_id=$1',[added.lead.id])).visit_id,body.visit_id);
});
test('GPS requires an owned active manual visit and cannot replace the saved typed address',async()=>{
  const a=address('108 Gate St');await lead({a});
  await assert.rejects(call(admin,'knock_door',input(a)),/active_manual_knock_required/);
  for(const options of [{status:'completed'},{source:'automatic_nearest'},{source:'lead_pool_map'},{sessionOwner:rep.auth},{ended:true}]){
    const body=await started(admin,input(a),options);await assert.rejects(call(admin,'knock_door',body),/active_manual_knock_required/);
  }
  const another=await started(rep,input(a));await assert.rejects(call(admin,'knock_door',another),/active_manual_knock_required/);
  const altered=await started(admin,input(a));altered.address=address('999 Wrong St');
  await assert.rejects(call(admin,'knock_door',altered),/knock_address_changed/);
});
test('a selected duplicate stays selected while all matching units move',async()=>{
  const a=address('108 Selected St','Apt 2'),id=await lead({a}),otherId=await lead({a});
  const body=await started(admin,input(a),{leadId:id,source:'manual_lead'});body.address=address('999 Wrong St');
  const r=await call(admin,'knock_door',body);assert.equal(r.lead.id,id);assert.equal(r.moved_count,2);
  assert.ok(r.lead_ids.includes(otherId));
});
test('a later KNOCK DOOR deliberately relocates even with worse accuracy',async()=>{
  const a=address('109 Test St');const id=await lead({a});
  await knock(admin,input(a,gps(5)));
  const r=await knock(admin,input(a,gps(500,46)));
  assert.equal(r.moved_count,1);assert.equal((await first('select latitude from public.leads where id=$1',[id])).latitude,46);
});
test('concurrent duplicate request creates one lead and one audit',async()=>{
  const body=await started(admin,input(address('110 Test St')));const results=await Promise.all([call(admin,'knock_door',body),call(admin,'knock_door',body)]);
  assert.equal(results[0].lead.id,results[1].lead.id);assert.equal(results.filter(x=>x.replayed).length,1);
  assert.equal(Number((await first('select count(*) n from private.field_gps_audit where request_id=$1',[body.request_id])).n),1);
});
test('disable and expiry immediately stop new placements',async()=>{
  await call(admin,'set_pilot',{enabled:false});await assert.rejects(knock(admin,input(address('111 Test St'))),/gps_pilot_not_enabled/);
  await query("update private.field_gps_pilot set enabled_until=now()-interval '1 second' where user_id=$1",[rep.id]);
  await assert.rejects(knock(rep,input(address('112 Test St'))),/gps_pilot_not_enabled/);
});
