
create role anon;
create role authenticated;
create role service_role bypassrls;
create schema auth;
create schema private;
create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create table auth.users(id uuid primary key,email text unique);
create table public.organizations(id uuid primary key);
create table public.app_user_access(email text primary key,display_name text,role text,active boolean,organization_id uuid,assigned_manager_email text,team_name text);
create table public.users(id uuid primary key,auth_user_id uuid unique,email text,active boolean,organization_id uuid);
create table public.sph_rep_settings(user_id uuid primary key references auth.users(id),home_label text check(char_length(home_label) between 1 and 200),home_latitude double precision,home_longitude double precision,home_accuracy_meters double precision,updated_at timestamptz default clock_timestamp(),workday_timezone text not null default 'America/Los_Angeles');
create table public.sph_home_setting_audit(id bigint generated always as identity primary key,user_id uuid references auth.users(id),changed_by uuid references auth.users(id),changed_at timestamptz default clock_timestamp(),action text check(action in ('home_location_updated','home_location_cleared')));
create table public.sph_presence_events(id bigint generated always as identity primary key,rep_user_id uuid references auth.users(id),event_at timestamptz default clock_timestamp(),latitude double precision,longitude double precision,accuracy_meters double precision,event_type text,inside_area boolean,distance_outside_area_m double precision,distance_home_m double precision,area_basis text);
create table public.test_sessions(id uuid primary key,tester_user_id uuid,organization_id uuid,started_at timestamptz,ended_at timestamptz);
create table public.test_events(id bigint generated always as identity primary key,session_id uuid,event_time timestamptz,event_type text,latitude double precision,longitude double precision,accuracy_meters double precision);
create table public.field_session_auto_closures(session_id uuid primary key,last_activity_at timestamptz,closed_at timestamptz,reason text);
create function public.set_sph_home_location(text,double precision,double precision,double precision) returns jsonb language sql as $$select '{}'::jsonb$$;
create function private.mccoy_distance_meters(a double precision,b double precision,c double precision,d double precision) returns double precision language sql immutable strict as $$
 select 6371000*2*asin(least(1,sqrt(power(sin(radians(c-a)/2),2)+cos(radians(a))*cos(radians(c))*power(sin(radians(d-b)/2),2))));
$$;
