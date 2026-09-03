import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8')
const script=read('./scripts/test-live-feed-local.sh')
const config=read('./tests/live-feed-local/supabase/config.toml')
const contract=read('./tests/live-feed-local/supabase/migrations/00000000000000_mccoy_live_feed_contract.sql')
const workflow=read('./.github/workflows/live-feed-local-supabase.yml')
const docs=read('./docs/live-feed-free-test-plan.md')
const previewDocs=read('./docs/live-feed-comments-preview.md')
const packageJson=JSON.parse(read('./package.json'))

test('local harness copies only the synthetic contract, preview migration, and rollback canary',()=>{
  assert.match(script,/\.tmp\/live-feed-local/)
  assert.match(script,/00000000000000_mccoy_live_feed_contract\.sql/)
  assert.match(script,/20260903062000_live_feed_company_team_comments_preview\.sql/)
  assert.match(script,/live-feed-comments-preview-canary\.sql/)
  assert.match(script,/docker exec -i/)
  assert.match(script,/--set ON_ERROR_STOP=on/)
  assert.match(script,/rollback canary left/)
})

test('local harness cannot link, push, reset, or address a hosted project',()=>{
  assert.doesNotMatch(script,/supabase\s+link|db\s+push|db\s+reset\s+--linked|--project-ref|athxxrfqxwlfnuvbqadp/i)
  assert.match(script,/no hosted Supabase project was linked or changed/)
  assert.match(script,/supabase@\$\{CLI_VERSION\}/)
  assert.match(script,/host_binding_ipv4=127\.0\.0\.1/)
  assert.match(script,/--network-id/)
  assert.match(script,/PUBLISHED_HOST_IPS/)
  assert.match(script,/unsafe local port binding detected/)
})

test('local Supabase stack matches the production Postgres major and keeps Realtime enabled',()=>{
  assert.match(config,/project_id = "mccoy-live-feed-local"/)
  assert.match(config,/major_version = 17/)
  assert.match(config,/\[realtime\][\s\S]*enabled = true/)
  assert.match(config,/\[storage\][\s\S]*enabled = false/)
  assert.match(config,/\[analytics\][\s\S]*enabled = false/)
})

test('synthetic schema exposes only the production contracts required by the canary',()=>{
  for(const table of ['organizations','organization_memberships','app_user_access','users','teams','sales_records','sales_feed']){
    assert.match(contract,new RegExp(`create table public\\.${table} \\(`))
  }
  assert.match(contract,/private\.current_organization_id/)
  assert.match(contract,/private\.organization_access_allowed/)
  assert.match(contract,/create publication supabase_realtime/)
  assert.match(contract,/contains no production data/i)
})

test('CI runs the same no-cost Docker path and no remote deployment command',()=>{
  assert.match(workflow,/Live Feed local Supabase Docker validation/)
  assert.match(workflow,/ubuntu-24\.04/)
  assert.match(workflow,/SUPABASE_CLI_VERSION: 2\.116\.0/)
  assert.match(workflow,/bash scripts\/test-live-feed-local\.sh/)
  assert.doesNotMatch(workflow,/supabase\s+link|db\s+push|create_branch|project-ref/i)
})

test('documented promotion order is local, optional free staging, one-team pilot, mobile, then wider rollout',()=>{
  const requiredOrder=[
    'Local Supabase Docker validation',
    'Optional free Supabase staging project',
    'Controlled one-team production feature flag',
    'Physical mobile testing',
    'Wider rollout only after isolation passes'
  ]
  let previous=-1
  for(const label of requiredOrder){
    const index=docs.indexOf(label)
    assert.ok(index>previous,`${label} is missing or out of order`)
    previous=index
  }
  assert.match(docs,/default-off/i)
  assert.match(docs,/server-enforced/i)
  assert.match(docs,/never use real customer data/i)
  assert.match(previewDocs,/Local Supabase Docker validation/)
  assert.doesNotMatch(previewDocs,/Pending paid-preview validation/)
})

test('package scripts expose source-contract and Docker validation commands',()=>{
  assert.equal(packageJson.scripts['test:live-feed:local:contract'],'node --test live-feed-local-harness.test.mjs')
  assert.equal(packageJson.scripts['test:live-feed:local'],'bash scripts/test-live-feed-local.sh')
})
