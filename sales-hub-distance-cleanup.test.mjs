import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const distanceUi=fs.readFileSync(new URL('./app-distance-to-lead.js',import.meta.url),'utf8');
const fieldAddresses=fs.readFileSync(new URL('./app-field-addresses.js',import.meta.url),'utf8');
const typedAddress=fs.readFileSync(new URL('./app-typed-lead-address.js',import.meta.url),'utf8');
const providerRouter=fs.readFileSync(new URL('./app-provider-sale-router.js',import.meta.url),'utf8');
const sales=fs.readFileSync(new URL('./app-sales.js',import.meta.url),'utf8');
const saleSubmit=fs.readFileSync(new URL('./supabase/functions/sale-submit/index.ts',import.meta.url),'utf8');
const distanceMigration=fs.readFileSync(new URL('./supabase/migrations/20260822200054_sale_distance_audit.sql',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8');

test('Sales Hub exposes one lead or service address control and no distance panel',()=>{
  assert.match(typedAddress,/fieldLeadAddressInput/);
  assert.match(typedAddress,/Lead or service address/);
  for(const source of [distanceUi,fieldAddresses,typedAddress]){
    assert.doesNotMatch(source,/outsideSaleAddress|outsideSaleAddressWrap/);
    assert.doesNotMatch(source,/DISTANCE TO LEAD|distanceLeadStatus|distanceLeadMode|distanceLeadRule/);
    assert.doesNotMatch(source,/Closest address:/);
  }
});

test('silent location automation retains correction without rendering distance',()=>{
  assert.match(distanceUi,/Distance is never rendered as a field metric/);
  assert.match(distanceUi,/correctButton\.textContent='CORRECT LEAD'/);
  assert.match(distanceUi,/arriveButton\?\.insertAdjacentElement\('afterend',correctButton\)/);
  assert.doesNotMatch(distanceUi,/ft away|mi away|formatDistance|Waiting for a current location/);
  assert.doesNotMatch(distanceUi,/Non-sale dispositions are locked|only SALE is enabled/);
});

test('distance never decides which service address or lead label reaches sale processing',()=>{
  assert.doesNotMatch(sales,/doorContext\?\.withinRange\?\(lead\?\.address/);
  assert.match(sales,/doorContext\?\.address\|\|capture\?\.service_address\|\|\(lead\?\.address\|\|lead\?\.fullAddress\)/);
  assert.doesNotMatch(providerRouter,/distanceContext&&!distanceContext\.withinRange/);
  assert.match(providerRouter,/lead_label:typedAddress\|\|\(lead\?\.address\|\|lead\?\.fullAddress\|\|null\)/);
});

test('sale distance remains an informational field attached to the saved sale',()=>{
  assert.match(sales,/async function saleDistanceInput\(lead,serviceAddress\)/);
  assert.match(sales,/payload\.rep_location=/);
  assert.match(sales,/payload\.customer_map_location=/);
  assert.match(saleSubmit,/const distanceAudit = saleDistanceAudit\(body\.rep_location, body\.customer_map_location\)/);
  assert.match(saleSubmit,/rep_distance_from_customer_meters: distanceAudit\.distance_meters/);
  assert.match(saleSubmit,/distance_measurement_status: distanceAudit\.status/);
  assert.match(saleSubmit,/informational_only: true/);
  assert.match(distanceMigration,/This value does not approve, reject, rank, or calculate pay for a sale/);
});

test('cache versions force the cleaned Sales Hub assets to replace the redundant UI',()=>{
  for(const asset of ['app-part1.js','app-door-workflow-core.js','app-field-addresses.js','app-typed-lead-address.js','app-distance-to-lead.js','app-provider-sale-router.js','app-sales.js']){
    assert.match(html,new RegExp(`${asset.replaceAll('.','\\.')}\\?v=2026082414`));
  }
});
