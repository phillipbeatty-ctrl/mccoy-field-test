import assert from 'node:assert/strict'
import test from 'node:test'
import {readFile} from 'node:fs/promises'

const migration=await readFile(new URL('./supabase/migrations/20260824050000_ghost_automatic_overtake_visibility.sql',import.meta.url),'utf8')
const rankingsUi=await readFile(new URL('./app-compensation.js',import.meta.url),'utf8')
const coach=await readFile(new URL('./supabase/functions/rep-coach-summary/index.ts',import.meta.url),'utf8')

test('Admin and the exact Ghost identity always see Ghost totals',()=>{
  assert.match(migration,/v_can_see_ghost_numbers:=v_is_admin or v_is_ghost/)
  assert.match(migration,/v_requester_email=v_ghost_email and v_requester_name='ghost'/)
  assert.match(migration,/admin_ghost_or_metric_overtaken/)
})

test('ordinary users see each Ghost total only while that period is overtaken',()=>{
  assert.match(migration,/v_allowed:=coalesce\(p_can_see,false\) or v_overtaken/)
  assert.match(migration,/v_item:=jsonb_set\(v_item,array\[v_sales_key\],'null'::jsonb,true\)/)
  assert.match(migration,/'revealed',v_allowed/)
  assert.doesNotMatch(migration,/jsonb_set\(v_item,'\{ranks/)
})

test('Ghost is always listed and has no manual Overtake switch',()=>{
  assert.match(migration,/'visible',true,'overtaken'/)
  assert.match(migration,/'overtake_control','always_active'/)
  assert.match(migration,/revoke execute on function public\.admin_set_ghost_ranking_goals/)
  assert.match(rankingsUi,/Ghost Overtake Control · Always Active/)
  assert.match(rankingsUi,/There is no Admin switch/)
  assert.match(rankingsUi,/function ghostVisibleFor\(\)\{return true;\}/)
})

test('field-coaching numbers keep the Admin-or-Ghost privacy boundary',()=>{
  assert.match(coach,/targetIsGhost&&viewer\.role!=='admin'&&!viewerIsGhost/)
  assert.match(coach,/ghost_metrics_hidden/)
})
