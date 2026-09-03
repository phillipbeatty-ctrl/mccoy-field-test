export const edgePaywallTargets=new Map([
  ['accounting-records','accounting'],
  ['accounting-sales','accounting'],
  ['admin-session-history','analytics'],
  ['company-leaders','analytics'],
  ['compensation-settings','admin_controls'],
  ['field-analytics','analytics'],
  ['lead-address-lookup','lead_management'],
  ['lead-admin','lead_management'],
  ['lead-field-actions','lead_management'],
  ['lead-geocode','lead_management'],
  ['lead-map-address-search','lead_management'],
  ['lead-map-all-visible','lead_management'],
  ['metrics-visibility','analytics'],
  ['native-location-ingest','native_background_location'],
  ['pay-progress','sales_tracking'],
  ['pending-account-access','admin_controls'],
  ['provider-reconcile','provider_integrations'],
  ['provider-sale-capture','sales_tracking'],
  ['provider-sale-photo-stage','provider_integrations'],
  ['rep-coach-summary','analytics'],
  ['rep-onboarding','admin_controls'],
  ['sale-approvals','sales_tracking'],
  ['sale-order-photo','sales_tracking'],
  ['sale-order-photo-pilot','provider_integrations'],
  ['sale-submit','sales_tracking'],
  ['session-control','native_background_location'],
  ['spotio-admin','provider_integrations'],
  ['spotio-composite-check','lead_management'],
  ['spotio-controlled-recovery','lead_management'],
  ['spotio-count-check','lead_management'],
  ['spotio-direct-force-load','lead_management'],
  ['spotio-dom-geocode','lead_management'],
  ['spotio-dom-recovery','lead_management'],
  ['spotio-import','lead_management'],
  ['spotio-live-verification','lead_management'],
  ['spotio-recovery-decode','lead_management'],
  ['spotio-recovery-decrypt','lead_management'],
  ['spotio-recovery-exact','lead_management'],
  ['spotio-recovery-load','lead_management'],
  ['spotio-recovery-prepare','lead_management'],
  ['spotio-recovery-stream','lead_management'],
  ['spotio-recovery-upload','lead_management'],
  ['spotio-unit-check','lead_management']
])

// These endpoints deliberately keep their narrower infrastructure, tombstone, or
// signed-webhook controls. Gating them behind organization billing would strand
// account confirmation/recovery, reject provider callbacks before signature
// verification, or change the stable 410 contract of a deliberately retired API.
// apple-notes-sync remains a separately signed integration until it can resolve an
// organization from its signed payload without trusting caller-supplied identity.
export const edgePaywallExemptions=new Map([
  ['address-validation-admin-review','retired_endpoint_returns_410_no_business_data'],
  ['address-validation-pilot','retired_endpoint_returns_410_no_business_data'],
  ['address-validation-repair','retired_endpoint_returns_410_no_business_data'],
  ['apple-notes-sync','custom_signed_integration_requires_separate_org_resolution'],
  ['auth-email-confirmed','account_confirmation_infrastructure'],
  ['auth-email-delivery-webhook','signed_provider_webhook'],
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
