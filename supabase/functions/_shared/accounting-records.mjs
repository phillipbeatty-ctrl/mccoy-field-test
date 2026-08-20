import { weeklyProductionTier } from './compensation-calculator.mjs';

export const ACCOUNTING_COLUMNS = Object.freeze([
  'id','order_date','install_date','session_id','rep_user_id','rep_name','rep_email','lead_label',
  'customer_first_name','customer_last_name','customer_phone','customer_email','service_address',
  'isp','internet_product','internet_speed_mbps','directv','directv_service',
  'mobile_phone_lines','mobile_device_count','mobile_device_protection','att_mobile_lines',
  'att_device_count','att_device_protection','att_total_home_care','voip_home_phone_lines',
  'vivint','vivint_service','provider_order_number','provider_account_number',
  'verification_status','verification_reason','provider_sale_row_id','sale_status','competition_eligible','verified_at',
  'low_potential_since','notes','commission_pay_level','base_commission',
  'att_mobile_originating_commission','weekly_production_increase_per_sale','current_earned_pay',
  'cancellation_reduction','pay_status','compensation_rule_source','compensation_snapshot'
]);

function approvalAllows(snapshot) {
  const outside = snapshot?.sale_origin === 'outside_system' || snapshot?.sale_context === 'out_of_area_phone';
  return !outside || String(snapshot?.admin_approval?.status || '').toLowerCase() === 'approved';
}

export function isPayEligible(sale) {
  return sale?.verification_status === 'verified_processed' &&
    sale?.competition_eligible === true &&
    sale?.sale_status !== 'cancelled' &&
    approvalAllows(sale?.compensation_snapshot || {});
}

export function startOfWeekPacific(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short'
  }).formatToParts(date);
  const get = type => parts.find(part => part.type === type)?.value || '';
  const dayIndex = {Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6}[get('weekday')];
  const noonUtc = new Date(Date.UTC(Number(get('year')), Number(get('month')) - 1, Number(get('day')), 12));
  noonUtc.setUTCDate(noonUtc.getUTCDate() - ((dayIndex + 6) % 7));
  const monday = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(noonUtc);
  return monday;
}

function needsInternetBase(sale) {
  return sale?.isp === 'Quantum' || sale?.isp === 'Brightspeed' ||
    (sale?.isp === 'AT&T' && ['Fiber', 'Internet Air'].includes(String(sale?.internet_product || '')));
}

export function annotateEarnedPay(records, rule) {
  const counts = new Map();
  for (const sale of records || []) {
    if (!isPayEligible(sale)) continue;
    const key = `${sale.rep_user_id}|${startOfWeekPacific(sale.created_at)}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const increases = new Map();
  for (const [key, count] of counts) {
    increases.set(key, Number(weeklyProductionTier(rule, count).current?.increase_per_sale || 0));
  }
  return (records || []).map(sale => {
    const snapshot = sale.compensation_snapshot || {};
    const base = snapshot.base_commission == null ? null : Number(snapshot.base_commission);
    const mobile = Number(snapshot.att_mobile_originating_commission || 0);
    const priced = (!needsInternetBase(sale) || (base != null && Number.isFinite(base))) && Number.isFinite(mobile);
    const eligible = isPayEligible(sale);
    const key = `${sale.rep_user_id}|${startOfWeekPacific(sale.created_at)}`;
    const increase = eligible ? Number(increases.get(key) || 0) : 0;
    const scheduled = (base != null && Number.isFinite(base) ? base : 0) + (Number.isFinite(mobile) ? mobile : 0);
    const cancelled = sale.sale_status === 'cancelled';
    let payStatus = 'not_eligible';
    if (cancelled) payStatus = 'cancelled_reduction';
    else if (!eligible) payStatus = String(sale.verification_status || 'pending_verification');
    else if (!priced) payStatus = 'accounting_review_required';
    else payStatus = 'earned';
    return {
      ...sale,
      commission_pay_level: snapshot.pay_level || snapshot.classification || null,
      base_commission: base,
      att_mobile_originating_commission: Number.isFinite(mobile) ? mobile : 0,
      weekly_production_increase_per_sale: increase,
      current_earned_pay: eligible && priced ? scheduled + increase : 0,
      cancellation_reduction: cancelled ? Number(snapshot?.cancellation?.reduction_amount ?? scheduled) || 0 : 0,
      pay_status: payStatus,
      compensation_rule_source: snapshot.source || null
    };
  });
}

function auditValue(row, column) {
  if (column === 'order_date') return row.created_at;
  return row[column];
}

export function csvCell(value) {
  let text = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (/^[\t\r\n ]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function buildAccountingCsv(records) {
  return [
    ACCOUNTING_COLUMNS.join(','),
    ...(records || []).map(row => ACCOUNTING_COLUMNS.map(column => csvCell(auditValue(row, column))).join(','))
  ].join('\n');
}

export function isCancelledProviderStatus(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return new Set([
    'cancelled','canceled','void','voided','chargeback','charged_back','disconnected','disconnect',
    'rescinded','reversed','returned','failed_install','install_cancelled','install_canceled'
  ]).has(normalized);
}
