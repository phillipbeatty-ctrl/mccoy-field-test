import assert from 'node:assert/strict';
import {
  annotateEarnedPay, buildAccountingCsv, csvCell, isCancelledProviderStatus, startOfWeekPacific
} from './accounting-records.mjs';

const rule = { weekly_production_pay_increase: [
  { min_sales: 15, max_sales: 24, increase_per_sale: 25 },
  { min_sales: 25, max_sales: null, increase_per_sale: 50 }
] };
const base = {
  rep_user_id: 'rep-1', created_at: '2026-08-17T18:00:00Z', isp: 'Quantum', internet_product: 'Internet',
  verification_status: 'verified_processed', competition_eligible: true, sale_status: 'reported',
  compensation_snapshot: { pay_level: 'experienced', base_commission: 200, att_mobile_originating_commission: 75 }
};
const fifteen = Array.from({length:15}, (_,index) => ({...base,id:`sale-${index}`}));
const paid = annotateEarnedPay(fifteen, rule);
assert.equal(paid[0].weekly_production_increase_per_sale, 25);
assert.equal(paid[0].current_earned_pay, 300);

const withCancellation = fifteen.map((sale,index) => index === 0 ? {...sale,sale_status:'cancelled',competition_eligible:false} : sale);
const reduced = annotateEarnedPay(withCancellation, rule);
assert.equal(reduced[0].current_earned_pay, 0);
assert.equal(reduced[0].cancellation_reduction, 275);
assert.equal(reduced[1].weekly_production_increase_per_sale, 0);
assert.equal(reduced[1].current_earned_pay, 275);

const outsidePending = annotateEarnedPay([{...base,id:'outside',compensation_snapshot:{...base.compensation_snapshot,sale_origin:'outside_system',admin_approval:{status:'pending'}}}],rule)[0];
assert.equal(outsidePending.current_earned_pay,0);
assert.equal(startOfWeekPacific('2026-08-20T18:00:00Z'),'2026-08-17');
assert.equal(csvCell('=HYPERLINK("bad")'),'"\'=HYPERLINK(""bad"")"');
const csv = buildAccountingCsv([{...paid[0],session_id:'session-a',provider_sale_row_id:'provider-row-a',customer_email:'customer@example.com'}]);
assert.ok(csv.includes('customer@example.com'));
assert.ok(csv.includes('session_id'));
assert.ok(csv.includes('session-a'));
assert.ok(csv.includes('provider_sale_row_id'));
assert.ok(csv.includes('provider-row-a'));
assert.equal(isCancelledProviderStatus('Cancelled'),true);
assert.equal(isCancelledProviderStatus('Pending Cancellation'),false);
assert.equal(isCancelledProviderStatus('Active'),false);

console.log('Accounting record and cancellation tests passed.');
