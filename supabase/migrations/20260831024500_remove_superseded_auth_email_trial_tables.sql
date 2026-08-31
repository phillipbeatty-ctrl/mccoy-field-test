-- Remove the short-lived trial tables that were superseded by the provider-settings
-- and delivery-events production schema. Safe on fresh environments.

drop table if exists public.auth_email_events;
drop table if exists public.auth_email_delivery_config;
