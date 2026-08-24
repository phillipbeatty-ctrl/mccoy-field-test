import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const pool=fs.readFileSync(new URL('./app-lead-pool.js',import.meta.url),'utf8');
const detail=fs.readFileSync(new URL('./app-lead-detail-panel.js',import.meta.url),'utf8');
const admin=fs.readFileSync(new URL('./supabase/functions/lead-admin/index.ts',import.meta.url),'utf8');
const migration=fs.readFileSync(new URL('./supabase/migrations/20260824170000_all_user_lead_duplicate_cleanup.sql',import.meta.url),'utf8');
const requestedCleanup=fs.readFileSync(new URL('./supabase/migrations/20260824170100_remove_requested_battle_ground_duplicate.sql',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8');

test('every active field role reaches guarded lead cleanup actions',()=>{
  assert.match(admin,/allFieldActions=\['list_real_leads','duplicate_status','delete_lead','remove_duplicate_leads'\]/);
  assert.match(admin,/admin\.rpc\('archive_lead'/);
  assert.match(admin,/admin\.rpc\('archive_verified_lead_duplicates'/);
  assert.match(admin,/admin\.rpc\('lead_duplicate_status'/);
  assert.match(admin,/\.is\('deleted_at',null\)/);
});

test('Lead Pool provides delete on each row and a two-step duplicate control',()=>{
  assert.match(pool,/id="checkDuplicateLeadsBtn"[^>]*>CHECK DUPLICATES</);
  assert.match(pool,/REMOVE \$\{removable\.toLocaleString\(\)\} DUPLICATE/);
  assert.match(pool,/window\.confirm\(`Remove \$\{removable\.toLocaleString\(\)\}/);
  assert.match(pool,/class="danger delete-one"/);
  assert.match(pool,/window\.MCCOY_DELETE_LEAD=deleteLead/);
  assert.match(detail,/id="mapDeleteLeadBtn"[^>]*class="danger">DELETE LEAD/);
});

test('duplicate verification normalizes formatting while preserving unit identity',()=>{
  assert.match(migration,/private\.mccoy_normalized_lead_address/);
  assert.match(migration,/matching suffix/);
  assert.match(migration,/regexp_replace\(v_street,'\\m\(circle\)\\M','cir','g'\)/);
  assert.match(migration,/v_unit:=regexp_replace/);
  assert.match(migration,/partition by s\.normalized_address_key/);
  assert.match(migration,/verification_rule','same normalized street, unit, city, state, and ZIP; unit values remain distinct'/);
});

test('removal is reversible, audited, and cannot erase active work',()=>{
  assert.match(migration,/create table if not exists public\.lead_removal_audit/);
  assert.match(migration,/deleted_at=v_now/);
  assert.match(migration,/lead_snapshot jsonb not null/);
  assert.match(migration,/active_visit_exists/);
  assert.match(migration,/where id=p_lead_id and deleted_at is null/);
  assert.doesNotMatch(migration,/delete from public\.leads/i);
});

test('bulk cleanup keeps the strongest canonical record and requires a verified snapshot',()=>{
  assert.match(migration,/has_active_visit desc,coalesce\(s\.attempt_count,0\) desc/);
  assert.match(migration,/p_snapshot_token/);
  assert.match(migration,/p_expected_extra_leads/);
  assert.match(migration,/duplicate_set_changed/);
  assert.match(migration,/duplicate_of_lead_id=c\.canonical_lead_id/);
});

test('known Battle Ground duplicate is cleaned without hard-coded generated IDs',()=>{
  assert.match(requestedCleanup,/413 SW 6th Circle/);
  assert.match(requestedCleanup,/v_count<>2/);
  assert.match(requestedCleanup,/v_removed<>1/);
  assert.match(requestedCleanup,/maximum_rows',1/);
  assert.match(requestedCleanup,/requested_address_cleanup/);
  assert.doesNotMatch(requestedCleanup,/25019c59|83d4f28a/);
  assert.doesNotMatch(migration,/requested_address_cleanup/);
  assert.match(html,/app-lead-pool\.js\?v=2026082415/);
  assert.match(html,/app-lead-detail-panel\.js\?v=2026082415/);
});
