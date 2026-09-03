import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const repOnboarding=readFileSync(new URL('./supabase/functions/rep-onboarding/index.ts',import.meta.url),'utf8')
const pendingAccess=readFileSync(new URL('./supabase/functions/pending-account-access/index.ts',import.meta.url),'utf8')
const photoStage=readFileSync(new URL('./supabase/functions/provider-sale-photo-stage/index.ts',import.meta.url),'utf8')
const requestScope=readFileSync(new URL('./supabase/migrations/20260903015716_scope_rep_access_requests_to_organization.sql',import.meta.url),'utf8')

test('mixed onboarding has one authorization helper and preserves pre-membership status/request access',()=>{
  assert.equal((repOnboarding.match(/async function requireOrganizationAccess\(/g)||[]).length,1)
  assert.equal((repOnboarding.match(/async function resolveRequestOrganizationId\(/g)||[]).length,1)
  assert.doesNotMatch(repOnboarding,/serveWithOrganizationAccess\(/)
  const status=repOnboarding.indexOf("if(action==='status')")
  const request=repOnboarding.indexOf("if(action==='request_access')")
  const roster=repOnboarding.indexOf("if(action==='team_rosters')")
  const admin=repOnboarding.indexOf("requireOrganizationAccess('admin_controls')")
  assert.ok(status>=0&&request>status&&roster>request&&admin>roster)
  assert.match(repOnboarding,/requireOrganizationAccess\('field_coach_access'\)/)
  assert.match(repOnboarding,/requireOrganizationAccess\('admin_controls'\)/)
  assert.match(repOnboarding,/const authUserId=user\.id/)
  assert.match(repOnboarding,/p_auth_user_id:authUserId/)
  assert.match(repOnboarding,/const callerOrganizationId=callerAccess\.organization_id/)
})

test('access requests resolve a server-owned organization and stay scoped through approval',()=>{
  assert.match(repOnboarding,/\.eq\('slug','mccoy-platform-llc'\)\.eq\('active',true\)/)
  assert.match(repOnboarding,/\.eq\('organization_id',requestOrganizationId\)\.eq\('user_id',user\.id\)/)
  assert.match(repOnboarding,/insert\(\{organization_id:requestOrganizationId,user_id:user\.id/)
  assert.match(repOnboarding,/\.from\('rep_access_requests'\)\.select\('\*'\)\.eq\('organization_id',callerAccess\.organization_id\)\.eq\('id',requestId\)/)
  assert.match(repOnboarding,/\.eq\('organization_id',callerAccess\.organization_id\)\.eq\('id',requestId\)/)
  assert.match(requestScope,/alter column organization_id set not null/)
  assert.match(requestScope,/rep_access_requests_organization_id_fkey/)
})

test('Admin user, profile, region, and removal operations are caller-organization scoped',()=>{
  assert.match(repOnboarding,/\.from\('app_user_access'\)\.select\('\*'\)\.eq\('organization_id',callerAccess\.organization_id\)\.eq\('email',target\)/)
  assert.match(repOnboarding,/\.from\('app_user_access'\)\.update\([\s\S]*?\.eq\('organization_id',callerAccess\.organization_id\)\.eq\('email',target\)/)
  assert.match(repOnboarding,/account_belongs_to_another_organization/)
  assert.match(repOnboarding,/\.from\('teams'\)\.select\('id'\)\.eq\('organization_id',callerOrganizationId\)/)
  assert.match(repOnboarding,/\.from\('users'\)\.upsert\(\{id:account\.id,auth_user_id:account\.id,organization_id:callerOrganizationId/)
  assert.match(repOnboarding,/targetAccessError[\s\S]*\.eq\('organization_id',callerAccess\.organization_id\)\.eq\('email',target\)/)
})

test('Pending Account Access never lists another organization request',()=>{
  assert.match(pendingAccess,/\.from\('rep_access_requests'\)[\s\S]*?\.eq\('organization_id',caller\.organization_id\)[\s\S]*?\.order\('created_at'/)
})

test('photo finalization uses an organization-scoped conditional claim',()=>{
  assert.match(photoStage,/\.from\('provider_sale_captures'\)[\s\S]*?\.eq\('organization_id', organizationId\)[\s\S]*?\.eq\('rep_user_id', user\.id\)/)
  assert.match(photoStage,/\.eq\('provider_capture_id', capture\.id\)/)
  assert.match(photoStage,/claimQuery = claimQuery\.in\('status', \['staged', 'failed'\]\)/)
  assert.match(photoStage,/claimQuery = claimQuery\.eq\('status', 'attaching'\)\.lt\('updated_at', staleBefore\)/)
  assert.match(photoStage,/photo_attachment_in_progress/)
  assert.match(photoStage,/photo_attachment_claim_lost/)
  assert.match(photoStage,/\.eq\('status', 'attaching'\)[\s\S]*?\.eq\('attached_sale_id', saleId\)[\s\S]*?\.eq\('attached_sale_photo_id', salePhotoId\)/)
})
