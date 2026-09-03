import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const migration=readFileSync(new URL('./supabase/migrations/20260903004737_atomic_onboarding_organization_membership_integrity.sql',import.meta.url),'utf8')
const helperPermissions=readFileSync(new URL('./supabase/migrations/20260903012549_restrict_onboarding_identity_helper_execution.sql',import.meta.url),'utf8')
const requestScope=readFileSync(new URL('./supabase/migrations/20260903015716_scope_rep_access_requests_to_organization.sql',import.meta.url),'utf8')
const pendingFunction=readFileSync(new URL('./supabase/functions/pending-account-access/index.ts',import.meta.url),'utf8')
const pendingController=readFileSync(new URL('./pending-access.js',import.meta.url),'utf8')
const pendingPage=readFileSync(new URL('./pending-access.html',import.meta.url),'utf8')
const canary=readFileSync(new URL('./supabase/tests/onboarding-membership-integrity-canary.sql',import.meta.url),'utf8')
const deploymentWorkflow=readFileSync(new URL('./.github/workflows/deploy-onboarding-integrity.yml',import.meta.url),'utf8')

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

test('access requests are durably scoped to an organization',()=>{
  assert.match(requestScope,/alter table public\.rep_access_requests\s+add column if not exists organization_id uuid/)
  assert.match(requestScope,/update public\.rep_access_requests request[\s\S]*set organization_id=coalesce/)
  assert.match(requestScope,/alter column organization_id set default private\.mccoy_organization_id\(\)/)
  assert.match(requestScope,/alter column organization_id set not null/)
  assert.match(requestScope,/rep_access_requests_organization_id_fkey/)
  assert.match(requestScope,/foreign key\(organization_id\)[\s\S]*references public\.organizations\(id\)/)
  assert.match(requestScope,/rep_access_requests_org_status_created_idx/)
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
  assert.match(pendingFunction,/\.from\('rep_access_requests'\)[\s\S]*\.eq\('organization_id',caller\.organization_id\)/)
})

test('Admin UI exposes an explicit organization access repair action',()=>{
  assert.match(pendingController,/ACCESS INCOMPLETE — REPAIR ORGANIZATION ACCESS/)
  assert.match(pendingController,/REPAIR ORGANIZATION ACCESS/)
  assert.match(pendingController,/action:'repair_organization_access'/)
  assert.match(pendingController,/Organization membership: \$\{account\.membership_active\?'Active':'Missing or inactive'\}/)
  assert.match(pendingPage,/active users whose organization membership needs repair/)
  assert.match(pendingPage,/pending-access\.js\?v=2026090201/)
})

test('rollback-only database canary proves privilege, repair, and deactivate behavior without retaining test writes',()=>{
  assert.match(canary,/^begin;/)
  assert.match(canary,/has_function_privilege\('anon','private\.sync_app_access_identity/)
  assert.match(canary,/has_function_privilege\('authenticated','private\.sync_app_access_identity/)
  assert.match(canary,/has_function_privilege\('service_role','private\.sync_app_access_identity/)
  assert.match(canary,/service_repair_rpc_privilege_contract_failed/)
  assert.match(canary,/delete from public\.organization_memberships/)
  assert.match(canary,/update public\.app_user_access\s+set active=active/)
  assert.match(canary,/organization_membership_repair_failed/)
  assert.match(canary,/update public\.app_user_access\s+set active=false/)
  assert.match(canary,/organization_membership_deactivation_failed/)
  assert.match(canary,/^rollback;/m)
})

test('production Edge deployment is explicit, owner-gated, and limited to reviewed functions',()=>{
  assert.match(deploymentWorkflow,/github\.event\.issue\.number == 116/)
  assert.match(deploymentWorkflow,/github\.event\.comment\.user\.login == 'phillipbeatty-ctrl'/)
  assert.match(deploymentWorkflow,/github\.event\.comment\.body == 'DEPLOY_ONBOARDING_INTEGRITY_PR116'/)
  assert.match(deploymentWorkflow,/github\.event_name == 'workflow_dispatch' && github\.actor == 'phillipbeatty-ctrl'/)
  assert.match(deploymentWorkflow,/environment: production/)
  assert.match(deploymentWorkflow,/ref: main/)
  assert.match(deploymentWorkflow,/for function_name in rep-onboarding pending-account-access provider-sale-photo-stage/)
  assert.match(deploymentWorkflow,/functions deploy \"\$function_name\"/)
  assert.match(deploymentWorkflow,/node scripts\/apply-edge-paywall-guards\.mjs/)
  assert.match(deploymentWorkflow,/deno check --node-modules-dir=auto supabase\/functions\/rep-onboarding\/index\.ts/)
  assert.doesNotMatch(deploymentWorkflow,/echo.*SUPABASE_ACCESS_TOKEN/i)
})
