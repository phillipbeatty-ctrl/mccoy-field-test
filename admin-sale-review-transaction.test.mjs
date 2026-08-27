import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ui=fs.readFileSync(new URL('./app-admin-sale-review.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8');

test('Admin Sale Review uses the atomic server transaction',()=>{
  assert.match(ui,/admin_review_sale_transaction/);
  assert.match(ui,/p_credited_rep_email/);
  assert.match(ui,/p_provider_sale_row_id/);
  assert.match(ui,/p_corrections/);
  assert.match(ui,/>APPROVED</);
  assert.doesNotMatch(ui,/asrReason/);
  assert.doesNotMatch(ui,/SAVE REVIEW &amp; APPROVE/);
});

test('Admin can correct customer and order details in the approval transaction',()=>{
  for(const field of ['customer_first_name','customer_last_name','customer_phone','customer_email','service_address','provider_order_number','provider_account_number','install_date','order_date']) assert.match(ui,new RegExp(field));
  assert.match(ui,/Customer information saved/);
});

test('Admin-selected credited user is explicit and required',()=>{
  assert.match(ui,/Authoritative credited user/);
  assert.match(ui,/Choose the authoritative credited user/);
});

test('legacy APPROVED control is removed from the visible Sale Credit UI',()=>{
  assert.match(ui,/saleCreditApprove/);
  assert.match(ui,/display:none!important/);
});

test('production shell loads the Admin Sale Review module',()=>{
  assert.match(html,/app-admin-sale-review\.js\?v=2026082601/);
});
