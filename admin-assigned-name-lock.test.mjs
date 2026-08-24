import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const migration = readFileSync(
  new URL('./supabase/migrations/20260823091000_admin_assigned_display_name_lock.sql', import.meta.url),
  'utf8'
)
const usersUi = readFileSync(new URL('./app-admin-users.js', import.meta.url), 'utf8')
const onboarding = readFileSync(new URL('./supabase/functions/rep-onboarding/index.ts', import.meta.url), 'utf8')

test('browser roles cannot write authoritative access or profile names', () => {
  assert.match(migration, /revoke insert, update, delete, truncate, references, trigger\s+on public\.app_user_access from anon, authenticated/i)
  assert.match(migration, /revoke insert, update, delete, truncate, references, trigger\s+on public\.users from anon, authenticated/i)
  assert.match(migration, /display_name_assigned_by_admin/)
  assert.match(migration, /profile_name_assigned_by_admin/)
})

test('the rename propagation function remains service-role only', () => {
  assert.match(migration, /revoke all on function public\.admin_rename_app_user[\s\S]+from public, anon, authenticated/)
  assert.match(migration, /grant execute on function public\.admin_rename_app_user[\s\S]+to service_role/)
  assert.match(onboarding, /action==='update_user'/)
  assert.match(onboarding, /admin\.rpc\('admin_rename_app_user'/)
})

test('the Admin user screen explains the assigned-name authority', () => {
  assert.match(usersUi, /Active users cannot change the name assigned by Admin/)
  assert.match(usersUi, /Admin-assigned display name shown to other users/)
})
