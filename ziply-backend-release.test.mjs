import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'
import path from 'node:path'
import test from 'node:test'
import vm from 'node:vm'
import { CORE, ROOT, TARGETS, MIGRATION_VERSION, MIGRATION_NAME, addZiply, assertLiveBaseline, assertReleaseContext, constraintContract, loadPackage } from './scripts/ziply-release-package.mjs'
import { runRelease } from './scripts/deploy-ziply-backend.mjs'

const release = await loadPackage()
const contract = await constraintContract(release)
const moduleFrom = source => import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))

for (const fn of release.functions) {
  test(`${fn.slug}: only its provider core changes; every handler and other helper stays byte-identical`, () => {
    assert.deepEqual(fn.files.map(file => file.name), fn.baseline_files.map(file => file.name))
    for (const file of fn.files) {
      const old = fn.baseline_files.find(other => other.name === file.name)
      assert.equal(file.content, file.name === CORE ? addZiply(old.content) : old.content)
    }
  })

  test(`${fn.slug}: Ziply aliases work, every existing provider survives, unknown values remain rejected`, async () => {
    const before = await moduleFrom(fn.baseline_files.find(file => file.name === CORE).content)
    const after = await moduleFrom(fn.files.find(file => file.name === CORE).content)
    assert.deepEqual(after.SALE_PROVIDERS, contract.providers)
    for (const value of ['Ziply', 'Ziply Fiber', ' ZIPLY ', 'Ziply-Fiber']) {
      assert.equal(before.normalizeSaleProvider(value), null)
      assert.equal(after.normalizeSaleProvider(value), 'Ziply')
    }
    for (const value of [...before.SALE_PROVIDERS, 'BASS', 'Quantum ASAP', 'AT and T', 'Windstream', 'Vivant', 'not Ziply', '', null, undefined, {}, 'Unknown provider']) {
      assert.equal(after.normalizeSaleProvider(value), before.normalizeSaleProvider(value))
    }
    assert.deepEqual(after.SALE_OUTCOMES, before.SALE_OUTCOMES)
    for (const value of ['completed', 'abandoned', 'abandoned order', '', 'Ziply']) assert.equal(after.normalizeSaleOutcome(value), before.normalizeSaleOutcome(value))
  })
}

test('unexpected, duplicate, or already-patched provider source stops package creation', () => {
  assert.throws(() => addZiply('unknown source'))
  const source = release.functions[0].baseline_files.find(file => file.name === CORE).content
  assert.throws(() => addZiply(source + source))
  assert.throws(() => addZiply(addZiply(source)))
})

test('live version, bundle, identity, JWT and import-map drift each block release', () => {
  const fn = release.functions[0]
  const live = { ...fn, status: 'ACTIVE' }
  assert.doesNotThrow(() => assertLiveBaseline(live, fn))
  for (const changed of [{version: fn.version + 1}, {ezbr_sha256: 'changed'}, {id: 'other'}, {slug: 'other'}, {verify_jwt: false}, {import_map: true}, {status: 'REMOVED'}]) {
    assert.throws(() => assertLiveBaseline({ ...live, ...changed }, fn))
  }
})

