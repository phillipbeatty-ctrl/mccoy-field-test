import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const rep=fs.readFileSync(new URL('./app-sales-to-complete.js',import.meta.url),'utf8');
const admin=fs.readFileSync(new URL('./app-sale-order-photo-admin.js',import.meta.url),'utf8');
const reviewEvents=fs.readFileSync(new URL('./app-sale-review-events.js',import.meta.url),'utf8');
const fn=fs.readFileSync(new URL('./supabase/functions/sale-order-photo/index.ts',import.meta.url),'utf8');
const migration=fs.readFileSync(new URL('./supabase/migrations/20260827052500_sale_order_photo_extraction_pipeline.sql',import.meta.url),'utf8');

test('order photos are private, limited and attached to an existing sale',()=>{
  assert.match(migration,/sale-order-photos/);
  assert.match(migration,/public,false/);
  assert.match(migration,/10485760/);
  assert.match(fn,/sale_not_assigned_to_user/);
  assert.match(fn,/admin_approved_sale_locked/);
  assert.match(fn,/createSignedUploadUrl/);
});

test('AI extraction is suggestion-only with human confirmation gates',()=>{
  assert.match(fn,/Do not infer missing values/);
  assert.match(fn,/requires_user_confirmation:true/);
  assert.match(fn,/requires_admin_approval:true/);
  assert.match(fn,/OPENAI_API_KEY/);
  assert.match(rep,/Draft information extracted/);
  assert.match(rep,/Confirm\/correct every field/);
  assert.match(rep,/SAVE CUSTOMER INFO/);
});

test('rep-confirmed photo remains visible to Admin SALE REVIEW',()=>{
  assert.match(fn,/extraction_status:'user_confirmed'/);
  assert.match(admin,/Attached order photo/);
  assert.match(admin,/Rep confirmed/);
  assert.match(admin,/green APPROVED button/);
  assert.match(admin,/evidence only/);
  assert.match(reviewEvents,/mccoy-sale-review-rendered/);
  assert.doesNotMatch(admin,/MutationObserver/);
});

test('photo extraction can fail without blocking manual customer entry',()=>{
  assert.match(rep,/Automatic extraction is not configured yet/);
  assert.match(rep,/enter the information manually/);
  assert.match(fn,/ai_extraction_not_configured/);
});
