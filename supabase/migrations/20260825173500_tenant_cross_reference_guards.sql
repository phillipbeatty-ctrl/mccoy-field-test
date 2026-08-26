create or replace function private.enforce_same_organization_references()
returns trigger language plpgsql security definer set search_path=pg_catalog,public
as $function$
declare
  v_org uuid;
  v_ref_text text;
  v_ref_id uuid;
  v_ref_org uuid;
  i integer;
begin
  v_org := nullif(to_jsonb(new)->>'organization_id','')::uuid;
  if v_org is null then raise exception 'organization_id_required' using errcode='23514'; end if;
  if mod(tg_nargs,2)<>0 then raise exception 'tenant_guard_configuration_error'; end if;
  i:=0;
  while i<tg_nargs loop
    v_ref_text:=to_jsonb(new)->>tg_argv[i];
    if v_ref_text is not null and btrim(v_ref_text)<>'' then
      v_ref_id:=v_ref_text::uuid;
      execute format('select organization_id from public.%I where id=$1',tg_argv[i+1]) into v_ref_org using v_ref_id;
      if found and v_ref_org is distinct from v_org then
        raise exception 'cross_organization_reference_blocked: %.% -> %',tg_table_name,tg_argv[i],tg_argv[i+1] using errcode='23514';
      end if;
    end if;
    i:=i+2;
  end loop;
  return new;
end;$function$;
revoke all on function private.enforce_same_organization_references() from public;

create or replace function private.enforce_auth_user_organization_membership()
returns trigger language plpgsql security definer set search_path=pg_catalog,public
as $function$
declare
  v_org uuid;
  v_user_text text;
  v_user uuid;
  i integer;
begin
  v_org:=nullif(to_jsonb(new)->>'organization_id','')::uuid;
  if v_org is null then raise exception 'organization_id_required' using errcode='23514'; end if;
  i:=0;
  while i<tg_nargs loop
    v_user_text:=to_jsonb(new)->>tg_argv[i];
    if v_user_text is not null and btrim(v_user_text)<>'' then
      v_user:=v_user_text::uuid;
      if not exists(select 1 from public.organization_memberships m where m.organization_id=v_org and m.auth_user_id=v_user) then
        raise exception 'auth_user_not_member_of_organization: %.%',tg_table_name,tg_argv[i] using errcode='23514';
      end if;
    end if;
    i:=i+1;
  end loop;
  return new;
end;$function$;
revoke all on function private.enforce_auth_user_organization_membership() from public;

