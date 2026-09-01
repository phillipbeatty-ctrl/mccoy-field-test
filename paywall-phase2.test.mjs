import assert from 'node:assert/strict'
import {readdir,readFile} from 'node:fs/promises'
import test from 'node:test'
import {edgePaywallExemptions,edgePaywallTargets,fieldCoachEntitlements} from './scripts/paywall-targets.mjs'

const read=path=>readFile(new URL(path,import.meta.url),'utf8')
const sharedGuard=await read('./supabase/functions/_shared/organization-paywall.ts')
const accountingMigration=await read('./supabase/migrations/20260901073000_paywall_phase2_accounting_entitlement.sql')
const workflow=await read('./.github/workflows/apply-edge-paywall-guards.yml')
const functionsRoot=new URL('./supabase/functions/',import.meta.url)

test('the Phase 2 entitlement map uses the narrowest business capability',()=>{
  assert.equal(edgePaywallTargets.get('lead-admin'),'lead_management')
  assert.equal(edgePaywallTargets.get('lead-field-actions'),'lead_management')
  assert.equal(edgePaywallTargets.get('spotio-import'),'lead_management')
  assert.equal(edgePaywallTargets.get('sale-submit'),'sales_tracking')
  assert.equal(edgePaywallTargets.get('provider-sale-capture'),'sales_tracking')
  assert.equal(edgePaywallTargets.get('provider-reconcile'),'provider_integrations')
  assert.equal(edgePaywallTargets.get('provider-sale-photo-stage'),'provider_integrations')
  assert.equal(edgePaywallTargets.get('field-analytics'),'analytics')
  assert.equal(edgePaywallTargets.get('metrics-visibility'),'analytics')
  assert.equal(edgePaywallTargets.get('accounting-records'),'accounting')
  assert.equal(edgePaywallTargets.get('accounting-sales'),'accounting')
  assert.equal(edgePaywallTargets.get('rep-onboarding'),'admin_controls')
  assert.equal(edgePaywallTargets.get('native-location-ingest'),'native_background_location')
  assert.equal(edgePaywallTargets.get('session-control'),'native_background_location')
})

test('every protected Edge Function has exactly one shared organization guard',async()=>{
  for(const [slug,entitlement] of edgePaywallTargets){
    const source=await read(`./supabase/functions/${slug}/index.ts`)
    const wrappers=[...source.matchAll(/serveWithOrganizationAccess\(\s*['"]([a-z0-9_]+)['"]\s*,/g)]
    assert.equal(wrappers.length,1,`${slug} must have exactly one organization guard`)
    assert.equal(wrappers[0][1],entitlement,`${slug} must require ${entitlement}`)
    assert.match(source,/\.\.\/_shared\/organization-paywall\.ts/)
    assert.doesNotMatch(source,/Deno\.serve\s*\(/)
  }
})

test('every Edge Function is protected or has a documented narrow exemption',async()=>{
  const entries=await readdir(functionsRoot,{withFileTypes:true})
  const slugs=entries.filter(entry=>entry.isDirectory()&&entry.name!=='_shared').map(entry=>entry.name)
  const uncategorized=slugs.filter(slug=>!edgePaywallTargets.has(slug)&&!edgePaywallExemptions.has(slug))
  assert.deepEqual(uncategorized,[])
  assert.ok(edgePaywallTargets.size>=40,'Phase 2 must cover the full business-function surface')
})

test('account recovery and signed provider callbacks are not blanket paywall gated',()=>{
  for(const slug of [
    'auth-email-confirmed',
    'auth-email-delivery-webhook',
    'auth-email-provider-webhook',
    'auth-email-resend',
    'auth-email-status'
  ]){
    assert.ok(edgePaywallExemptions.has(slug),`${slug} must remain a documented infrastructure exception`)
    assert.equal(edgePaywallTargets.has(slug),false)
  }
})

test('shared guard validates the bearer token server-side and fails closed',()=>{
  const getUser=sharedGuard.indexOf('admin.auth.getUser(jwt)')
  const assertion=sharedGuard.indexOf("admin.rpc('service_assert_organization_access'")
  assert.ok(getUser>=0)
  assert.ok(assertion>getUser,'JWT identity must be resolved before organization access is asserted')
  assert.match(sharedGuard,/return json\(\{error:'unauthorized'\},401\)/)
  assert.match(sharedGuard,/error:'organization_access_denied'/)
  assert.match(sharedGuard,/,403\)/)
  assert.match(sharedGuard,/organization_access_check_failed/)
  assert.match(sharedGuard,/,503\)/)
})

test('internal organizations receive the new accounting entitlement without upgrading customer plans',()=>{
  assert.ok(fieldCoachEntitlements.includes('accounting'))
  assert.match(accountingMigration,/entitlement_key,\s*enabled/)
  assert.match(accountingMigration,/'accounting',\s*true/)
  assert.match(accountingMigration,/billing_status='internal_unlimited'/)
  assert.match(accountingMigration,/on conflict \(organization_id,entitlement_key\)/)
  assert.doesNotMatch(accountingMigration,/trial_active|paid_active|past_due_grace/)
})

test('guard generation is repeat-safe and checked in pull requests',()=>{
  assert.match(workflow,/node scripts\/apply-edge-paywall-guards\.mjs --write/)
  assert.match(workflow,/node scripts\/apply-edge-paywall-guards\.mjs\n/)
  assert.match(workflow,/node --test organization-access-gate\.test\.mjs paywall-phase2\.test\.mjs/)
  assert.match(workflow,/actions\/checkout@v5/)
  assert.match(workflow,/actions\/setup-node@v5/)
})
