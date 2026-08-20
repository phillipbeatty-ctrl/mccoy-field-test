import assert from 'node:assert/strict';
import {
  attMobileCommission,
  baseCommissionForSale,
  commissionSnapshot,
  normalizePayLevel,
  weeklyProductionTier
} from './compensation-calculator.mjs';

const rule = {
  quantum: { trainee: 150, experienced: 200, active_manager_trainer: 250 },
  brightspeed: {
    below_1_gig: { trainee: 150, experienced: 100, active_manager_trainer: 150 },
    '1_gig': { trainee: 150, experienced: 150, active_manager_trainer: 200 },
    '2_gig': { trainee: 150, experienced: 200, active_manager_trainer: 250 }
  },
  att: {
    internet_air: 125,
    fiber_below_1_gig: { trainee: 150, experienced: 100, active_manager_trainer: 150 },
    fiber_1_gig: { trainee: 150, experienced: 200, active_manager_trainer: 250 },
    mobile_first_line: 75,
    mobile_additional_line: 50
  },
  weekly_production_pay_increase: [
    { min_sales: 15, max_sales: 24, increase_per_sale: 25 },
    { min_sales: 25, max_sales: null, increase_per_sale: 50 }
  ]
};

assert.equal(normalizePayLevel('Experienced'), 'experienced');
assert.equal(normalizePayLevel('unknown'), null);
assert.equal(baseCommissionForSale(rule, { isp: 'Quantum' }, 'active_manager_trainer'), 250);
assert.equal(baseCommissionForSale(rule, { isp: 'Brightspeed', internet_speed_mbps: 1000 }, 'experienced'), 150);
assert.equal(baseCommissionForSale(rule, { isp: 'Brightspeed', internet_speed_mbps: 2000 }, 'experienced'), 200);
assert.equal(baseCommissionForSale(rule, { isp: 'Brightspeed', internet_speed_mbps: 500 }, 'trainee'), 150);
assert.equal(baseCommissionForSale(rule, { isp: 'AT&T', internet_product: 'Fiber', internet_speed_mbps: 1000 }, 'active_manager_trainer'), 250);
assert.equal(baseCommissionForSale(rule, { isp: 'AT&T', internet_product: 'Fiber', internet_speed_mbps: 500 }, 'experienced'), 100);
assert.equal(baseCommissionForSale(rule, { isp: 'AT&T', internet_product: 'Internet Air' }, 'trainee'), 125);
assert.equal(attMobileCommission(rule, 1), 75);
assert.equal(attMobileCommission(rule, 3), 175);
assert.equal(weeklyProductionTier(rule, 14).current, null);
assert.equal(weeklyProductionTier(rule, 15).current.increase_per_sale, 25);
assert.equal(weeklyProductionTier(rule, 25).current.increase_per_sale, 50);
assert.deepEqual(
  commissionSnapshot(rule, { isp: 'Quantum', mobile_phone_lines: 2 }, 'experienced'),
  {
    pay_level: 'experienced',
    pay_level_label: 'Experienced Rep',
    base_commission: 200,
    att_mobile_originating_commission: 125,
    mobile_phone_lines: 2
  }
);

console.log('100% commission calculator tests passed.');
