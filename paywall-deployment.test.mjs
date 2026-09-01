import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import test from 'node:test'
import {edgePaywallExemptions,edgePaywallTargets} from './scripts/paywall-targets.mjs'

const workflow=await readFile(new URL('./.github/workflows/deploy-paywall-phase2.yml',import.meta.url),'utf8')

test('production deployment requires an explicit owner action on issue 105 or DEPLOY input',()=>{
  assert.match(workflow,/github\.event\.issue\.number == 105/)
  assert.match(workflow,/github\.event\.comment\.user\.login == 'phillipbeatty-ctrl'/)
  assert.match(workflow,/github\.event\.comment\.body == 'DEPLOY_FIELD_COACH_PAYWALL_PHASE2'/)
  assert.match(workflow,/github\.event\.inputs\.confirmation == 'DEPLOY'/)
  assert.match(workflow,/environment: production/)
  assert.match(workflow,/ref: main/)
})

test('deployment source is revalidated immediately before Supabase changes',()=>{
  assert.match(workflow,/node scripts\/apply-edge-paywall-guards\.mjs/)
  assert.match(workflow,/node --test organization-access-gate\.test\.mjs paywall-phase2\.test\.mjs/)
  assert.match(workflow,/deno check --node-modules-dir=auto supabase\/functions\/_shared\/organization-paywall\.ts/)
  assert.match(workflow,/SUPABASE_ACCESS_TOKEN: \$\{\{ secrets\.SUPABASE_ACCESS_TOKEN \}\}/)
})

test('only the protected map is deployed and recovery/webhook exemptions remain outside the loop',()=>{
  assert.match(workflow,/import\('\.\/scripts\/paywall-targets\.mjs'\)/)
  assert.match(workflow,/edgePaywallTargets/)
  for(const slug of edgePaywallExemptions.keys()){
    assert.equal(edgePaywallTargets.has(slug),false,`${slug} cannot be both deployed as protected and exempt`)
    assert.doesNotMatch(workflow,new RegExp(`functions deploy ['\"]?${slug.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}`))
  }
})

test('custom-gateway native ingestion keeps gateway JWT verification disabled while enforcing the in-function guard',()=>{
  assert.equal(edgePaywallTargets.get('native-location-ingest'),'native_background_location')
  assert.match(workflow,/\[ "\$function_name" = 'native-location-ingest' \]/)
  assert.match(workflow,/--no-verify-jwt/)
})

test('deployment publishes non-secret evidence instead of credentials',()=>{
  assert.match(workflow,/field-coach-paywall-phase2-production/)
  assert.match(workflow,/functions\.json/)
  assert.match(workflow,/deployment\.json/)
  assert.doesNotMatch(workflow,/echo.*SUPABASE_ACCESS_TOKEN/i)
})
