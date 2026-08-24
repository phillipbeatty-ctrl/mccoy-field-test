import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const migration = readFileSync(
  new URL('./supabase/migrations/20260824210000_admin_user_account_removal.sql', import.meta.url),
  'utf8'
)
const onboarding = readFileSync(new URL('./supabase/functions/rep-onboarding/index.ts', import.meta.url), 'utf8')
const usersUi = readFileSync(new URL('./app-admin-users.js', import.meta.url), 'utf8')
const index = readFileSync(new URL('./index.html', import.meta.url), 'utf8')

test('account removal is Admin-only, explicit, and cannot delete protected accounts', () => {
  assert.match(onboarding, /!callerAccess\?\.active\|\|callerAccess\.role!=='admin'/)
  assert.match(onboarding, /action==='preview_user_removal'\|\|action==='remove_user_account'/)
  assert.match(onboarding, /confirmation!==target/)
  assert.match(onboarding, /reason\.length<10\|\|reason\.length>500/)
  assert.match(onboarding, /target===email/)
  assert.match(migration, /cannot_delete_own_account/)
  assert.match(migration, /original_owner_account_is_protected/)
  assert.match(migration, /revoke_secondary_admin_before_account_removal/)
})

test('the Auth account is soft-deleted only after transactional McCoy cleanup', () => {
  const prepareAt = onboarding.indexOf("admin_prepare_user_account_removal")
  const deleteAt = onboarding.indexOf("admin.auth.admin.deleteUser(account.id,true)")
  const finalizeAt = onboarding.indexOf("admin_finalize_user_account_removal")
  assert.ok(prepareAt >= 0 && deleteAt > prepareAt && finalizeAt > deleteAt)
  assert.match(migration, /update public\.app_user_access[\s\S]+set active=false/)
  assert.match(migration, /update public\.users set active=false/)
  assert.match(migration, /update public\.test_sessions[\s\S]+set ended_at=v_now/)
  assert.match(migration, /update public\.door_visits[\s\S]+status='cancelled'/)
  assert.match(migration, /update public\.provider_sale_captures[\s\S]+rep_outcome='abandoned'/)
  assert.match(migration, /update public\.leads[\s\S]+assigned_rep_id=case/)
})

test('historical accounting and rankings are retained while live access is removed', () => {
  assert.match(migration, /historical_sales_retained/)
  assert.match(migration, /historical_wins_retained/)
  assert.match(migration, /chargebacks_retained/)
  assert.doesNotMatch(migration, /delete\s+from\s+public\.(sales_records|sales_feed|commission_chargebacks)/i)
  assert.match(usersUi, /Historical sales, rankings, payroll, customers, and audit records will be retained/)
})

test('storage ownership and direct operational dependencies are handled safely', () => {
  assert.match(migration, /from storage\.objects/)
  assert.match(migration, /storage_objects_must_be_reassigned_before_account_removal/)
  assert.match(migration, /direct_reports_unassigned/)
  assert.match(migration, /lead_assignments_cleared/)
  assert.match(migration, /provider_seller_links_deactivated/)
  assert.match(migration, /provider_access_deactivated/)
})

test('removal history is RLS-protected, service-controlled, and immutable', () => {
  assert.match(migration, /alter table public\.user_account_removal_history enable row level security/)
  assert.match(migration, /revoke all on table public\.user_account_removal_history from public,anon,authenticated/)
  assert.match(migration, /user_account_removal_history_admin_read/)
  assert.match(migration, /user_account_removal_history_is_immutable/)
  assert.match(migration, /grant execute on function public\.admin_prepare_user_account_removal[\s\S]+to service_role/)
  assert.match(migration, /revoke all on function public\.admin_prepare_user_account_removal[\s\S]+from public,anon,authenticated/)
})

test('Admin UI previews impact and requires typed-email plus final confirmation', () => {
  assert.match(usersUi, /DELETE USER ACCOUNT/)
  assert.match(usersUi, /preview_user_removal/)
  assert.match(usersUi, /confirmation\.value\.trim\(\)\.toLowerCase\(\)!==exactEmail/)
  assert.match(usersUi, /window\.confirm/)
  assert.match(usersUi, /remove_user_account/)
  assert.match(usersUi, /Admin accounts are protected/)
  assert.match(usersUi, /Removed Accounts/)
  assert.match(index, /app-admin-users\.js\?v=2026082421/)
})
