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
  ['metrics-visibility','analytics'],
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
  ['spotio-import','lead_management']
])

// These endpoints deliberately keep narrower infrastructure, signed-token, or
// tombstone controls. Gating them behind an interactive organization bearer token
// would strand account recovery, reject provider callbacks before signature
// verification, break native background delivery, or change the stable 410
// contract of an intentionally retired operation.
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
  ['lead-map-all-visible','retired_one_time_endpoint_returns_410'],
  ['native-location-ingest','signed_background_location_token'],
  ['organization-access','organization_gate_endpoint'],
  ['spotio-composite-check','retired_verification_endpoint_returns_410'],
  ['spotio-controlled-recovery','retired_recovery_endpoint_returns_410'],
  ['spotio-count-check','retired_verification_endpoint_returns_410'],
  ['spotio-direct-force-load','retired_recovery_endpoint_returns_410'],
  ['spotio-dom-geocode','retired_recovery_endpoint_returns_410'],
  ['spotio-dom-recovery','retired_recovery_endpoint_returns_410'],
  ['spotio-live-verification','retired_verification_endpoint_returns_410'],
  ['spotio-recovery-decode','retired_recovery_endpoint_returns_410'],
  ['spotio-recovery-decrypt','retired_recovery_endpoint_returns_410'],
  ['spotio-recovery-exact','retired_recovery_endpoint_returns_410'],
  ['spotio-recovery-load','retired_recovery_endpoint_returns_410'],
  ['spotio-recovery-prepare','retired_recovery_endpoint_returns_410'],
  ['spotio-recovery-stream','retired_recovery_endpoint_returns_410'],
  ['spotio-recovery-upload','retired_recovery_endpoint_returns_410'],
  ['spotio-unit-check','retired_verification_endpoint_returns_410']
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
