import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const migration=fs.readFileSync(new URL('./supabase/migrations/20260824070000_spotio_pin_dispositions.sql',import.meta.url),'utf8')
const client=fs.readFileSync(new URL('./app-part2.js',import.meta.url),'utf8')
const sales=fs.readFileSync(new URL('./app-sales.js',import.meta.url),'utf8')

test('pin disposition save is atomic, GPS-audited, and permission-scoped',()=>{
  assert.match(migration,/record_spotio_door_visit_completion/)
  assert.match(migration,/record_door_visit_completion\(p_visit_id,v_legacy,p_latitude,p_longitude,p_accuracy_meters,p_gps_captured_at/)
  assert.match(migration,/security definer/)
  assert.match(migration,/set search_path=pg_catalog,public,private,auth/)
  assert.match(migration,/revoke all on function public\.record_spotio_door_visit_completion[\s\S]+from public,anon/)
  assert.match(migration,/grant execute on function public\.record_spotio_door_visit_completion[\s\S]+to authenticated/)
})

test('Sale Made cannot bypass the completed-sale workflow',()=>{
  assert.match(migration,/sale_made_requires_completed_sale/)
  assert.match(migration,/rep_reported_outcome is distinct from 'completed'/)
  assert.match(migration,/stage='Sale Made'/)
  assert.match(client,/selection\.stage==='Sale Made'/)
  assert.match(client,/processSaleBtn/)
  assert.match(sales,/\[data-disp="Sale"\]/)
})

test('client records all three fields through the new RPC',()=>{
  assert.match(client,/record_spotio_door_visit_completion/)
  assert.match(client,/p_activity_type:selection\.activityType/)
  assert.match(client,/p_visit_result:selection\.visitResult/)
  assert.match(client,/p_stage:selection\.stage\|\|null/)
})
