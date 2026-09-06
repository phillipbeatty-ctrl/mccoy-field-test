import {test,before,after,beforeEach} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {PGlite} from '@electric-sql/pglite'
const root=new URL('../../',import.meta.url)
const read=path=>readFileSync(new URL(path,root),'utf8')
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0')
const org=id(100),otherOrg=id(101)
let db
const rows=async(sql,args)=>(await db.query(sql,args)).rows
const change=async(actor,targets,zone='America/New_York',label='100 Test Street, New York, NY 10001')=>(await rows(
  'select public.set_managed_sph_home_locations($1,$2::uuid[],$3,$4,40,-74,20,$5,$6,$7) result',
  [id(actor),targets.map(id),org,label,zone,'google_geocoding','test-place']))[0].result
before(async()=>{
 db=new PGlite()
 await db.exec(read('tests/home-destination/fixture.sql'))
 const auto=read('supabase/migrations/20260904150000_automatic_daily_workday_segments.sql')
 await db.exec(auto.slice(0,auto.indexOf('create or replace function private.refresh_automatic_field_workdays')))
 await db.exec(read('supabase/migrations/20260905010000_admin_home_and_workday_timeline.sql'))
 await db.exec(read('supabase/migrations/20260906113827_manager_end_of_shift_home.sql'))
})
after(()=>db?.close())
beforeEach(async()=>{
 await db.exec('truncate private.field_workday_segments,private.field_workdays,public.test_events,public.test_sessions,public.sph_presence_events,private.sph_home_setting_audit,public.sph_home_setting_audit,public.sph_rep_settings,public.users,public.app_user_access,auth.users,public.organizations cascade')
 await db.query('insert into public.organizations values($1),($2)',[org,otherOrg])
 for(const [n,role,manager,active=true,organization=org] of [[1,'admin',null],[2,'manager',null],[3,'trainer',null],[4,'rep',2],[5,'rep',2],[6,'rep',3],[7,'rep',null],[8,'rep',2,false],[9,'rep',2,true,otherOrg]]){
  const email='user'+n+'@example.test'
  await db.query('insert into auth.users values($1,$2)',[id(n),email])
  await db.query('insert into public.app_user_access values($1,$2,$3,$4,$5,$6,$7)',[email,'User '+n,role,active,organization,manager?'user'+manager+'@example.test':null,'Test Team'])
  await db.query('insert into public.users values($1,$1,$2,$3,$4)',[id(n),email,active,organization])
 }
})
test('manager/trainer roster follows explicit assignments, never shared team names',async()=>{
 const manager=(await rows('select public.get_managed_sph_home_settings($1,$2) result',[id(2),org]))[0].result
 assert.deepEqual(manager.users.map(u=>u.user_id),[id(4),id(5)])
 const trainer=(await rows('select public.get_managed_sph_home_settings($1,$2) result',[id(3),org]))[0].result
 assert.deepEqual(trainer.users.map(u=>u.user_id),[id(6)])
 assert.equal(JSON.stringify(manager).includes('latitude'),false)
})
test('Admin, manager and trainer save only their permitted users with complete audits',async()=>{
 assert.equal((await change(2,[4,5])).updated_count,2)
 assert.equal((await change(3,[6])).updated_count,1)
 assert.equal((await change(1,[1,2,3,7])).updated_count,4)
 const audit=await rows('select count(*)::int n from private.sph_home_setting_audit')
 assert.equal(audit[0].n,7)
 assert.equal((await rows("select count(*)::int n from public.sph_home_setting_audit where action='home_location_updated'"))[0].n,7)
})
test('unauthorized target in a bulk request rolls back the whole change',async()=>{
 await assert.rejects(change(2,[4,6]),/assigned_users_only/)
 assert.equal((await rows('select count(*)::int n from public.sph_rep_settings'))[0].n,0)
 assert.equal((await rows('select count(*)::int n from private.sph_home_setting_audit'))[0].n,0)
})
test('self, unassigned, inactive, Admin and cross-organization targets are denied to managers',async()=>{
 for(const target of [1,2,6,7,8,9])await assert.rejects(change(2,[target]),/assigned_users_only/)
 await assert.rejects(change(4,[4]),/manager_or_admin_required/)
 await db.exec("update public.app_user_access set active=false where email='user2@example.test'")
 await assert.rejects(change(2,[4]),/manager_or_admin_required/)
})
test('new supervisor assignment is enforced at save time',async()=>{
 await db.exec("update public.app_user_access set assigned_manager_email='user3@example.test' where email='user4@example.test'")
 await assert.rejects(change(2,[4]),/assigned_users_only/)
 assert.equal((await change(3,[4])).updated_count,1)
})
test('direct authenticated writes, spoofed actor IDs, and the legacy user RPC stay blocked',async()=>{
 await db.exec('set role authenticated')
 try{
  await assert.rejects(change(1,[4]),/permission denied/)
  await assert.rejects(rows('select public.get_managed_sph_home_settings($1,$2)',[id(1),org]),/permission denied/)
  await assert.rejects(db.exec("select public.set_sph_home_location('test',40,-74,20)"),/permission denied/)
 }finally{await db.exec('reset role')}
})
test('repeat save preserves previous destination, timezone, and actor in the audit',async()=>{
 await change(2,[4],'America/Chicago','100 First Street, Test City, IL 60000')
 await change(2,[4],'America/New_York','200 Second Street, Test City, NY 10001')
 const audit=await rows('select * from private.sph_home_setting_audit order by id')
 assert.equal(audit[1].old_home_label,'100 First Street, Test City, IL 60000')
 assert.equal(audit[1].old_workday_timezone,'America/Chicago')
 assert.equal(audit[1].new_workday_timezone,'America/New_York')
 assert.equal(audit[1].actor_role,'manager')
 assert.equal(audit[1].changed_by,id(2))
})
test('invalid timezone and oversized addresses are rejected without audit records',async()=>{
 await assert.rejects(change(2,[4],'Mars/Test'),/valid_workday_timezone_required/)
 await assert.rejects(change(2,[4],'America/New_York','x'.repeat(201)),/valid_destination_address_required/)
 assert.equal((await rows('select count(*)::int n from private.sph_home_setting_audit'))[0].n,0)
})
test('existing workday retains timezone; next workday adopts the Blitz timezone',async()=>{
 await change(2,[4],'America/Los_Angeles')
 await db.query("insert into public.test_sessions(id,tester_user_id,organization_id,started_at,sph_workday_timezone) values($1,$2,$3,clock_timestamp(),'UTC')",[id(20),id(4),org])
 await change(2,[4],'America/New_York')
 await db.query("insert into public.test_sessions(id,tester_user_id,organization_id,started_at) values($1,$2,$3,clock_timestamp())",[id(21),id(4),org])
 await db.query("insert into public.test_sessions(id,tester_user_id,organization_id,started_at) values($1,$2,$3,clock_timestamp()+interval '1 day')",[id(22),id(4),org])
 await db.exec("update public.test_sessions set sph_workday_timezone='UTC'")
 const sessions=await rows('select sph_workday_timezone from public.test_sessions order by id')
 assert.deepEqual(sessions.map(s=>s.sph_workday_timezone),['America/Los_Angeles','America/Los_Angeles','America/New_York'])
})
test('presence events are stamped by the server with their destination revision',async()=>{
 await change(2,[4])
 await db.query("insert into public.sph_presence_events(rep_user_id,latitude,longitude,home_revision_id) values($1,40,-74,999999)",[id(4)])
 await change(2,[4],'America/Chicago')
 await db.query("insert into public.sph_presence_events(rep_user_id,latitude,longitude,home_revision_id) values($1,40,-74,999999)",[id(4)])
 const events=await rows('select home_revision_id,distance_home_m from public.sph_presence_events order by id')
 assert.notEqual(events[0].home_revision_id,events[1].home_revision_id)
 assert.notEqual(events[0].home_revision_id,999999)
 assert.equal(events[0].distance_home_m,0)
})
test('legacy Admin save now succeeds with the existing audit constraint',async()=>{
 const result=await rows('select public.admin_set_sph_home_location($1,$2,$3,$4,40,-74,20,$5,$6,$7) saved',[id(1),id(4),org,'100 Test Street, Test City, NY 10001','America/New_York','google_geocoding','test-place'])
 assert.equal(result[0].saved.ok,true)
})
test('workday derivation executes after the schema changes',async()=>{
 await change(2,[4])
 await db.query("insert into public.test_sessions(id,tester_user_id,organization_id,started_at) values($1,$2,$3,clock_timestamp()-interval '2 hours')",[id(20),id(4),org])
 await db.exec("select private.refresh_automatic_field_workdays(current_date-1,clock_timestamp())")
 assert.equal((await rows('select count(*)::int n from private.field_workdays'))[0].n,1)
})

