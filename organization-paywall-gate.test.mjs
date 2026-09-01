import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const foundation=fs.readFileSync('supabase/migrations/20260901033000_organization_access_state_foundation.sql','utf8');
const enforcement=fs.readFileSync('supabase/migrations/20260901034000_organization_access_enforcement.sql','utf8');
const client=fs.readFileSync('app-organization-access-gate.js','utf8');
const index=fs.readFileSync('index.html','utf8');

const combined=`${foundation}\n${enforcement}`;

test('organization access decision is server authoritative and fail closed',()=>{
  assert.match(foundation,/create or replace function private\.organization_access_state/i);
  assert.match(foundation,/v_billing_status = 'internal_unlimited'/i);
  assert.match(foundation,/v_subscription_status = 'active'/i);
  assert.match(foundation,/v_subscription_status = 'trialing'/i);
  assert.match(foundation,/field_coach_access/i);
  assert.match(foundation,/subscription_payment_required/i);
  assert.match(foundation,/subscription_cancelled/i);
  assert.match(foundation,/subscription_suspended/i);
  assert.match(foundation,/subscription_expired/i);
  assert.match(foundation,/when not v_billing_allowed then 'subscription_inactive'/i);
});

test('public access-state RPC is authenticated-only',()=>{
  assert.match(foundation,/create or replace function public\.current_organization_access_state\(\)/i);
  assert.match(foundation,/revoke all on function public\.current_organization_access_state\(\) from public, anon/i);
  assert.match(foundation,/grant execute on function public\.current_organization_access_state\(\) to authenticated, service_role/i);
  assert.doesNotMatch(combined,/grant execute on function public\.current_organization_access_state\(\) to[^;]*anon/i);
});

test('effective access preserves manual user and membership state',()=>{
  assert.match(enforcement,/add column if not exists manual_active boolean/i);
  assert.match(enforcement,/new\.manual_active := new\.active/i);
  assert.match(enforcement,/new\.active := coalesce\(new\.manual_active,false\) and v_allowed/i);
  assert.match(enforcement,/active = manual_active and v_allowed/i);
  assert.match(enforcement,/app_user_access_effective_access/i);
  assert.match(enforcement,/organization_memberships_effective_access/i);
  assert.match(enforcement,/organization_access_enforcement_count_mismatch/i);
  assert.match(enforcement,/organization_membership_enforcement_count_mismatch/i);
});

test('organization and entitlement changes resynchronize effective access',()=>{
  assert.match(enforcement,/organizations_sync_access_gate/i);
  assert.match(enforcement,/subscriptions_sync_access_gate/i);
  assert.match(enforcement,/entitlements_sync_access_gate/i);
  assert.match(enforcement,/private\.sync_organization_access/i);
  assert.match(enforcement,/organization_access_gate_history/i);
});

test('server helper supports feature-specific enforcement',()=>{
  assert.match(enforcement,/private\.assert_user_organization_access/i);
  assert.match(enforcement,/organization_entitlement_required:/i);
  assert.match(enforcement,/grant execute on function private\.assert_user_organization_access\(uuid,text\) to service_role/i);
  assert.doesNotMatch(enforcement,/grant execute on function private\.assert_user_organization_access\(uuid,text\) to[^;]*(?:anon|authenticated)/i);
});

test('client blocks business UI until the organization check succeeds',()=>{
  assert.match(client,/stopImmediatePropagation\(\)/);
  assert.match(client,/current_organization_access_state/);
  assert.match(client,/organizationAccessVerified/);
  assert.match(client,/body\.organization-access-blocked #app/);
  assert.match(client,/Business data remains locked until the server check succeeds/);
  assert.match(client,/Organization subscriptions are managed outside the mobile app/);
  assert.doesNotMatch(client,/(?:BUY NOW|SUBSCRIBE NOW|START CHECKOUT|pricing URL|stripe checkout)/i);
});

test('organization gate loads directly after auth and before feature listeners',()=>{
  const auth=index.indexOf('<script src="app-auth.js"></script>');
  const gate=index.indexOf('<script src="app-organization-access-gate.js?v=2026090101"></script>');
  const authRedirect=index.indexOf('<script src="app-auth-production-redirect.js"></script>');
  assert.ok(auth>=0,'app-auth.js is missing');
  assert.ok(gate>auth,'organization access gate must load after the Supabase auth controller');
  assert.ok(authRedirect>gate,'organization access gate must load before later feature controllers');
});
