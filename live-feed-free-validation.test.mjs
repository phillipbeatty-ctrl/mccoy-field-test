import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8')
const workflow=read('./.github/workflows/live-feed-local-supabase-preview.yml')
const validator=read('./scripts/live-feed-local-supabase-validate.sh')
const docs=read('./docs/live-feed-free-test-plan.md')
const previewDocs=read('./docs/live-feed-comments-preview.md')

const productionProjectRef='athxxrfqxwlfnuvbqadp'

test('promotion plan uses the free staged path instead of requiring a paid branch',()=>{
  assert.match(docs,/Local Supabase Docker validation/)
  assert.match(docs,/optional free Supabase staging project/i)
  assert.match(docs,/controlled one-team production feature flag/i)
  assert.match(docs,/physical mobile testing/i)
  assert.match(docs,/wider rollout only after isolation passes/i)
  assert.match(docs,/No recurring paid Supabase branch is required/i)
  assert.doesNotMatch(docs,/paid Supabase preview branch required/i)
})

test('local validator is fail-closed to loopback database URLs',()=>{
  assert.match(validator,/supabase status -o env/)
  assert.match(validator,/127\.0\.0\.1/)
  assert.match(validator,/localhost/)
  assert.match(validator,/Refusing to run preview SQL against a non-local database URL/)
  assert.match(validator,/--single-transaction -f "\$MIGRATION"/)
  assert.match(validator,/Row Level Security is not enabled/)
  assert.match(validator,/Expected all four scoped v2 RPCs/)
})

test('local validator requires rollback and rejects synthetic residue',()=>{
  assert.match(validator,/ROLLBACK/)
  assert.match(validator,/Synthetic comment data remained after the canary/)
  assert.match(validator,/Synthetic Auth identities remained after the canary/)
  assert.match(validator,/The preview migration must remain outside the production migration directory/)
})

test('GitHub workflow uses disposable Docker-backed Supabase without cloud credentials',()=>{
  assert.match(workflow,/supabase\/setup-cli@v1/)
  assert.match(workflow,/supabase start/)
  assert.match(workflow,/supabase db reset/)
  assert.match(workflow,/bash scripts\/live-feed-local-supabase-validate\.sh/)
  assert.match(workflow,/supabase stop --no-backup/)
  assert.match(workflow,/permissions:\s*\n\s*contents: read/)
  assert.doesNotMatch(workflow,/SUPABASE_ACCESS_TOKEN/)
  assert.doesNotMatch(workflow,/SUPABASE_DB_URL/)
  assert.doesNotMatch(workflow,new RegExp(productionProjectRef))
})

test('sanitized evidence excludes the local status environment',()=>{
  assert.match(workflow,/Upload sanitized validation evidence/)
  assert.match(workflow,/path: \.artifacts\/live-feed-local/)
  assert.doesNotMatch(validator,/status_env[^\n]*>[^\n]*ARTIFACT_DIR/)
  assert.doesNotMatch(validator,/DB_URL[^\n]*summary\.txt/)
})

test('one-team production pilot remains server-gated and disabled by default',()=>{
  assert.match(docs,/Default: comments disabled for every organization and team/)
  assert.match(docs,/pilot enables exactly one McCoy team ID/i)
  assert.match(docs,/Every read RPC, post RPC, moderation RPC, deletion RPC, table RLS policy, and Realtime delivery path must consult the same rollout control/)
  assert.match(docs,/Browser feature flags alone are not sufficient/)
  assert.match(docs,/explicit end time and a tested rollback switch/)
})

test('existing preview document points to the free validation plan while retaining production guards',()=>{
  assert.match(previewDocs,/free validation/i)
  assert.match(previewDocs,/docs\/live-feed-free-test-plan\.md/)
  assert.match(previewDocs,/Do not merge/i)
  assert.match(previewDocs,/do not deploy/i)
})