async function simulateHomewardTravel(changeBetweenSamples){
 const base=new Date();base.setUTCHours(16,0,0,0)
 const at=minutes=>new Date(base.getTime()+minutes*60000).toISOString()
 await change(2,[4])
 await db.query('update private.sph_home_setting_audit set changed_at=$1',[at(-60)])
 await db.query('insert into public.test_sessions(id,tester_user_id,organization_id,started_at) values($1,$2,$3,$4)',[id(20),id(4),org,at(0)])
 await db.query("insert into public.sph_presence_events(rep_user_id,event_at,latitude,longitude,accuracy_meters,event_type,inside_area,distance_outside_area_m) values($1,$2,40.02,-74,10,'heartbeat',true,0)",[id(4),at(70)])
 if(changeBetweenSamples){
  await change(2,[4])
  await db.query('update private.sph_home_setting_audit set changed_at=$1 where id=(select max(id) from private.sph_home_setting_audit)',[at(72)])
 }
 await db.query("insert into public.sph_presence_events(rep_user_id,event_at,latitude,longitude,accuracy_meters,event_type,inside_area,distance_outside_area_m) values($1,$2,40.001,-74,10,'heartbeat',false,1000)",[id(4),at(75)])
 await db.query('select private.refresh_automatic_field_workdays($1::date,$2::timestamptz)',[at(0).slice(0,10),at(180)])
 return (await rows('select excluded_travel_seconds from private.field_workdays'))[0].excluded_travel_seconds
}
test('valid travel toward one destination is still excluded',async()=>{
 assert.ok(Number(await simulateHomewardTravel(false))>0)
})
test('an address change between samples cannot become a false homeward signal',async()=>{
 assert.equal(Number(await simulateHomewardTravel(true)),0)
})
