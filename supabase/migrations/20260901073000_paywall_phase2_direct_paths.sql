begin;

-- Phase 2 closes paths that can bypass browser initialization. Every decision is
-- evaluated from current server-side organization state, so an old JWT cannot
-- preserve access after suspension or entitlement removal.
create or replace function private.assert_current_organization_access(
  p_entitlement text default 'field_coach_access'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private, auth
as $$
declare
  state jsonb;
begin
  if auth.uid() is null then
    raise exception 'authentication_required' using errcode='42501';
  end if;

  state := private.auth_user_organization_access_state(auth.uid(),p_entitlement);
  if coalesce((state->>'access_allowed')::boolean,false) is not true then
    raise exception 'organization_access_denied:%',coalesce(state->>'denial_reason','access_denied')
      using errcode='42501';
  end if;
  return state;
end
$$;

-- PostgreSQL grants EXECUTE to PUBLIC on new functions unless explicitly
-- revoked. Remove that inherited path now and for future migrations.
revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
grant execute on all functions in schema private to service_role;

alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema private revoke execute on functions from public;

-- RLS helper functions must remain callable while evaluating authenticated
-- policies. The generated address expression is also needed for allowed lead
-- inserts and updates.
grant execute on function private.current_app_role() to authenticated;
grant execute on function private.current_app_user_id() to authenticated;
grant execute on function private.current_manager_admin_email() to authenticated;
grant execute on function private.current_organization_id() to authenticated;
grant execute on function private.current_team_id() to authenticated;
grant execute on function private.mccoy_organization_id() to authenticated;
grant execute on function private.organization_access_allowed(uuid,text) to authenticated;
grant execute on function private.mccoy_normalized_lead_address(text,text,text,text,text) to authenticated;
grant execute on function private.assert_current_organization_access(text) to authenticated;

grant execute on function public.current_organization_access_state(text) to authenticated;
grant execute on function public.is_mccoy_admin() to authenticated;
grant execute on function public.record_field_session_heartbeat(uuid) to authenticated;
revoke execute on function public.service_organization_access_state(uuid,text) from public, anon, authenticated;
revoke execute on function public.service_assert_organization_access(uuid,text) from public, anon, authenticated;
grant execute on function public.service_organization_access_state(uuid,text) to service_role;
grant execute on function public.service_assert_organization_access(uuid,text) to service_role;

-- Add a current access assertion to client-callable SECURITY DEFINER RPCs. The
-- original function body, argument defaults, return type, comments, ownership,
-- and behavior are preserved; only the first PL/pgSQL BEGIN receives the gate.
do $phase2_rpc_guards$
declare
  target record;
  function_oid oid;
  definition text;
  patched text;
begin
  for target in
    select * from (values
      ('public.admin_all_sales_feed()','sales_tracking'),
      ('public.admin_apply_sale_credit(uuid,text,text)','sales_tracking'),
      ('public.admin_approve_sale(uuid)','sales_tracking'),
      ('public.admin_approve_sale_credit(uuid,text)','sales_tracking'),
      ('public.admin_assign_any_sale_user(uuid,text)','sales_tracking'),
      ('public.admin_assign_provider_evidence(uuid,text,text)','provider_integrations'),
      ('public.admin_confirmed_sale_provider_candidates()','provider_integrations'),
      ('public.admin_delete_banked_sale(uuid)','sales_tracking'),
      ('public.admin_edit_any_sale(uuid,jsonb)','sales_tracking'),
      ('public.admin_edit_customer_list_sale(uuid,jsonb,text)','sales_tracking'),
      ('public.admin_move_sale_to_bank(uuid)','sales_tracking'),
      ('public.admin_reassign_sale_credit(uuid,text,text)','sales_tracking'),
      ('public.admin_reassign_sale_credit(uuid,uuid,text)','sales_tracking'),
      ('public.admin_record_sale_commission_payment(uuid,numeric)','accounting'),
      ('public.admin_resolve_incomplete_sale_evidence(uuid,text,text,text,text,text,date,date,text)','provider_integrations'),
      ('public.admin_restore_sale_from_bank(uuid)','sales_tracking'),
      ('public.admin_return_sale_to_review(uuid)','sales_tracking'),
      ('public.admin_review_sale_transaction(uuid,text,text,uuid,jsonb)','provider_integrations'),
      ('public.admin_sale_credit_dashboard_page(integer,integer)','sales_tracking'),
      ('public.admin_set_ghost_ranking_goals(integer,integer,integer,integer)','rankings'),
      ('public.admin_set_provider_evidence_disposition(uuid,text,text)','provider_integrations'),
      ('public.admin_set_sale_credit_review_queue(uuid,boolean,text)','sales_tracking'),
      ('public.admin_set_sale_review_disposition(uuid,text,text)','sales_tracking'),
      ('public.admin_unassigned_sales_bank()','sales_tracking'),
      ('public.admin_verify_confirmed_sale_from_provider(uuid,uuid,text)','provider_integrations'),
      ('public.cancel_door_visit(uuid,text)','lead_management'),
      ('public.get_closest_mccoy_lead(double precision,double precision)','lead_management'),
      ('public.get_sph_status()','native_background_location'),
      ('public.get_verified_sales_rankings()','rankings'),
      ('public.my_sales_to_complete()','sales_tracking'),
      ('public.owner_set_secondary_admin(text,boolean)','admin_controls'),
      ('public.record_ad_hoc_door_visit_start(uuid,text,double precision,double precision,double precision,timestamp with time zone)','lead_management'),
      ('public.record_door_visit_completion(uuid,text,double precision,double precision,double precision,timestamp with time zone,boolean,text,uuid,text)','lead_management'),
      ('public.record_door_visit_start(uuid,uuid,text,double precision,double precision,double precision,timestamp with time zone)','lead_management'),
      ('public.record_lead_pool_pin_disposition(uuid,uuid,uuid,text,text,text,timestamp with time zone,integer,double precision,double precision,double precision,timestamp with time zone)','lead_management'),
      ('public.record_sph_presence(text,double precision,double precision,double precision)','native_background_location'),
      ('public.record_spotio_door_visit_completion(uuid,text,text,text,double precision,double precision,double precision,timestamp with time zone,boolean,text)','lead_management'),
      ('public.register_native_location_token(uuid,text)','native_background_location'),
      ('public.resume_door_workflow()','lead_management'),
      ('public.revoke_native_location_token(uuid)','native_background_location'),
      ('public.save_my_sale_details(uuid,jsonb)','sales_tracking'),
      ('public.set_sph_home_location(text,double precision,double precision,double precision)','native_background_location')
    ) as guarded(signature,entitlement)
  loop
    function_oid := to_regprocedure(target.signature);
    if function_oid is null then
      raise exception 'paywall_phase2_missing_rpc:%',target.signature;
    end if;

    definition := pg_get_functiondef(function_oid);
    if definition not ilike '%private.assert_current_organization_access(%' then
      patched := regexp_replace(
        definition,
        E'([\\r\\n][[:space:]]*begin[[:space:]]*[\\r\\n])',
        format(E'\\1  perform private.assert_current_organization_access(%L);\\n',target.entitlement),
        1,
        1,
        'i'
      );
      if patched=definition then
        raise exception 'paywall_phase2_could_not_patch_rpc:%',target.signature;
      end if;
      execute patched;
    end if;

    execute format('revoke execute on function %s from public, anon',target.signature);
    execute format('grant execute on function %s to authenticated, service_role',target.signature);
  end loop;
end
$phase2_rpc_guards$;

-- Direct PostgREST and Realtime reads receive a feature-specific restrictive
-- policy in addition to the existing role/scope and field_coach_access policies.
do $phase2_feature_policies$
declare
  target record;
begin
  for target in
    select * from (values
      ('door_activities','lead_management'),
      ('door_visits','lead_management'),
      ('field_area_assignments','lead_management'),
      ('lead_contact_edit_history','lead_management'),
      ('lead_import_identity_conflicts','lead_management'),
      ('lead_source_aliases','lead_management'),
      ('lead_source_merge_history','lead_management'),
      ('leads','lead_management'),
      ('spotio_import_batches','lead_management'),
      ('spotio_import_results','lead_management'),
      ('spotio_recovery_runs','lead_management'),
      ('territories','lead_management'),
      ('provider_sale_capture_photos','sales_tracking'),
      ('provider_sale_captures','sales_tracking'),
      ('sale_admin_edit_history','sales_tracking'),
      ('sale_admin_review_transactions','sales_tracking'),
      ('sale_deletion_audit','sales_tracking'),
      ('sale_order_photos','sales_tracking'),
      ('sale_rep_detail_history','sales_tracking'),
      ('sales_feed','sales_tracking'),
      ('sales_records','sales_tracking'),
      ('provider_sales_imports','provider_integrations'),
      ('provider_sales_rows','provider_integrations'),
      ('sale_order_photo_pilot_samples','provider_integrations'),
      ('field_analytics_results','analytics'),
      ('field_session_auto_closures','analytics'),
      ('field_sessions','native_background_location'),
      ('location_events','native_background_location'),
      ('native_location_sessions','native_background_location'),
      ('test_events','native_background_location'),
      ('test_sessions','native_background_location')
    ) as gated(table_name,entitlement)
  loop
    if to_regclass(format('public.%I',target.table_name)) is null then
      raise exception 'paywall_phase2_missing_table:%',target.table_name;
    end if;
    execute format('drop policy if exists feature_entitlement_gate on public.%I',target.table_name);
    execute format(
      'create policy feature_entitlement_gate on public.%I as restrictive for all to authenticated using (private.organization_access_allowed(organization_id,%L)) with check (private.organization_access_allowed(organization_id,%L))',
      target.table_name,
      target.entitlement,
      target.entitlement
    );
  end loop;
end
$phase2_feature_policies$;

comment on function private.assert_current_organization_access(text) is
  'Fails closed against current organization, subscription, membership, seat, and feature entitlement state for direct authenticated RPC calls.';

commit;
