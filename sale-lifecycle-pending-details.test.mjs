import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const lifecycle=fs.readFileSync(new URL('./app-sale-lifecycle.js',import.meta.url),'utf8');
const complete=fs.readFileSync(new URL('./app-sales-to-complete.js',import.meta.url),'utf8');
const layout=fs.readFileSync(new URL('./app-page-layout.js',import.meta.url),'utf8');

test('PROCESS SALE is removed and Sale Made saves disposition before provider outcome',()=>{
  assert.match(lifecycle,/processSaleBtn/);
  assert.match(lifecycle,/\.remove\(\)/);
  assert.match(lifecycle,/MCCOY_COMPLETE_DOOR_VISIT.*spotio/s);
  assert.match(lifecycle,/selection\.stage==='Sale Made'/);
  assert.match(lifecycle,/data\.disp='Sale'|dataset\.disp='Sale'/);
});

test('reps can complete unapproved sale details later',()=>{
  assert.match(complete,/SALES TO COMPLETE/);
  assert.match(complete,/my_sales_to_complete/);
  assert.match(complete,/save_my_sale_details/);
  for(const field of ['customer_first_name','customer_last_name','customer_phone','customer_email','service_address','provider_order_number','provider_account_number','install_date','order_date']) assert.match(complete,new RegExp(field));
});

test('Customer List is gated to Admin-approved sales',()=>{
  assert.match(complete,/admin_sale_review_verified/);
  assert.match(complete,/accounting-records/);
  assert.match(layout,/Approved customer sales/);
});

test('sale lifecycle modules are loaded after the existing app modules',()=>{
  assert.match(layout,/app-sale-lifecycle\.js/);
  assert.match(layout,/app-sales-to-complete\.js/);
});
