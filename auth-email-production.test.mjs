import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';

const read=path=>readFile(new URL(path,import.meta.url),'utf8');
const migration=await read('./supabase/migrations/20260831023000_auth_email_delivery_observability.sql');
const pendingFunction=await read('./supabase/functions/pending-account-access/index.ts');
const publicResend=await read('./supabase/functions/auth-email-resend/index.ts');
const webhook=await read('./supabase/functions/auth-email-provider-webhook/index.ts');
const status=await read('./supabase/functions/auth-email-status/index.ts');
const confirmed=await read('./supabase/functions/auth-email-confirmed/index.ts');
const signup=await read('./app-auth-production-redirect.js');
const confirmPage=await read('./confirm-email.html');
const confirmController=await read('./confirm-email.js');
const pendingPage=await read('./pending-access.html');
const pendingController=await read('./pending-access.js');
const activator=await read('./scripts/configure-production-auth-email.mjs');
const workflow=await read('./.github/workflows/configure-production-auth-email.yml');


test('delivery state is private, RLS protected, and provider events are recipient-idempotent',()=>{
  assert.match(migration,/create table if not exists public\.auth_email_provider_settings/);
  assert.match(migration,/create table if not exists public\.auth_email_delivery_events/);
  assert.match(migration,/enable row level security/);
  assert.match(migration,/revoke all .* from anon, authenticated/s);
  assert.match(migration,/provider_event_id, target_email/);
});

test('Admin resend requires production SMTP and records rate-limited audit events',()=>{
  assert.match(pendingFunction,/action==='resend_confirmation'/);
  assert.match(pendingFunction,/production_smtp_not_active/);
  assert.match(pendingFunction,/confirmation_resend_hourly_limit/);
  assert.match(pendingFunction,/event_type:'confirmation_requested'/);
  assert.match(pendingFunction,/delivery_webhook_active/);
});

test('public resend is enumeration-safe and audited',()=>{
  assert.match(publicResend,/If this address has an unconfirmed McCoy account/);
  assert.match(publicResend,/production_smtp_not_active/);
  assert.match(publicResend,/event_type:'confirmation_requested'/);
  assert.match(publicResend,/public_confirmation_page/);
  assert.doesNotMatch(publicResend,/return json\(\{.*user_not_found/s);
});

test('provider webhook verifies Standard Webhooks signatures and deduplicates events',()=>{
  assert.match(webhook,/MCCOY_EMAIL_WEBHOOK_SECRET/);
  assert.match(webhook,/crypto\.subtle\.sign/);
  assert.match(webhook,/svix-id/);
  assert.match(webhook,/stale_webhook_timestamp/);
  assert.match(webhook,/provider_event_id/);
  assert.match(webhook,/email\.delivered/);
  assert.match(webhook,/email\.bounced/);
});

test('confirmation page requires a user action, isolates Auth state, and never redirects itself',()=>{
  assert.match(confirmPage,/CONFIRM EMAIL ADDRESS/);
  assert.match(confirmPage,/The token is not consumed merely by opening this page/);
  assert.match(confirmPage,/confirmEmailContinuePanel/);
  assert.match(confirmPage,/This page will not redirect or refresh automatically/);
  assert.match(confirmPage,/confirm-email\.js\?v=2026083104/);
  assert.match(confirmController,/confirmLinkButton\.addEventListener\('click',confirmTokenHash\)/);
  assert.match(confirmController,/verifyOtp\(\{token_hash:tokenHash/);
  assert.match(confirmController,/verifyOtp\(\{email,token,type:'signup'\}/);
  assert.match(confirmController,/auth-email-resend/);
  assert.match(confirmController,/persistSession:false/);
  assert.match(confirmController,/autoRefreshToken:false/);
  assert.match(confirmController,/detectSessionInUrl:false/);
  assert.match(confirmController,/mccoy-confirm-email-isolated-v1/);
  assert.match(confirmController,/confirmContinueLink\.href=next/);
  assert.doesNotMatch(confirmController,/auth\.getSession\(/);
  assert.doesNotMatch(confirmController,/setTimeout\(/);
  assert.doesNotMatch(confirmController,/location\.(href|replace|reload)/);
  assert.match(confirmed,/email_not_confirmed/);
});

test('signup fails closed until public production-mail readiness is true',()=>{
  assert.match(signup,/auth-email-status/);
  assert.match(signup,/production_ready===true/);
  assert.match(signup,/Account creation is temporarily paused/);
  assert.match(signup,/emailRedirectTo:PROD_CONFIRM/);
  assert.match(status,/fully_observable/);
});

test('Pending Account Access shows provider readiness without unattended refreshes',()=>{
  assert.match(pendingPage,/pendingMailStatus/);
  assert.match(pendingPage,/pending-access\.js\?v=2026083104/);
  assert.match(pendingController,/RESEND CONFIRMATION/);
  assert.match(pendingController,/pendingDeliveryLabel/);
  assert.match(pendingController,/production_ready/);
  assert.match(pendingController,/pendingLoadPromise/);
  assert.match(pendingController,/pendingRefresh.*addEventListener\('click'/s);
  assert.doesNotMatch(pendingController,/setInterval\(/);
  assert.doesNotMatch(pendingController,/addEventListener\('focus'/);
  assert.doesNotMatch(pendingController,/visibilitychange/);
});

test('activation workflow enforces verified domain, DMARC, production redirects, and secret separation',()=>{
  assert.match(activator,/smtp\.resend\.com/);
  assert.match(activator,/smtp_port:'465'/);
  assert.doesNotMatch(activator,/smtp_port:465/);
  assert.match(activator,/Supabase SMTP port verification failed after activation/);
  assert.match(activator,/uri_allow_list/);
  assert.match(activator,/mailer_autoconfirm:false/);
  assert.match(activator,/mailer_templates_confirmation_content/);
  assert.match(activator,/No DMARC TXT record/);
  assert.match(activator,/domain.*verified/is);
  assert.match(activator,/fresh_confirmations_requested/);
  assert.match(workflow,/SUPABASE_ACCESS_TOKEN/);
  assert.match(workflow,/SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(workflow,/RESEND_API_KEY/);
  assert.match(workflow,/MCCOY_AUTH_FROM_EMAIL/);
  assert.match(workflow,/--env-file/);
  assert.doesNotMatch(activator,/console\.log\([^\n]*RESEND_API_KEY/);
});