drop trigger if exists tenant_guard_users on public.users;
create trigger tenant_guard_users before insert or update of organization_id,team_id on public.users for each row execute function private.enforce_same_organization_references('team_id','teams');
drop trigger if exists tenant_guard_teams on public.teams;
create trigger tenant_guard_teams before insert or update of organization_id,manager_user_id on public.teams for each row execute function private.enforce_same_organization_references('manager_user_id','users');
drop trigger if exists tenant_guard_territories on public.territories;
create trigger tenant_guard_territories before insert or update of organization_id,assigned_team_id on public.territories for each row execute function private.enforce_same_organization_references('assigned_team_id','teams');
drop trigger if exists tenant_guard_leads on public.leads;
create trigger tenant_guard_leads before insert or update of organization_id,territory_id,assigned_team_id,assigned_rep_id,assigned_manager_id,duplicate_of_lead_id on public.leads for each row execute function private.enforce_same_organization_references('territory_id','territories','assigned_team_id','teams','assigned_rep_id','users','assigned_manager_id','users','duplicate_of_lead_id','leads');
drop trigger if exists tenant_guard_field_sessions on public.field_sessions;
create trigger tenant_guard_field_sessions before insert or update of organization_id,rep_id,territory_id on public.field_sessions for each row execute function private.enforce_same_organization_references('rep_id','users','territory_id','territories');
drop trigger if exists tenant_guard_door_activities on public.door_activities;
create trigger tenant_guard_door_activities before insert or update of organization_id,lead_id,rep_id,session_id on public.door_activities for each row execute function private.enforce_same_organization_references('lead_id','leads','rep_id','users','session_id','field_sessions');
drop trigger if exists tenant_guard_location_events on public.location_events;
create trigger tenant_guard_location_events before insert or update of organization_id,lead_id,door_visit_id,rep_id,session_id on public.location_events for each row execute function private.enforce_same_organization_references('lead_id','leads','door_visit_id','door_visits','rep_id','users','session_id','field_sessions');
drop trigger if exists tenant_guard_door_visits on public.door_visits;
create trigger tenant_guard_door_visits before insert or update of organization_id,lead_id,rep_id,provider_capture_id,provider_sale_id,session_id on public.door_visits for each row execute function private.enforce_same_organization_references('lead_id','leads','rep_id','users','provider_capture_id','provider_sale_captures','provider_sale_id','sales_records','session_id','test_sessions');
drop trigger if exists tenant_guard_native_location_sessions on public.native_location_sessions;
create trigger tenant_guard_native_location_sessions before insert or update of organization_id,session_id on public.native_location_sessions for each row execute function private.enforce_same_organization_references('session_id','test_sessions');
drop trigger if exists tenant_guard_sales_records on public.sales_records;
create trigger tenant_guard_sales_records before insert or update of organization_id,distance_lead_id,provider_capture_id,session_id on public.sales_records for each row execute function private.enforce_same_organization_references('distance_lead_id','leads','provider_capture_id','provider_sale_captures','session_id','test_sessions');
drop trigger if exists tenant_guard_sales_feed on public.sales_feed;
create trigger tenant_guard_sales_feed before insert or update of organization_id,sale_id on public.sales_feed for each row execute function private.enforce_same_organization_references('sale_id','sales_records');
drop trigger if exists tenant_guard_provider_sales_rows on public.provider_sales_rows;
create trigger tenant_guard_provider_sales_rows before insert or update of organization_id,import_id,cross_referenced_row_id,materialized_sale_id on public.provider_sales_rows for each row execute function private.enforce_same_organization_references('import_id','provider_sales_imports','cross_referenced_row_id','provider_sales_rows','materialized_sale_id','sales_records');
drop trigger if exists tenant_guard_test_events on public.test_events;
create trigger tenant_guard_test_events before insert or update of organization_id,session_id on public.test_events for each row execute function private.enforce_same_organization_references('session_id','test_sessions');
drop trigger if exists tenant_guard_field_analytics_results on public.field_analytics_results;
create trigger tenant_guard_field_analytics_results before insert or update of organization_id,session_id on public.field_analytics_results for each row execute function private.enforce_same_organization_references('session_id','test_sessions');
drop trigger if exists tenant_guard_field_session_auto_closures on public.field_session_auto_closures;
create trigger tenant_guard_field_session_auto_closures before insert or update of organization_id,session_id on public.field_session_auto_closures for each row execute function private.enforce_same_organization_references('session_id','test_sessions');

drop trigger if exists tenant_member_guard_test_sessions on public.test_sessions;
create trigger tenant_member_guard_test_sessions before insert or update of organization_id,tester_user_id on public.test_sessions for each row execute function private.enforce_auth_user_organization_membership('tester_user_id');
drop trigger if exists tenant_member_guard_native_location_sessions on public.native_location_sessions;
create trigger tenant_member_guard_native_location_sessions before insert or update of organization_id,user_id on public.native_location_sessions for each row execute function private.enforce_auth_user_organization_membership('user_id');
drop trigger if exists tenant_member_guard_field_area_assignments on public.field_area_assignments;
create trigger tenant_member_guard_field_area_assignments before insert or update of organization_id,user_id on public.field_area_assignments for each row execute function private.enforce_auth_user_organization_membership('user_id');
drop trigger if exists tenant_member_guard_sales_records on public.sales_records;
create trigger tenant_member_guard_sales_records before insert or update of organization_id,rep_user_id on public.sales_records for each row execute function private.enforce_auth_user_organization_membership('rep_user_id');
drop trigger if exists tenant_member_guard_sales_feed on public.sales_feed;
create trigger tenant_member_guard_sales_feed before insert or update of organization_id,rep_user_id on public.sales_feed for each row execute function private.enforce_auth_user_organization_membership('rep_user_id');
drop trigger if exists tenant_member_guard_provider_sale_captures on public.provider_sale_captures;
create trigger tenant_member_guard_provider_sale_captures before insert or update of organization_id,rep_user_id on public.provider_sale_captures for each row execute function private.enforce_auth_user_organization_membership('rep_user_id');
drop trigger if exists tenant_member_guard_provider_sales_imports on public.provider_sales_imports;
create trigger tenant_member_guard_provider_sales_imports before insert or update of organization_id,imported_by,source_rep_user_id on public.provider_sales_imports for each row execute function private.enforce_auth_user_organization_membership('imported_by','source_rep_user_id');
drop trigger if exists tenant_member_guard_provider_sales_rows on public.provider_sales_rows;
create trigger tenant_member_guard_provider_sales_rows before insert or update of organization_id,source_rep_user_id on public.provider_sales_rows for each row execute function private.enforce_auth_user_organization_membership('source_rep_user_id');
