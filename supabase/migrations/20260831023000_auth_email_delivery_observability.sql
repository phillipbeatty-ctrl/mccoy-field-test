-- Production authentication email delivery state and audit trail.
-- This migration stores no SMTP credentials. Secrets remain in Supabase/GitHub secret stores.

create table if not exists public.auth_email_provider_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  provider text not null default 'unconfigured',
  sender_email text,
  sender_name text,
  site_url text not null default 'https://mccoy-field-test.vercel.app',
  confirmation_redirect_url text not null default 'https://mccoy-field-test.vercel.app/confirm-email.html',
  custom_smtp_active boolean not null default false,
  delivery_webhook_active boolean not null default false,
  provider_webhook_id text,
  provider_domain text,
  custom_smtp_activated_at timestamptz,
  webhook_configured_at timestamptz,
  last_verified_at timestamptz,
  verification_detail text,
  updated_at timestamptz not null default now(),
  constraint auth_email_provider_settings_sender_email_check
    check (sender_email is null or sender_email = lower(btrim(sender_email))),
  constraint auth_email_provider_settings_site_url_check
    check (site_url ~ '^https://'),
  constraint auth_email_provider_settings_redirect_url_check
    check (confirmation_redirect_url ~ '^https://')
);

create table if not exists public.auth_email_delivery_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  auth_user_id uuid references auth.users(id) on delete set null,
  target_email text not null,
  event_type text not null,
  status text not null,
  provider text not null default 'supabase_auth',
  provider_message_id text,
  provider_event_id text,
  requested_by_email text,
  redirect_url text,
  request_source text,
  detail text,
  provider_payload jsonb not null default '{}'::jsonb,
  event_created_at timestamptz not null default now(),
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint auth_email_delivery_events_target_email_check
    check (target_email = lower(btrim(target_email))),
  constraint auth_email_delivery_events_event_type_check
    check (event_type in (
      'confirmation_requested',
      'provider_accepted',
      'sent',
      'delivered',
      'delivery_delayed',
      'bounced',
      'complained',
      'suppressed',
      'failed',
      'opened',
      'clicked',
      'confirmed'
    ))
);

create unique index if not exists auth_email_delivery_events_provider_event_email_uidx
  on public.auth_email_delivery_events(provider_event_id, target_email)
  where provider_event_id is not null;

create index if not exists auth_email_delivery_events_org_email_created_idx
  on public.auth_email_delivery_events(organization_id, target_email, created_at desc);

create index if not exists auth_email_delivery_events_message_idx
  on public.auth_email_delivery_events(provider_message_id)
  where provider_message_id is not null;

create index if not exists auth_email_delivery_events_user_idx
  on public.auth_email_delivery_events(auth_user_id, created_at desc)
  where auth_user_id is not null;

alter table public.auth_email_provider_settings enable row level security;
alter table public.auth_email_delivery_events enable row level security;

revoke all on public.auth_email_provider_settings from anon, authenticated;
revoke all on public.auth_email_delivery_events from anon, authenticated;
grant select, insert, update, delete on public.auth_email_provider_settings to service_role;
grant select, insert, update, delete on public.auth_email_delivery_events to service_role;

insert into public.auth_email_provider_settings (
  organization_id,
  provider,
  site_url,
  confirmation_redirect_url,
  custom_smtp_active,
  delivery_webhook_active,
  verification_detail
)
select
  id,
  'unconfigured',
  'https://mccoy-field-test.vercel.app',
  'https://mccoy-field-test.vercel.app/confirm-email.html',
  false,
  false,
  'Awaiting production SMTP credentials and a verified sending domain.'
from public.organizations
on conflict (organization_id) do nothing;

comment on table public.auth_email_provider_settings is
  'Non-secret production mail readiness state. SMTP credentials remain in managed secret stores.';
comment on table public.auth_email_delivery_events is
  'Auditable Auth email requests and provider delivery events. Provider webhook IDs plus recipients make ingestion idempotent.';
