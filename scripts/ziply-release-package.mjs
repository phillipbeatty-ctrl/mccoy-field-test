import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const ROOT = fileURLToPath(new URL('../', import.meta.url))
export const PROJECT = 'athxxrfqxwlfnuvbqadp'
export const TARGETS = Object.freeze(['provider-sale-capture', 'sale-submit', 'provider-reconcile'])
export const BASELINE_PATH = 'supabase/releases/ziply-20260911/baseline.json'
export const MIGRATION_PATH = 'supabase/migrations/20260911121718_add_ziply_sale_provider.sql'
export const MIGRATION_VERSION = '20260911121718'
export const MIGRATION_NAME = 'add_ziply_sale_provider'
const BASELINE_HASH = 'ba86855c7236655b8c35fb35f81e0d562bd315c43155117b49ab997dc2c70c91'
const MIGRATION_HASH = '4cf583acdf9154a6a76309bf08bdeb5e60069c2213b905187ac96738917ab426'
export const CORE = '_shared/provider-sale-capture-core.mjs'
export const sha256 = value => createHash('sha256').update(value).digest('hex')

export function addZiply(source) {
  assert.equal(source.includes('Ziply'), false, 'Baseline already recognizes Ziply; review the release')
  assert.equal(source.split("'Fidium',").length, 2, 'Expected exactly one provider-list insertion')
  const anchor = /if\s*\(input\.includes\('ascend'\)\)/g
  assert.equal([...source.matchAll(anchor)].length, 1, 'Expected exactly one normalization insertion')
  return source.replace("'Fidium',", "'Fidium','Ziply',")
    .replace(anchor, "if (input === 'ziply' || input === 'ziplyfiber') return 'Ziply';\n$&")
}

export function assertSafeFiles(files) {
  assert.equal(new Set(files.map(file => file.name)).size, files.length, 'Duplicate bundle paths')
  for (const file of files) {
    assert.match(file.name, /^(?:_shared|[a-z][a-z-]+)\/[a-zA-Z0-9_.-]+$/)
    assert.equal(path.posix.normalize(file.name), file.name)
    assert.equal(typeof file.content, 'string')
  }
}

export async function loadPackage() {
  const baselineText = await readFile(path.join(ROOT, BASELINE_PATH), 'utf8')
  const migration = await readFile(path.join(ROOT, MIGRATION_PATH), 'utf8')
  assert.equal(sha256(baselineText), BASELINE_HASH, 'Frozen production source changed; review and repin')
  assert.equal(sha256(migration), MIGRATION_HASH, 'Approved migration changed; review and repin')
  const baseline = JSON.parse(baselineText)
  assert.equal(baseline.project_ref, PROJECT)
  assert.deepEqual(baseline.functions.map(fn => fn.slug), TARGETS)
  const functions = baseline.functions.map(fn => {
    assert.equal(fn.verify_jwt, true)
    assert.equal(fn.import_map, false)
    assertSafeFiles(fn.files)
    assert.ok(fn.files.some(file => file.name === fn.entrypoint))
    assert.equal(fn.files.filter(file => file.name === CORE).length, 1)
    const files = fn.files.map(file => ({ ...file, content: file.name === CORE ? addZiply(file.content) : file.content }))
    return { ...fn, files, baseline_files: fn.files }
  })
  return { baseline, functions, migration }
}

export function constraintDefinition(providers) {
  return `CHECK ((isp = ANY (ARRAY[${providers.map(provider => `'${provider.replaceAll("'", "''")}'::text`).join(', ')}])))`
}

export async function constraintContract(release) {
  const core = release.functions[0].baseline_files.find(file => file.name === CORE).content
  const module = await import('data:text/javascript;base64,' + Buffer.from(core).toString('base64'))
  const before = [...module.SALE_PROVIDERS]
  const after = [...before]
  after.splice(after.indexOf('Fidium') + 1, 0, 'Ziply')
  return { before: constraintDefinition(before), after: constraintDefinition(after), providers: after }
}

// Apply only this migration and record its repository version in the same transaction.
// The normal db-push command would include unrelated pending migrations.
export function migrationTransaction(migration) {
  assert.match(migration, /\ncommit;\s*$/)
  assert.equal(migration.includes('$ziply_source$'), false)
  const history = `insert into supabase_migrations.schema_migrations (version, name, statements)\nvalues ('${MIGRATION_VERSION}', '${MIGRATION_NAME}', ARRAY[$ziply_source$${migration}$ziply_source$]);\ncommit;\n`
  return migration.replace(/commit;\s*$/, history)
}

export function assertLiveBaseline(actual, expected) {
  for (const field of ['id', 'slug', 'version', 'verify_jwt', 'import_map', 'ezbr_sha256']) {
    assert.equal(actual[field], expected[field], `${expected.slug}: live ${field} changed; stop and review`)
  }
  assert.equal(actual.status, 'ACTIVE', `${expected.slug}: live function is not ACTIVE`)
}

export function assertReleaseContext(env, checkedOutSha) {
  assert.equal(env.GITHUB_REPOSITORY, 'phillipbeatty-ctrl/mccoy-field-test')
  assert.equal(env.GITHUB_EVENT_NAME, 'workflow_dispatch')
  assert.equal(env.GITHUB_REF, 'refs/heads/main')
  assert.equal(env.GITHUB_ACTOR, 'phillipbeatty-ctrl')
  assert.equal(env.GITHUB_TRIGGERING_ACTOR, 'phillipbeatty-ctrl')
  assert.match(env.EXPECTED_RELEASE_SHA || '', /^[a-f0-9]{40}$/)
  assert.equal(checkedOutSha, env.EXPECTED_RELEASE_SHA)
  assert.equal(env.GITHUB_SHA, checkedOutSha)
  assert.ok(['preflight', 'deploy'].includes(env.ZIPLY_OPERATION))
  if (env.ZIPLY_OPERATION === 'deploy') assert.equal(env.ZIPLY_CONFIRMATION, 'DEPLOY_ZIPLY')
}

export async function buildPackage(output, release) {
  release ??= await loadPackage()
  const directory = path.resolve(output)
  const evidence = { project_ref: PROJECT, baseline_sha256: BASELINE_HASH, migration_sha256: MIGRATION_HASH, functions: [] }
  for (const fn of release.functions) {
    for (const [kind, files] of [['candidate', fn.files], ['rollback', fn.baseline_files]]) {
      const projectDir = path.join(directory, kind, fn.slug)
      await mkdir(path.join(projectDir, 'supabase'), { recursive: true })
      await writeFile(path.join(projectDir, 'supabase/config.toml'), `project_id = "ziply-${fn.slug}"\n[functions.${fn.slug}]\nverify_jwt = true\n`)
      for (const file of files) {
        const target = path.join(projectDir, 'supabase/functions', file.name)
        await mkdir(path.dirname(target), { recursive: true })
        await writeFile(target, file.content)
      }
    }
    evidence.functions.push({
      slug: fn.slug, baseline_version: fn.version, verify_jwt: true,
      files: fn.files.map(file => ({ name: file.name, sha256: sha256(file.content), baseline_sha256: sha256(fn.baseline_files.find(old => old.name === file.name).content) })),
    })
  }
  await writeFile(path.join(directory, 'package-evidence.json'), JSON.stringify(evidence, null, 2) + '\n')
  return evidence
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  assert.equal(process.argv.length, 3, 'Usage: node scripts/ziply-release-package.mjs <output-directory>')
  const evidence = await buildPackage(process.argv[2])
  console.log(JSON.stringify(evidence, null, 2))
}
