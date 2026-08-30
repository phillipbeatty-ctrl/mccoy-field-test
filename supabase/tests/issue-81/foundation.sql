\set ON_ERROR_STOP on

create extension if not exists pgcrypto;
create schema if not exists private;

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Issue 81 test organization',
  created_at timestamptz not null default clock_timestamp()
);

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  auth_user_id uuid,
  email text,
  role text not null default 'rep',
  active boolean not null default true,
  created_at timestamptz not null default clock_timestamp()
);

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source_system text,
  source_id text,
  provider text,
  provider_lead_id text,
  canonical_identity_key text,
  fallback_identity_key text,
  normalized_address_key text,
  source_stage_id text,
  source_payload jsonb,
  source_first_seen_at timestamptz,
  source_last_seen_at timestamptz,
  source_seen_count integer not null default 1,
  address1 text,
  address2 text,
  city text,
  state text,
  zip text,
  latitude double precision,
  longitude double precision,
  customer_name text,
  phone text,
  current_disposition text not null default 'Uncontacted',
  stage text not null default 'Prospecting',
  pin_color text,
  pin_color_source text,
  assigned_rep_id uuid references public.users(id) on delete set null,
  assigned_manager_id uuid references public.users(id) on delete set null,
  assigned_admin_email text,
  assigned_team_id uuid,
  last_activity_at timestamptz,
  last_activity_type text,
  visit_result text,
  geocode_status text,
  geocode_provider text,
  geocode_precision text,
  geocode_formatted_address text,
  geocode_place_id text,
  geocode_verified_at timestamptz,
  geocode_verification_status text,
  geocode_comparison_distance_meters double precision,
  geocode_candidate_latitude double precision,
  geocode_candidate_longitude double precision,
  geocode_verification_details jsonb,
  geocode_attempted_at timestamptz,
  deleted_at timestamptz,
  duplicate_of_lead_id uuid references public.leads(id) on delete set null,
  deletion_reason text,
  created_at timestamptz not null default clock_timestamp()
);

create unique index if not exists leads_source_system_source_id_uidx
  on public.leads (source_system, source_id)
  where source_system is not null and source_id is not null;
