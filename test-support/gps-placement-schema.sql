-- Disposable test schema based on the inspected production column contract; no customer data.
create schema private;
create role anon;
create role authenticated;
create role service_role bypassrls;
create table public.organizations(id uuid primary key);
create table public.app_config(
  key text not null,
  value text not null,
  updated_at timestamptz default now() not null
);
create table public.app_user_access(
  email text not null,
  role text not null,
  active bool default true not null,
  display_name text,
  created_at timestamptz default now() not null,
  sales_classification text,
  team_name text,
  assigned_manager_name text,
  assigned_manager_email text,
  assigned_admin_email text,
  assigned_admin_name text,
  organization_id uuid not null
);
create table public.door_visits(
  id uuid default gen_random_uuid() not null,
  lead_id uuid,
  rep_id uuid not null,
  session_id uuid not null,
  arrived_at timestamptz default now() not null,
  arrival_latitude float8,
  arrival_longitude float8,
  arrival_accuracy_meters float8,
  disposition_at timestamptz,
  disposition_latitude float8,
  disposition_longitude float8,
  disposition_accuracy_meters float8,
  disposition text,
  dwell_seconds int4,
  arrival_distance_from_lead_meters float8,
  disposition_distance_from_lead_meters float8,
  gps_verified_at_arrival bool,
  gps_verified_at_disposition bool,
  notes text,
  created_at timestamptz default now() not null,
  service_address text,
  selection_source text not null,
  status text default 'active'::text not null,
  visit_outcome text,
  contact_status text,
  auto_disposition bool default false not null,
  auto_reason text,
  manual_override bool default false not null,
  provider_sale_id uuid,
  provider_capture_id uuid,
  cancelled_reason text,
  updated_at timestamptz default clock_timestamp() not null,
  activity_type text,
  visit_result text,
  lead_stage text,
  pin_color text,
  pin_color_source text,
  organization_id uuid not null,
  occurred_at timestamptz default clock_timestamp() not null,
  client_request_id uuid
);
create table public.leads(
  id uuid default gen_random_uuid() not null,
  territory_id uuid,
  source_id text,
  address1 text not null,
  address2 text,
  city text,
  state text,
  zip text,
  latitude float8,
  longitude float8,
  google_place_id text,
  customer_name text,
  phone text,
  provider text,
  service_type text,
  eligibility text,
  current_disposition text default 'uncontacted'::text not null,
  assigned_rep_id uuid,
  attempt_count int4 default 0 not null,
  last_activity_at timestamptz,
  created_at timestamptz default now() not null,
  assigned_team_id uuid,
  source_system text,
  source_stage_id text,
  source_payload jsonb,
  import_batch_id uuid,
  geocode_status text,
  geocode_attempted_at timestamptz,
  assigned_manager_id uuid,
  assigned_admin_email text,
  last_activity_type text,
  visit_result text,
  stage text default 'Prospecting'::text not null,
  pin_color text default '#fbbf24'::text not null,
  pin_color_source text default 'stage'::text not null,
  deleted_at timestamptz,
  deleted_by_user_id uuid,
  deleted_by_email text,
  deleted_by_role text,
  deletion_reason text,
  duplicate_of_lead_id uuid,
  normalized_address_key text,
  geocode_provider text,
  geocode_precision text,
  geocode_formatted_address text,
  geocode_place_id text,
  geocode_verified_at timestamptz,
  geocode_verification_status text,
  geocode_comparison_distance_meters float8,
  geocode_candidate_latitude float8,
  geocode_candidate_longitude float8,
  geocode_verification_details jsonb default '{}'::jsonb not null,
  geocode_verification_claimed_at timestamptz,
  geocode_verification_claimed_by uuid,
  organization_id uuid not null,
  provider_lead_id text,
  canonical_identity_key text,
  source_first_seen_at timestamptz,
  source_last_seen_at timestamptz,
  source_seen_count int4 default 1 not null,
  source_last_activity_at timestamptz,
  fallback_identity_key text,
  source_record_key text,
  source_stage_label text,
  source_stage_updated_at timestamptz,
  source_updated_at timestamptz,
  source_created_at timestamptz,
  building_identity_key text,
  notes text default ''::text not null,
  contact_updated_at timestamptz,
  contact_updated_by uuid,
  contact_updated_by_email text,
  created_by_user_id uuid,
  created_by_email text,
  pin_location_updated_at timestamptz default clock_timestamp() not null
);
create table public.privacy_acceptances(
  id int8 not null,
  user_id uuid not null,
  email text not null,
  notice_version text not null,
  accepted_at timestamptz default now() not null,
  precise_location_consent bool not null,
  work_activity_analytics_consent bool not null,
  user_agent text,
  ip_note text
);
create table public.users(
  id uuid default gen_random_uuid() not null,
  auth_user_id uuid,
  first_name text,
  last_name text,
  email text,
  role text default 'rep'::text not null,
  team_id uuid,
  active bool default true not null,
  created_at timestamptz default now() not null,
  organization_id uuid not null
);
alter table public.leads add primary key(id);
alter table public.users add primary key(id);
alter table public.app_user_access add primary key(email);
alter table public.app_config add primary key(key);
alter table public.door_visits add primary key(id);
grant select,insert,update on all tables in schema public to service_role;
CREATE OR REPLACE FUNCTION private.preserve_stronger_lead_coordinates_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  if old.latitude is not null and old.longitude is not null
     and coalesce(new.geocode_verification_status,'')='approximate_address_review'
     and coalesce(old.geocode_verification_status,'')<>'approximate_address_review' then
    new.latitude:=old.latitude;
    new.longitude:=old.longitude;
    new.geocode_status:=old.geocode_status;
    new.geocode_provider:=old.geocode_provider;
    new.geocode_precision:=old.geocode_precision;
    new.geocode_formatted_address:=old.geocode_formatted_address;
    new.geocode_place_id:=old.geocode_place_id;
    new.geocode_verified_at:=old.geocode_verified_at;
    new.geocode_verification_status:=old.geocode_verification_status;
    new.geocode_comparison_distance_meters:=old.geocode_comparison_distance_meters;
    new.geocode_candidate_latitude:=old.geocode_candidate_latitude;
    new.geocode_candidate_longitude:=old.geocode_candidate_longitude;
    new.geocode_verification_details:=old.geocode_verification_details;
  end if;
  return new;
end;
$function$
;
create trigger preserve_stronger_lead_coordinates before update of latitude,longitude,geocode_verification_status on public.leads for each row execute function private.preserve_stronger_lead_coordinates_v1();
