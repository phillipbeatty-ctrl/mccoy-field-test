import assert from 'node:assert/strict'
import test from 'node:test'
import {readFile} from 'node:fs/promises'

const migration=await readFile(new URL('./supabase/migrations/20260824030000_ghost_numbers_admin_and_self_only.sql',import.meta.url),'utf8')
const rankingsUi=await readFile(new URL('./app-compensation.js',import.meta.url),'utf8')
const coach=await readFile(new URL('./supabase/functions/rep-coach-summary/index.ts',import.meta.url),'utf8')

test('Ghost numbers are authorized only for Admin and the exact active Ghost identity',()=>{
  assert.match(migration,/v_can_see_ghost_numbers := v_is_admin or v_is_ghost/)
  assert.match(migration,/v_requester_email = v_ghost_email\s+and v_requester_name = 'ghost'/)
  assert.match(migration,/ghost_numbers_visible_to', 'admin_and_ghost'/)
})

test('ordinary ranking responses retain placement but redact Ghost performance numbers',()=>{
  assert.match(migration,/\{today_sales\}', 'null'::jsonb/)
  assert.match(migration,/\{month_mobile_lines\}', 'null'::jsonb/)
  assert.match(migration,/v_state := v_state - 'beaten_by'/)
  assert.doesNotMatch(migration,/jsonb_set\(v_item, '\{ranks/)
})

test('Ghost sees personal totals even after the public benchmark row is hidden',()=>{
  assert.match(rankingsUi,/state\?\.visible===false&&!rep\?\.is_current_user/)
  assert.match(rankingsUi,/Hidden from public rankings · your benchmark remains visible/)
})

test('field-coaching numbers use the same Admin-or-Ghost boundary',()=>{
  assert.match(coach,/targetIsGhost&&viewer\.role!=='admin'&&!viewerIsGhost/)
  assert.match(coach,/ghost_metrics_hidden/)
})