const sha = 'a'.repeat(40)
const authorized = { GITHUB_REPOSITORY: 'phillipbeatty-ctrl/mccoy-field-test', GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main', GITHUB_ACTOR: 'phillipbeatty-ctrl', GITHUB_TRIGGERING_ACTOR: 'phillipbeatty-ctrl', EXPECTED_RELEASE_SHA: sha, GITHUB_SHA: sha, ZIPLY_OPERATION: 'deploy', ZIPLY_CONFIRMATION: 'DEPLOY_ZIPLY' }
test('production action requires the owner, reviewed main commit, and exact Ziply confirmation', () => {
  assert.doesNotThrow(() => assertReleaseContext(authorized, sha))
  for (const changed of [{GITHUB_REPOSITORY: 'other/repo'}, {GITHUB_EVENT_NAME: 'pull_request'}, {GITHUB_REF: 'refs/heads/preview'}, {GITHUB_ACTOR: 'other'}, {GITHUB_TRIGGERING_ACTOR: 'other'}, {EXPECTED_RELEASE_SHA: 'b'.repeat(40)}, {ZIPLY_CONFIRMATION: 'DEPLOY'}, {ZIPLY_OPERATION: 'paywall'}]) {
    assert.throws(() => assertReleaseContext({ ...authorized, ...changed }, sha))
  }
})

function adapterFixture() {
  const calls = []
  const metadata = new Map(release.functions.map(fn => [fn.slug, { ...fn, status: 'ACTIVE' }]))
  let state = { definition: contract.before, migration: null }
  const adapter = {
    metadata: async slug => { calls.push(`inspect:${slug}`); return metadata.get(slug) },
    databaseState: async () => { calls.push('database:read'); return state },
    applyMigration: async query => { calls.push('database:write'); assert.match(query, /insert into supabase_migrations.schema_migrations/); state = { definition: contract.after, migration: { version: MIGRATION_VERSION, name: MIGRATION_NAME, statements: [release.migration] } } },
    deploy: async fn => { calls.push(`deploy:${fn.slug}`); metadata.set(fn.slug, {...metadata.get(fn.slug), version: fn.version + 1}) },
    verifySource: async fn => { calls.push(`verify:${fn.slug}`) },
  }
  return { adapter, calls, metadata, setState: value => { state = value } }
}

test('read-only preflight performs no migration, deployment or source download', async () => {
  const fixture = adapterFixture()
  const result = await runRelease({ release, operation: 'preflight', adapter: fixture.adapter })
  assert.equal(result.status, 'preflight_passed')
  assert.deepEqual(fixture.calls, [...TARGETS.map(slug => `inspect:${slug}`), 'database:read'])
})

test('a mismatch in the LAST function prevents ALL production writes', async () => {
  const fixture = adapterFixture()
  fixture.metadata.get(TARGETS.at(-1)).version++
  await assert.rejects(runRelease({ release, operation: 'deploy', adapter: fixture.adapter }))
  assert.equal(fixture.calls.some(call => /write|deploy/.test(call)), false)
})

test('changed provider contract or previously applied migration prevents all writes', async () => {
  for (const state of [{definition: 'changed', migration: null}, {definition: contract.before, migration: {version: MIGRATION_VERSION}}]) {
    const fixture = adapterFixture(); fixture.setState(state)
    await assert.rejects(runRelease({ release, operation: 'deploy', adapter: fixture.adapter }))
    assert.equal(fixture.calls.some(call => /write|deploy/.test(call)), false)
  }
})

test('database verifies before the three fixed deployments; each deployed source verifies before proceeding', async () => {
  const fixture = adapterFixture()
  const result = await runRelease({ release, operation: 'deploy', adapter: fixture.adapter })
  assert.equal(result.status, 'backend_verified_ui_pending')
  assert.deepEqual(fixture.calls.filter(call => /write|deploy|verify/.test(call)), ['database:write', ...TARGETS.flatMap(slug => [`deploy:${slug}`, `verify:${slug}`])])
  assert.deepEqual(result.completed_functions.map(fn => fn.slug), TARGETS)
})

test('migration failure or source mismatch stops remaining deployments and records partial evidence', async () => {
  for (const point of ['applyMigration', 'verifySource']) {
    const fixture = adapterFixture(), records = []
    fixture.adapter[point] = async () => { throw new Error('simulated failure') }
    await assert.rejects(runRelease({release, operation: 'deploy', adapter: fixture.adapter, record: async evidence => records.push(structuredClone(evidence))}))
    assert.equal(records.at(-1).status, 'stopped_review_required')
    assert.equal(fixture.calls.some(call => call === 'deploy:sale-submit'), false)
  }
})

const USER = '11111111-1111-4111-8111-111111111111', ORG = '22222222-2222-4222-8222-222222222222'
const CAPTURE = '33333333-3333-4333-8333-333333333333', REQUEST = '44444444-4444-4444-8444-444444444444'

function memoryDatabase() {
  const tables = {
    app_user_access: [{email: 'rep@example.test', role: 'rep', active: true, display_name: 'Test Rep', sales_classification: 'experienced', organization_id: ORG}],
    users: [{id: 'profile', auth_user_id: USER, organization_id: ORG, active: true}],
    provider_sale_captures: [], sales_records: [],
  }
  const db = {
    tables,
    auth: {getUser: async token => token === 'test-token' ? {data:{user:{id:USER,email:'rep@example.test'}},error:null} : {data:{user:null},error:{message:'invalid token'}}},
    rpc: async () => ({data:null,error:null}),
    from(table) {
      assert.ok(tables[table], `Unexpected table ${table}`)
      const filters = []; let operation = 'select', payload
      const execute = single => {
        let rows = tables[table].filter(row => filters.every(filter => filter(row)))
        if (operation === 'insert') {
          const row = {id:table === 'provider_sale_captures' ? CAPTURE : 'sale',created_at:'2026-09-11T00:00:00Z',...payload}
          tables[table].push(row); rows = [row]
        }
        if (operation === 'update') rows.forEach(row => Object.assign(row,payload))
        return {data:single ? rows[0] || null : rows,error:null}
      }
      const query = {
        select: () => query,
        eq: (column,value) => {filters.push(row => row[column] === value);return query},
        neq: (column,value) => {filters.push(row => row[column] !== value);return query},
        in: (column,values) => {filters.push(row => values.includes(row[column]));return query},
        is: (column,value) => {filters.push(row => row[column] === value);return query},
        insert: row => {operation='insert';payload=row;return query},
        update: row => {operation='update';payload=row;return query},
        maybeSingle: async () => execute(true), single: async () => execute(true),
        then: (resolve,reject) => Promise.resolve(execute(false)).then(resolve,reject),
      }
      return query
    },
  }
  return db
}

async function handler(slug, db) {
  const fn = release.functions.find(fn => fn.slug === slug)
  const core = await moduleFrom(fn.files.find(file => file.name === CORE).content)
  const extras = {}
  for (const name of ['_shared/compensation-calculator.mjs','_shared/sale-location-core.mjs']) {
    const file = fn.files.find(file => file.name === name)
    if (file) Object.assign(extras, await moduleFrom(file.content))
  }
  const source = fn.files.find(file => file.name === fn.entrypoint).content.replace(/^import\s[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '')
  let result
  vm.runInNewContext(stripTypeScriptTypes(source), {...core,...extras,Response,Request,console,createClient:()=>db,corsHeaders:{},Deno:{env:{get:()=> 'local-test'},serve:fn=>{result=fn}}})
  return result
}
const request = (body, token = 'test-token') => new Request('https://example.test/function', {method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)})

for (const slug of TARGETS) {
  test(`${slug}: actual packaged handler rejects missing/invalid login and inactive access`, async () => {
    const db=memoryDatabase(), run=await handler(slug,db)
    assert.equal((await run(request({},''))).status,401)
    assert.equal((await run(request({},'invalid'))).status,401)
    db.tables.app_user_access[0].active=false
    assert.equal((await run(request({}))).status,403)
    assert.equal(db.tables.sales_records.length,0)
  })
}

test('actual packaged handlers start and complete Ziply once; duplicate completion stays idempotent', async () => {
  const db=memoryDatabase(), capture=await handler('provider-sale-capture',db), submit=await handler('sale-submit',db)
  const started=await capture(request({action:'start',client_request_id:REQUEST,provider:'Ziply Fiber',sale_context:'out_of_area_phone',portal_opened:true}))
  assert.equal(started.status,200)
  assert.equal(db.tables.provider_sale_captures[0].provider,'Ziply')
  const body={sale_outcome:'completed',provider_capture_id:CAPTURE}
  assert.equal((await submit(request(body))).status,200)
  assert.equal(db.tables.sales_records[0].isp,'Ziply')
  assert.equal(db.tables.provider_sale_captures[0].status,'recorded')
  assert.equal((await (await submit(request(body))).json()).duplicate,true)
  assert.equal(db.tables.sales_records.length,1)
})

test('wrong owner or organization cannot complete the retained Ziply capture', async () => {
  for (const changed of [{rep_user_id:'other-rep'}, {organization_id:'other-org'}]) {
    const db=memoryDatabase()
    db.tables.provider_sale_captures.push({id:CAPTURE,provider:'Ziply',organization_id:ORG,rep_user_id:USER,status:'dashboard_opened',...changed})
    const submit=await handler('sale-submit',db)
    assert.equal((await submit(request({sale_outcome:'completed',provider_capture_id:CAPTURE}))).status,404)
    assert.equal(db.tables.sales_records.length,0)
  }
})

test('abandoned Ziply captures stay blocked and reps cannot change provider seller mappings', async () => {
  const db=memoryDatabase()
  db.tables.provider_sale_captures.push({id:CAPTURE,provider:'Ziply',organization_id:ORG,rep_user_id:USER,status:'cancelled',rep_outcome:'abandoned'})
  assert.equal((await (await handler('sale-submit',db))(request({sale_outcome:'completed',provider_capture_id:CAPTURE}))).status,409)
  assert.equal((await (await handler('provider-reconcile',db))(request({action:'link_seller',provider:'Ziply'}))).status,403)
  assert.equal(db.tables.sales_records.length,0)
})

test('workflow retains protected production environment and shares the paywall concurrency lock', async () => {
  const workflow=await readFile(path.join(ROOT,'.github/workflows/ziply-backend-release.yml'),'utf8')
  assert.match(workflow,/environment: production/)
  assert.match(workflow,/group: field-coach-paywall-phase2-production/)
  assert.match(workflow,/cancel-in-progress: false/)
  assert.match(workflow,/needs: \[package, migration\]/)
  assert.match(workflow,/github\.ref == 'refs\/heads\/main'/)
  assert.match(workflow,/github\.actor == 'phillipbeatty-ctrl'/)
  assert.match(workflow,/EXPECTED_RELEASE_SHA: \$\{\{ inputs\.expected_sha \}\}/)
  assert.doesNotMatch(workflow,/--no-verify-jwt|--prune|pull_request_target/)
})
