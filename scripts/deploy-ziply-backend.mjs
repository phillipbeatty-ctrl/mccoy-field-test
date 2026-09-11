import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  PROJECT, ROOT, MIGRATION_VERSION, MIGRATION_NAME, assertLiveBaseline,
  assertReleaseContext, buildPackage, constraintContract, loadPackage, migrationTransaction, sha256,
} from './ziply-release-package.mjs'

export const DATABASE_STATE_SQL = `select
  (select pg_get_constraintdef(oid) from pg_constraint where conrelid='public.sales_records'::regclass and conname='sales_records_isp_check') as definition,
  (select jsonb_build_object('version',version,'name',name,'statements',statements) from supabase_migrations.schema_migrations where version='${MIGRATION_VERSION}') as migration;`

export async function runRelease({ release, operation, adapter, record = async () => {} }) {
  assert.ok(['preflight', 'deploy'].includes(operation))
  const contract = await constraintContract(release)
  const evidence = { project_ref: PROJECT, operation, status: 'preflight', completed_functions: [] }
  try {
    // Validate the entire target set before the first production write.
    for (const fn of release.functions) assertLiveBaseline(await adapter.metadata(fn.slug), fn)
    const state = await adapter.databaseState()
    assert.equal(state.definition, contract.before, 'Database provider contract changed; stop and review')
    assert.equal(state.migration, null, 'Migration already recorded; do not replay a partial release')
    evidence.status = 'preflight_passed'
    await record(evidence)
    if (operation === 'preflight') return evidence

    await adapter.applyMigration(migrationTransaction(release.migration))
    const updated = await adapter.databaseState()
    assert.equal(updated.definition, contract.after, 'Ziply database contract did not verify')
    assert.equal(updated.migration?.version, MIGRATION_VERSION)
    assert.equal(updated.migration?.name, MIGRATION_NAME)
    assert.deepEqual(updated.migration?.statements, [release.migration])
    evidence.status = 'migration_verified'
    await record(evidence)

    for (const fn of release.functions) {
      assertLiveBaseline(await adapter.metadata(fn.slug), fn)
      await adapter.deploy(fn)
      const actual = await adapter.metadata(fn.slug)
      assert.equal(actual.id, fn.id)
      assert.equal(actual.slug, fn.slug)
      assert.equal(actual.version, fn.version + 1, `${fn.slug}: unexpected version after deployment`)
      assert.equal(actual.verify_jwt, true)
      assert.equal(actual.import_map, false)
      assert.equal(actual.status, 'ACTIVE')
      assert.match(actual.ezbr_sha256 || '', /^[a-f0-9]{64}$/)
      await adapter.verifySource(fn)
      assertLiveBaseline(await adapter.metadata(fn.slug), actual)
      evidence.completed_functions.push({ slug: fn.slug, version: actual.version, id: actual.id, verify_jwt: true, import_map: false, ezbr_sha256: actual.ezbr_sha256 })
      evidence.status = 'functions_in_progress'
      await record(evidence)
    }
    for (const fn of evidence.completed_functions) assertLiveBaseline(await adapter.metadata(fn.slug), fn)
    assert.equal((await adapter.databaseState()).definition, contract.after)
    evidence.status = 'backend_verified_ui_pending'
    await record(evidence)
    return evidence
  } catch (error) {
    evidence.status = 'stopped_review_required'
    evidence.error = String(error.message).slice(0, 600)
    await record(evidence)
    throw error
  }
}

async function main() {
  const checkedOutSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim()
  assertReleaseContext(process.env, checkedOutSha)
  assert.ok(process.env.SUPABASE_ACCESS_TOKEN, 'Protected production credential is missing')
  const release = await loadPackage()
  const output = path.resolve(process.env.RUNNER_TEMP || os.tmpdir(), 'ziply-backend-evidence')
  await mkdir(output, { recursive: true })
  const stage = await mkdtemp(path.join(os.tmpdir(), 'ziply-reviewed-release-'))
  const manifest = await buildPackage(stage, release)
  await writeFile(path.join(output, 'package-evidence.json'), JSON.stringify(manifest, null, 2) + '\n')

  const api = async (endpoint, body) => {
    const response = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/${endpoint}`, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(60000),
      redirect: 'error',
    })
    if (!response.ok) throw new Error(`Supabase ${endpoint}: HTTP ${response.status}; inspect the protected run before retrying`)
    return response.json()
  }
  const cli = args => execFileSync('npx', ['--yes', 'supabase@2.39.2', ...args], {
    cwd: stage, env: process.env, encoding: 'utf8', timeout: 300000, stdio: ['ignore', 'pipe', 'pipe'],
  })
  const adapter = {
    metadata: slug => api(`functions/${slug}`),
    databaseState: async () => {
      const rows = await api('database/query', { query: DATABASE_STATE_SQL, read_only: true })
      assert.ok(Array.isArray(rows) && rows.length === 1, 'Unexpected database inspection response')
      return rows[0]
    },
    applyMigration: query => api('database/query', { query, read_only: false }),
    deploy: async fn => {
      // Fixed slug, reviewed staged package, JWT enabled in its isolated config.
      cli(['functions', 'deploy', fn.slug, '--use-api', '--project-ref', PROJECT, '--workdir', path.join(stage, 'candidate', fn.slug)])
    },
    verifySource: async fn => {
      const downloaded = await mkdtemp(path.join(os.tmpdir(), `ziply-verify-${fn.slug}-`))
      cli(['functions', 'download', fn.slug, '--project-ref', PROJECT, '--workdir', downloaded])
      for (const file of fn.files) {
        const actual = await readFile(path.join(downloaded, 'supabase/functions', file.name), 'utf8')
        assert.equal(sha256(actual), sha256(file.content), `${fn.slug}/${file.name}: deployed source differs from reviewed package`)
      }
    },
  }
  const evidence = await runRelease({
    release, operation: process.env.ZIPLY_OPERATION, adapter,
    record: evidence => writeFile(path.join(output, 'deployment.json'), JSON.stringify({ ...evidence, commit: checkedOutSha, workflow_run: process.env.GITHUB_RUN_ID, recorded_at: new Date().toISOString() }, null, 2) + '\n'),
  })
  console.log(`Ziply backend: ${evidence.status}. UI publication and real seller acceptance remain separate.`)
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { await main() } catch (error) { console.error(error.message); process.exitCode = 1 }
}
