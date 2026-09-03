import assert from 'node:assert/strict'
import {readdir,readFile} from 'node:fs/promises'
import test from 'node:test'
import {edgePaywallExemptions,edgePaywallTargets,fieldCoachEntitlements} from './scripts/paywall-targets.mjs'

const read=path=>readFile(new URL(path,import.meta.url),'utf8')
const sharedGuard=await read('./supabase/functions/_shared/organization-paywall.ts')
const accountingMigration=await read('./supabase/migrations/20260901073000_paywall_phase2_accounting_entitlement.sql')
const workflow=await read('./.github/workflows/apply-edge-paywall-guards.yml')
const repOnboarding=await read('./supabase/functions/rep-onboarding/index.ts')
const providerPhotoStage=await read('./supabase/functions/provider-sale-photo-stage/index.ts')
const functionsRoot=new URL('./supabase/functions/',import.meta.url)
const retiredAddressValidationSlugs=[
  'address-validation-admin-review',
  'address-validation-pilot',
  'address-validation-repair'
]
const retiredRecoverySlugs=[
  'spotio-controlled-recovery',
  'spotio-dom-geocode',
  'spotio-dom-recovery',
  'spotio-recovery-decode',
  'spotio-recovery-decrypt',
  'spotio-recovery-exact',
  'spotio-recovery-load',
  'spotio-recovery-prepare',
  'spotio-recovery-stream',
  'spotio-recovery-upload'
]
const retiredVerificationSlugs=[
  'spotio-composite-check',
  'spotio-count-check',
  'spotio-live-verification',
  'spotio-unit-check'
]

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
  assert.equal(edgePaywallTargets.get('session-control'),'native_background_location')
  assert.equal(edgePaywallTargets.has('rep-onboarding'),false)
  assert.equal(edgePaywallExemptions.get('rep-onboarding'),'mixed_pre_membership_and_admin_endpoint')
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

test('mixed onboarding keeps first-access actions reachable and gates business actions internally',()=>{
  assert.match(repOnboarding,/Deno\.serve\(async\(req\)=>\{/)
  assert.doesNotMatch(repOnboarding,/serveWithOrganizationAccess\(/)
  const statusIndex=repOnboarding.indexOf("if(action==='status')")
  const requestIndex=repOnboarding.indexOf("if(action==='request_access')")
  const rosterIndex=repOnboarding.indexOf("if(action==='team_rosters')")
  const adminGateIndex=repOnboarding.indexOf("requireOrganizationAccess('admin_controls')")
  assert.ok(statusIndex>=0&&requestIndex>statusIndex)
  assert.ok(rosterIndex>requestIndex,'team roster must run only after the pre-membership actions')
  assert.ok(adminGateIndex>rosterIndex,'Admin entitlement assertion must not precede status or request_access')
  assert.match(repOnboarding,/requireOrganizationAccess\('field_coach_access'\)/)
  assert.match(repOnboarding,/requireOrganizationAccess\('admin_controls'\)/)
  assert.match(repOnboarding,/service_assert_organization_access/)
  assert.match(repOnboarding,/organization_id:callerAccess\.organization_id,email:targetEmail/)
  assert.match(repOnboarding,/organization_id:callerAccess\.organization_id,email:target,role:'rep'/)
  assert.match(repOnboarding,/organization_id:callerOrganizationId,email:targetEmail\.toLowerCase\(\)/)
})

test('provider photo capture lookup is scoped to organization and signed-in user',()=>{
  assert.match(providerPhotoStage,/\.from\('provider_sale_captures'\)[\s\S]*?\.eq\('id', id\)[\s\S]*?\.eq\('organization_id', organizationId\)[\s\S]*?\.eq\('rep_user_id', user\.id\)/)
})

test('every Edge Function is protected or has a documented narrow exemption',async()=>{
  const entries=await readdir(functionsRoot,{withFileTypes:true})
  const slugs=entries.filter(entry=>entry.isDirectory()&&entry.name!=='_shared').map(entry=>entry.name)
  const uncategorized=slugs.filter(slug=>!edgePaywallTargets.has(slug)&&!edgePaywallExemptions.has(slug))
  assert.deepEqual(uncategorized,[])
  assert.ok(edgePaywallTargets.size>=25,'Phase 2 must protect every active bearer-authenticated business function')
  assert.equal(edgePaywallTargets.size+edgePaywallExemptions.size,slugs.length)
})

test('retired address-validation endpoints preserve the deployed 410 tombstone contract',async()=>{
  for(const slug of retiredAddressValidationSlugs){
    assert.equal(edgePaywallTargets.has(slug),false)
    assert.equal(edgePaywallExemptions.get(slug),'retired_endpoint_returns_410_no_business_data')
    const source=await read(`./supabase/functions/${slug}/index.ts`)
    assert.equal(
      source,
      "Deno.serve(()=>new Response(JSON.stringify({error:'address_validation_removed'}),{status:410,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}}))"
    )
  }
})

test('retired SPOTIO recovery and verification endpoints preserve deployed 410 contracts',async()=>{
  for(const slug of retiredRecoverySlugs){
    assert.equal(edgePaywallTargets.has(slug),false)
    assert.equal(edgePaywallExemptions.get(slug),'retired_recovery_endpoint_returns_410')
    assert.equal(
      await read(`./supabase/functions/${slug}/index.ts`),
      "Deno.serve(()=>Response.json({error:'recovery_endpoint_retired'},{status:410,headers:{'Cache-Control':'no-store'}}))\n"
    )
  }
  for(const slug of retiredVerificationSlugs){
    assert.equal(edgePaywallTargets.has(slug),false)
    assert.equal(edgePaywallExemptions.get(slug),'retired_verification_endpoint_returns_410')
    assert.equal(
      await read(`./supabase/functions/${slug}/index.ts`),
      "Deno.serve(()=>Response.json({error:'verification_endpoint_retired'},{status:410,headers:{'Cache-Control':'no-store'}}))\n"
    )
  }
  assert.equal(edgePaywallExemptions.get('lead-map-all-visible'),'retired_one_time_endpoint_returns_410')
  assert.equal(
    await read('./supabase/functions/lead-map-all-visible/index.ts'),
    "Deno.serve(()=>Response.json({error:'one_time_operation_retired'},{status:410,headers:{'Cache-Control':'no-store'}}))\n"
  )
  const forceLoad=await read('./supabase/functions/spotio-direct-force-load/index.ts')
  assert.equal(edgePaywallExemptions.get('spotio-direct-force-load'),'retired_recovery_endpoint_returns_410')
  assert.match(forceLoad,/recovery_endpoint_disabled/)
  assert.match(forceLoad,/one-time attached SPOTIO recovery has completed/)
  assert.match(forceLoad,/status: 410/)
})

test('signed native background ingest remains independently authenticated',async()=>{
  assert.equal(edgePaywallTargets.has('native-location-ingest'),false)
  assert.equal(edgePaywallExemptions.get('native-location-ingest'),'signed_background_location_token')
  const source=await read('./supabase/functions/native-location-ingest/index.ts')
  assert.match(source,/x-mccoy-location-token/)
  assert.match(source,/crypto\.subtle\.digest\('SHA-256'/)
  assert.match(source,/token_sha256/)
  assert.match(source,/session\.tester_user_id!==grant\.user_id/)
  assert.match(source,/session\.organization_id!==grant\.organization_id/)
  assert.match(source,/session_not_open/)
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
