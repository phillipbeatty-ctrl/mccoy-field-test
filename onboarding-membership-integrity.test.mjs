import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const migration=readFileSync(new URL('./supabase/migrations/20260903004737_atomic_onboarding_organization_membership_integrity.sql',import.meta.url),'utf8')
const helperPermissions=readFileSync(new URL('./supabase/migrations/20260903012549_restrict_onboarding_identity_helper_execution.sql',import.meta.url),'utf8')
const pendingFunction=readFileSync(new URL('./supabase/functions/pending-account-access/index.ts',import.meta.url),'utf8')
const pendingController=readFileSync(new URL('./pending-access.js',import.meta.url),'utf8')
const pendingPage=readFileSync(new URL('./pending-access.html',import.meta.url),'utf8')
const canary=readFileSync(new URL('./supabase/tests/onboarding-membership-integrity-canary.sql',import.meta.url),'utf8')

test('one database transaction synchronizes access, profile, and organization membership',()=>{
  assert.match(migration,/create or replace function private\.sync_app_access_identity\(/)
  assert.match(migration,/from auth\.users u\s+where u\.id=p_auth_user_id/)
  assert.match(migration,/raise exception 'auth_email_mismatch'/)
  assert.match(migration,/insert into public\.users\([\s\S]*on conflict \(auth_user_id\) do update/)
  assert.match(migration,/insert into public\.organization_memberships\([\s\S]*on conflict \(organization_id,auth_user_id\) do update/)
  assert.match(migration,/role=excluded\.role,[\s\S]*active=true,[\s\S]*is_default=true/)
})

test('all app access writes and removals keep identity records synchronized',()=>{
  assert.match(migration,/after insert or update of email,role,active,display_name,team_name,organization_id/)
  assert.match(migration,/after delete on public\.app_user_access/)
  assert.match(migration,/perform private\.sync_app_access_identity\([\s\S]*new\.organization_id/)
  assert.match(migration,/perform private\.sync_app_access_identity\([\s\S]*old\.organization_id/)
  assert.match(migration,/set email=v_auth_email,[\s\S]*active=false,[\s\S]*is_default=false/)
})

test('SECURITY DEFINER identity helpers are callable only by their owner',()=>{
  assert.match(helperPermissions,/revoke all on function private\.sync_app_access_identity\(uuid,uuid,text,text,boolean,text,text\)/)
  assert.match(helperPermissions,/revoke all on function private\.sync_app_user_access_identity_trigger\(\)/)
  assert.match(helperPermissions,/from public, anon, authenticated, service_role/)
  assert.doesNotMatch(helperPermissions,/grant execute on function private\.sync_app_access_identity/)
})

test('repair RPC is service-only and scoped to the Admin organization',()=>{
  assert.match(migration,/create or replace function public\.service_repair_user_organization_access/)
  assert.match(migration,/where a\.organization_id=p_organization_id/)
  assert.match(migration,/revoke all on function public\.service_repair_user_organization_access\(uuid,text\)[\s\S]*from public,anon,authenticated/)
  assert.match(migration,/grant execute on function public\.service_repair_user_organization_access\(uuid,text\)[\s\S]*to service_role/)
  assert.doesNotMatch(migration,/a4942113|prestonally6|918a0b34/)
})

test('pending account API keeps incomplete active users visible and repairs them',()=>{
  assert.match(pendingFunction,/const requiresMembershipRepair=accessActive&&!membershipActive/)
  assert.match(pendingFunction,/if\(emailConfirmedAt&&accessActive&&membershipActive&&!requestPending\)continue/)
  assert.match(pendingFunction,/accessState=requiresMembershipRepair\s*\?'access_incomplete'/)
  assert.match(pendingFunction,/action==='repair_organization_access'/)
  assert.match(pendingFunction,/service_repair_user_organization_access/)
  assert.match(pendingFunction,/p_organization_id:caller\.organization_id/)
  assert.match(pendingFunction,/repair\?\.access_allowed!==true/)
})

test('Admin UI exposes an explicit organization access repair action',()=>{
  assert.match(pendingController,/ACCESS INCOMPLETE — REPAIR ORGANIZATION ACCESS/)
  assert.match(pendingController,/REPAIR ORGANIZATION ACCESS/)
  assert.match(pendingController,/action:'repair_organization_access'/)
  assert.match(pendingController,/Organization membership: \$\{account\.membership_active\?'Active':'Missing or inactive'\}/)
  assert.match(pendingPage,/active users whose organization membership needs repair/)
  assert.match(pendingPage,/pending-access\.js\?v=2026090201/)
})

test('rollback-only database canary proves create and deactivate behavior without retaining test writes',()=>{
  assert.match(canary,/^begin;/)
  assert.match(canary,/delete from public\.organization_memberships/)
  assert.match(canary,/update public\.app_user_access\s+set active=active/)
  assert.match(canary,/organization_membership_repair_failed/)
  assert.match(canary,/update public\.app_user_access\s+set active=false/)
  assert.match(canary,/organization_membership_deactivation_failed/)
  assert.match(canary,/^rollback;/m)
})
