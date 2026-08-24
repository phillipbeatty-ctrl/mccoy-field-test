import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const repair = fs.readFileSync(new URL('./supabase/migrations/20260824183000_realign_door_visits_session_foreign_key.sql', import.meta.url), 'utf8')
const assignedDoorWorkflow = fs.readFileSync(new URL('./supabase/migrations/20260824170000_all_user_lead_duplicate_cleanup.sql', import.meta.url), 'utf8')
const typedDoorWorkflow = fs.readFileSync(new URL('./supabase/migrations/20260824152622_coaching_only_door_location.sql', import.meta.url), 'utf8')

test('door visits use the same session table validated by assigned and typed address workflows', () => {
  assert.match(assignedDoorWorkflow, /from public\.test_sessions where id=p_session_id/)
  assert.match(typedDoorWorkflow, /from public\.test_sessions where id=p_session_id/g)
  assert.match(repair, /foreign key \(session_id\)[\s\S]*references public\.test_sessions\(id\)[\s\S]*on delete cascade/)
  assert.doesNotMatch(repair, /references public\.field_sessions\(id\)/)
})

test('repair refuses unknown schema drift and orphaned door visits', () => {
  assert.match(repair, /unexpected_door_visits_session_foreign_key_target/)
  assert.match(repair, /door_visits_session_repair_requires_backfill/)
  assert.match(repair, /left join public\.test_sessions session_row on session_row\.id = visit\.session_id/)
})

test('repair verifies the final target and cascade behavior inside the migration', () => {
  assert.match(repair, /constraint_row\.confrelid = 'public\.test_sessions'::regclass/)
  assert.match(repair, /constraint_row\.confdeltype = 'c'/)
  assert.match(repair, /door_visits_session_foreign_key_repair_failed/)
})
