-- Tenant-scope Field Coach telemetry sessions and native background location.
alter table public.test_sessions add column if not exists organization_id uuid references public.organizations(id);
alter table public.test_events add column if not exists organization_id uuid references public.organizations(id);
alter table public.field_analytics_results add column if not exists organization_id uuid references public.organizations(id);
alter table public.field_session_auto_closures add column if not exists organization_id uuid references public.organizations(id);

update public.test_sessions set organization_id=private.mccoy_organization_id() where organization_id is null;
update public.test_events e set organization_id=s.organization_id from public.test_sessions s where e.session_id=s.id and e.organization_id is null;
update public.field_analytics_results r set organization_id=s.organization_id from public.test_sessions s where r.session_id=s.id and r.organization_id is null;
update public.field_session_auto_closures c set organization_id=s.organization_id from public.test_sessions s where c.session_id=s.id and c.organization_id is null;

alter table public.test_sessions alter column organization_id set default coalesce(private.current_organization_id(),private.mccoy_organization_id()), alter column organization_id set not null;
alter table public.test_events alter column organization_id set default coalesce(private.current_organization_id(),private.mccoy_organization_id()), alter column organization_id set not null;
alter table public.field_analytics_results alter column organization_id set default coalesce(private.current_organization_id(),private.mccoy_organization_id()), alter column organization_id set not null;
alter table public.field_session_auto_closures alter column organization_id set default coalesce(private.current_organization_id(),private.mccoy_organization_id()), alter column organization_id set not null;

do $$
declare t text;
begin
  foreach t in array array['app_user_access','users','teams','territories','leads','field_sessions','door_visits','door_activities','location_events','field_area_assignments','native_location_sessions','sales_records','sales_feed','provider_sale_captures','provider_sales_imports','provider_sales_rows'] loop
    execute format('alter table public.%I alter column organization_id set default coalesce(private.current_organization_id(),private.mccoy_organization_id())',t);
  end loop;
end $$;

create index if not exists test_sessions_org_idx on public.test_sessions(organization_id);
create index if not exists test_events_org_idx on public.test_events(organization_id);
create index if not exists field_analytics_results_org_idx on public.field_analytics_results(organization_id);
create index if not exists field_session_auto_closures_org_idx on public.field_session_auto_closures(organization_id);

drop policy if exists test_sessions_insert_only on public.test_sessions;
drop policy if exists test_events_insert_only on public.test_events;
drop policy if exists "authenticated insert own test session" on public.test_sessions;
create policy "authenticated insert own test session" on public.test_sessions for insert to authenticated with check (organization_id=private.current_organization_id() and tester_user_id=auth.uid() and lower(tester_email)=lower(coalesce(auth.jwt()->>'email','')) and exists(select 1 from public.app_user_access a where a.organization_id=test_sessions.organization_id and lower(a.email)=lower(coalesce(auth.jwt()->>'email','')) and a.active));
drop policy if exists "authenticated read own or admin sessions" on public.test_sessions;
create policy "authenticated read own or admin sessions" on public.test_sessions for select to authenticated using (organization_id=private.current_organization_id() and (tester_user_id=auth.uid() or is_mccoy_admin()));
drop policy if exists "authenticated update own session" on public.test_sessions;
create policy "authenticated update own session" on public.test_sessions for update to authenticated using (organization_id=private.current_organization_id() and tester_user_id=auth.uid()) with check (organization_id=private.current_organization_id() and tester_user_id=auth.uid());

drop policy if exists "authenticated insert own events" on public.test_events;
create policy "authenticated insert own events" on public.test_events for insert to authenticated with check (organization_id=private.current_organization_id() and exists(select 1 from public.test_sessions s where s.id=test_events.session_id and s.organization_id=test_events.organization_id and s.tester_user_id=auth.uid()));
drop policy if exists "authenticated read own or admin events" on public.test_events;
create policy "authenticated read own or admin events" on public.test_events for select to authenticated using (organization_id=private.current_organization_id() and exists(select 1 from public.test_sessions s where s.id=test_events.session_id and s.organization_id=test_events.organization_id and (s.tester_user_id=auth.uid() or is_mccoy_admin())));

