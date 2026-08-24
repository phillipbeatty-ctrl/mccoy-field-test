import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration=fs.readFileSync(new URL('./supabase/migrations/20260824090000_all_users_all_lead_dispositions.sql',import.meta.url),'utf8');
const edge=fs.readFileSync(new URL('./supabase/functions/lead-admin/index.ts',import.meta.url),'utf8');
const pool=fs.readFileSync(new URL('./app-lead-pool.js',import.meta.url),'utf8');
const spotio=fs.readFileSync(new URL('./supabase/migrations/20260824070000_spotio_pin_dispositions.sql',import.meta.url),'utf8');

test('every active field role may start an audited visit on every real lead',()=>{
  assert.match(migration,/coalesce\(v_access\.role,''\) not in \('admin','manager','trainer','rep','tester'\)/);
  assert.doesNotMatch(migration,/assigned_rep_id is distinct from v_profile\.id/);
  assert.doesNotMatch(migration,/lead_outside_assigned_pool|lead_not_assigned_to_rep/);
  assert.match(migration,/'disposition_scope','all_leads'/);
  assert.match(migration,/'lead_assignment_changed',false/);
});

test('all-lead authority does not remove location, distance, or verified-sale controls',()=>{
  assert.match(migration,/verified_lead_location_required/);
  assert.match(migration,/p_accuracy_meters>150/);
  assert.match(migration,/v_distance>402\.336/);
  assert.match(spotio,/sale_made_requires_completed_sale/);
  assert.match(migration,/revoke all on function public\.record_door_visit_start[\s\S]+from public,anon/);
});

test('lead-admin returns the same real-lead disposition scope to every active user',()=>{
  const listBlock=edge.slice(edge.indexOf("if(action==='list_real_leads')"),edge.indexOf("if(action==='update_lead')"));
  assert.match(listBlock,/scope:'all_disposition'/);
  assert.match(listBlock,/assignment_required:false/);
  assert.doesNotMatch(listBlock,/query=query\.eq\('assigned_rep_id'/);
  assert.doesNotMatch(listBlock,/administrator_lead_assignment_required|representative_lead_assignment_required/);
  assert.match(pool,/scope='ALL LEADS'/);
});

test('assignment mutations remain Manager\/Trainer\/Admin only',()=>{
  assert.match(edge,/managerActions=\['list_reps','assign_lead','assign_leads'\]/);
  assert.match(edge,/if\(!isAdmin&&!isManager\)return json\(\{error:'manager_or_admin_only'\},403\)/);
  assert.match(edge,/managerMayAssign/);
});
