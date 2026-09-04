export const edgePaywallTargets=new Map([
  ['accounting-records','accounting'],
  ['accounting-sales','accounting'],
  ['admin-session-history','analytics'],
  ['admin-workday','analytics'],
  ['company-leaders','analytics'],
  ['compensation-settings','admin_controls'],
  ['field-analytics','analytics'],
  ['lead-admin','lead_management'],
  ['lead-field-actions','lead_management'],
  ['lead-geocode','lead_management'],
  ['lead-map-address-search','lead_management'],
  ['metrics-visibility','analytics'],
  ['pay-progress','sales_tracking'],
  ['pending-account-access','admin_controls'],
  ['provider-reconcile','provider_integrations'],
  ['provider-sale-capture','sales_tracking'],
  ['rep-coach-summary','analytics'],
  ['rep-onboarding','admin_controls'],
  ['sale-approvals','sales_tracking'],
  ['sale-order-photo','sales_tracking'],
  ['sale-order-photo-pilot','provider_integrations'],
  ['sale-submit','sales_tracking'],
  ['session-control','native_background_location'],
  ['spotio-import','lead_management']
])

// These endpoints deliberately keep their narrower infrastructure or signed-
// webhook controls. Gating them behind organization billing would strand account
// confirmation/recovery or reject provider callbacks before their signatures can
// be verified.
export const edgePaywallExemptions=new Map([
  ['auth-email-confirmed','account_confirmation_infrastructure'],
  ['auth-email-provider-webhook','signed_provider_webhook'],
  ['auth-email-resend','enumeration_safe_account_recovery'],
  ['auth-email-status','enumeration_safe_account_recovery'],
  ['organization-access','organization_gate_endpoint']
])

export const fieldCoachEntitlements=Object.freeze([
  'accounting',
  'admin_controls',
  'analytics',
  'field_coach_access',
  'lead_management',
  'native_background_location',
  'provider_integrations',
  'rankings',
  'sales_tracking'
])
