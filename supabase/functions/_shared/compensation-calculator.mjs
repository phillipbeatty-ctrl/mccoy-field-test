export const PAY_LEVELS = Object.freeze([
  Object.freeze({ key: 'trainee', label: 'Trainee' }),
  Object.freeze({ key: 'experienced', label: 'Experienced Rep' }),
  Object.freeze({ key: 'active_manager_trainer', label: 'Active Manager / Trainer' })
]);

const PAY_LEVEL_KEYS = new Set(PAY_LEVELS.map(level => level.key));

export function normalizePayLevel(value) {
  const key = String(value || '').trim().toLowerCase();
  return PAY_LEVEL_KEYS.has(key) ? key : null;
}

export function payLevelLabel(value) {
  const key = normalizePayLevel(value);
  return PAY_LEVELS.find(level => level.key === key)?.label || 'Not assigned';
}

function numeric(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : null;
}

export function baseCommissionForSale(rule, sale, payLevel) {
  const level = normalizePayLevel(payLevel);
  if (!level) return null;
  const provider = String(sale?.isp || '').trim();
  const product = String(sale?.internet_product || '').trim();
  const speed = Math.max(0, Math.round(Number(sale?.internet_speed_mbps || 0)));

  if (provider === 'Quantum') return numeric(rule?.quantum?.[level]);
  if (provider === 'Brightspeed') {
    const tier = speed >= 2000 ? '2_gig' : speed >= 1000 ? '1_gig' : 'below_1_gig';
    return numeric(rule?.brightspeed?.[tier]?.[level]);
  }
  if (provider === 'AT&T') {
    if (product === 'Internet Air') return numeric(rule?.att?.internet_air);
    if (product === 'Fiber') {
      const tier = speed >= 1000 ? 'fiber_1_gig' : 'fiber_below_1_gig';
      return numeric(rule?.att?.[tier]?.[level]);
    }
  }
  return null;
}

export function attMobileCommission(rule, lineCount) {
  const lines = Math.max(0, Math.min(20, Math.round(Number(lineCount || 0))));
  if (!lines) return 0;
  const first = Number(rule?.att?.mobile_first_line || 0);
  const additional = Number(rule?.att?.mobile_additional_line || 0);
  return first + Math.max(0, lines - 1) * additional;
}

export function weeklyProductionTier(rule, saleCount) {
  const count = Math.max(0, Math.round(Number(saleCount || 0)));
  const tiers = Array.isArray(rule?.weekly_production_pay_increase)
    ? rule.weekly_production_pay_increase
        .map(tier => ({
          min_sales: Math.max(0, Math.round(Number(tier?.min_sales || 0))),
          max_sales: tier?.max_sales == null ? null : Math.max(0, Math.round(Number(tier.max_sales))),
          increase_per_sale: Math.max(0, Number(tier?.increase_per_sale || 0))
        }))
        .filter(tier => tier.min_sales > 0)
        .sort((left, right) => left.min_sales - right.min_sales)
    : [];
  let current = null;
  let next = null;
  for (const tier of tiers) {
    if (count >= tier.min_sales) current = tier;
    else if (!next) next = tier;
  }
  return { tiers, current, next };
}

export function commissionSnapshot(rule, sale, payLevel) {
  const level = normalizePayLevel(payLevel);
  const lines = Math.max(0, Math.min(20, Math.round(Number(sale?.mobile_phone_lines ?? sale?.att_mobile_lines ?? 0))));
  return {
    pay_level: level,
    pay_level_label: payLevelLabel(level),
    base_commission: baseCommissionForSale(rule, sale, level),
    att_mobile_originating_commission: attMobileCommission(rule, lines),
    mobile_phone_lines: lines
  };
}