create or replace function public.register_native_location_token(p_session_id uuid,p_token text)
returns jsonb language plpgsql security definer set search_path to 'pg_catalog','public'
as $function$
declare v_uid uuid:=auth.uid(); v_org uuid:=private.current_organization_id();
begin
  if v_uid is null or v_org is null then raise exception 'authentication_required' using errcode='42501'; end if;
  if p_token is null or length(p_token)<32 then raise exception 'strong_token_required' using errcode='22023'; end if;
  if not exists(select 1 from public.test_sessions where id=p_session_id and organization_id=v_org and tester_user_id=v_uid and ended_at is null) then raise exception 'open_owned_session_required' using errcode='42501'; end if;
  insert into public.native_location_sessions(session_id,user_id,token_sha256,active,created_at,revoked_at,organization_id)
  values(p_session_id,v_uid,encode(digest(p_token,'sha256'),'hex'),true,clock_timestamp(),null,v_org)
  on conflict(session_id) do update set user_id=excluded.user_id,token_sha256=excluded.token_sha256,active=true,created_at=clock_timestamp(),revoked_at=null,organization_id=excluded.organization_id;
  return jsonb_build_object('ok',true,'session_id',p_session_id,'organization_id',v_org);
end;$function$;

create or replace function public.revoke_native_location_token(p_session_id uuid)
returns jsonb language plpgsql security definer set search_path to 'pg_catalog','public'
as $function$
declare v_uid uuid:=auth.uid(); v_org uuid:=private.current_organization_id();
begin
  if v_uid is null or v_org is null then raise exception 'authentication_required' using errcode='42501'; end if;
  update public.native_location_sessions n set active=false,revoked_at=clock_timestamp() where n.session_id=p_session_id and n.user_id=v_uid and n.organization_id=v_org;
  return jsonb_build_object('ok',true,'session_id',p_session_id);
end;$function$;

alter table public.test_sessions drop constraint if exists test_sessions_id_organization_key;
alter table public.test_sessions add constraint test_sessions_id_organization_key unique(id,organization_id);
alter table public.door_visits drop constraint if exists door_visits_session_org_fkey;
alter table public.door_visits add constraint door_visits_session_org_fkey foreign key(session_id,organization_id) references public.test_sessions(id,organization_id) not valid;
alter table public.native_location_sessions drop constraint if exists native_location_sessions_session_org_fkey;
alter table public.native_location_sessions add constraint native_location_sessions_session_org_fkey foreign key(session_id,organization_id) references public.test_sessions(id,organization_id) not valid;
alter table public.sales_records drop constraint if exists sales_records_session_org_fkey;
alter table public.sales_records add constraint sales_records_session_org_fkey foreign key(session_id,organization_id) references public.test_sessions(id,organization_id) not valid;
alter table public.test_events drop constraint if exists test_events_session_org_fkey;
alter table public.test_events add constraint test_events_session_org_fkey foreign key(session_id,organization_id) references public.test_sessions(id,organization_id) not valid;
alter table public.field_analytics_results drop constraint if exists field_analytics_results_session_org_fkey;
alter table public.field_analytics_results add constraint field_analytics_results_session_org_fkey foreign key(session_id,organization_id) references public.test_sessions(id,organization_id) not valid;
alter table public.field_session_auto_closures drop constraint if exists field_session_auto_closures_session_org_fkey;
alter table public.field_session_auto_closures add constraint field_session_auto_closures_session_org_fkey foreign key(session_id,organization_id) references public.test_sessions(id,organization_id) not valid;

alter table public.door_visits validate constraint door_visits_session_org_fkey;
alter table public.native_location_sessions validate constraint native_location_sessions_session_org_fkey;
alter table public.sales_records validate constraint sales_records_session_org_fkey;
alter table public.test_events validate constraint test_events_session_org_fkey;
alter table public.field_analytics_results validate constraint field_analytics_results_session_org_fkey;
alter table public.field_session_auto_closures validate constraint field_session_auto_closures_session_org_fkey;
