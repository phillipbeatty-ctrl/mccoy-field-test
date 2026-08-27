import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ui=fs.readFileSync(new URL('./app-admin-sale-review.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8');

test('SALE REVIEW uses one atomic approval transaction',()=>{
  assert.match(ui,/admin_review_sale_transaction/);
  assert.match(ui,/p_credited_rep_email/);
  assert.match(ui,/p_provider_sale_row_id/);
  assert.match(ui,/p_corrections/);
  assert.match(ui,/SALE REVIEW/);
  assert.match(ui,/>APPROVED</);
  assert.doesNotMatch(ui,/asrReason/);
});

test('SALE REVIEW exposes all customer and order corrections',()=>{
  for(const field of ['customer_first_name','customer_last_name','customer_phone','customer_email','service_address','provider_order_number','provider_account_number','install_date','order_date','isp','internet_product','internet_speed_mbps','notes']) assert.match(ui,new RegExp(field));
  assert.match(ui,/Customer information saved/);
});

test('SALE REVIEW can assign any active user',()=>{
  assert.match(ui,/Credited user/);
  assert.match(ui,/app_user_access/);
  assert.match(ui,/Choose the credited user before approving/);
});

test('green APPROVED is the single positive approval action',()=>{
  assert.match(ui,/#asrSave/);
  assert.match(ui,/#15803d/);
  assert.match(ui,/const old=document\.getElementById\('saleCreditBtn'\);if\(old\)old\.remove\(\)/);
});

test('production shell loads the unified SALE REVIEW module after legacy Sale Credit',()=>{
  assert.match(html,/app-admin-sale-credit\.js/);
  assert.match(html,/app-admin-sale-review\.js\?v=2026082601/);
});
