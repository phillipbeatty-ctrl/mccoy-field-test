begin;

create table if not exists public.user_account_removal_history (
  id uuid primary key default gen_random_uuid(),
  target_user_id uuid not null,
  target_email text not null,
  target_display_name text,
  target_role text,
  requested_by uuid not null,
  requested_by_email text not null,
  reason text not null,
  status text not null default 'prepared',
  impact jsonb not null default '{}'::jsonb,
  error_code text,
  requested_at timestamptz not null default clock_timestamp(),
  finalized_at timestamptz,
  constraint user_account_removal_history_reason_check
    check (char_length(btrim(reason)) between 10 and 500),
  constraint user_account_removal_history_status_check
    check (status in ('prepared','auth_deleted','auth_delete_failed'))
);

create index if not exists user_account_removal_history_target_idx
  on public.user_account_removal_history(target_user_id,requested_at desc);
create index if not exists user_account_removal_history_status_idx
  on public.user_account_removal_history(status,requested_at desc);

alter table public.user_account_removal_history enable row level security;
revoke all on table public.user_account_removal_history from public,anon,authenticated;
grant select on table public.user_account_removal_history to authenticated;
grant select,insert,update on table public.user_account_removal_history to service_role;

drop policy if exists user_account_removal_history_admin_read on public.user_account_removal_history;
create policy user_account_removal_history_admin_read
on public.user_account_removal_history
for select
to authenticated
using (
  exists (
    select 1
    from public.app_user_access access
    where lower(access.email)=lower(coalesce(auth.jwt()->>'email',''))
      and access.active is true
      and access.role='admin'
  )
);

create or replace function private.protect_user_account_removal_history()
returns trigger
language plpgsql
set search_path=pg_catalog,public
as $$
begin
  if tg_op='DELETE' then
    raise exception 'user_account_removal_history_is_immutable' using errcode='55000';
  end if;

  if old.status='prepared'
     and new.status in ('auth_deleted','auth_delete_failed')
     and new.id=old.id
     and new.target_user_id=old.target_user_id
     and new.target_email=old.target_email
     and new.target_display_name is not distinct from old.target_display_name
     and new.target_role is not distinct from old.target_role
     and new.requested_by=old.requested_by
     and new.requested_by_email=old.requested_by_email
     and new.reason=old.reason
     and new.impact=old.impact
     and new.requested_at=old.requested_at
     and new.finalized_at is not null then
    return new;
  end if;

  raise exception 'user_account_removal_history_is_immutable' using errcode='55000';
end;
$$;

revoke all on function private.protect_user_account_removal_history() from public,anon,authenticated;

drop trigger if exists user_account_removal_history_immutable on public.user_account_removal_history;
create trigger user_account_removal_history_immutable
before update or delete on public.user_account_removal_history
for each row execute function private.protect_user_account_removal_history();

create or replace function public.admin_user_account_removal_preview(
  p_target_user_id uuid,
  p_target_email text
)
returns jsonb
language plpgsql
security invoker
set search_path=pg_catalog,public
as $$
declare
  v_email text:=lower(btrim(coalesce(p_target_email,'')));
  v_display_name text;
  v_role text;
  v_access_active boolean:=false;
  v_profile_id uuid;
  v_storage_objects integer:=0;
  v_assigned_leads integer:=0;
  v_direct_reports integer:=0;
  v_active_sessions integer:=0;
  v_active_visits integer:=0;
  v_open_captures integer:=0;
  v_regions integer:=0;
  v_historical_sales integer:=0;
  v_historical_wins integer:=0;
  v_chargebacks integer:=0;
  v_provider_links integer:=0;
begin
  if p_target_user_id is null or v_email='' then
    raise exception 'target_user_and_email_required' using errcode='22023';
  end if;

  select access.display_name,access.role,coalesce(access.active,false)
  into v_display_name,v_role,v_access_active
  from public.app_user_access access
  where lower(access.email)=v_email;

  select profile.id into v_profile_id
  from public.users profile
  where profile.auth_user_id=p_target_user_id
     or lower(coalesce(profile.email,''))=v_email
  order by (profile.auth_user_id=p_target_user_id) desc
  limit 1;

  select count(*)::integer into v_storage_objects
  from storage.objects object
  where object.owner=p_target_user_id or object.owner_id=p_target_user_id::text;

  if v_profile_id is not null then
    select count(*)::integer into v_assigned_leads
    from public.leads lead
    where lead.deleted_at is null
      and (lead.assigned_rep_id=v_profile_id or lead.assigned_manager_id=v_profile_id);

    select count(*)::integer into v_active_visits
    from public.door_visits visit
    where visit.rep_id=v_profile_id and visit.status='active';

    select count(*)::integer into v_regions
    from public.teams team
    where team.active is true and team.manager_user_id=v_profile_id;
  end if;

  select count(*)::integer into v_direct_reports
  from public.app_user_access report
  where report.active is true
    and lower(report.email)<>v_email
    and (
      lower(coalesce(report.assigned_manager_email,''))=v_email
      or lower(coalesce(report.assigned_admin_email,''))=v_email
    );

  select count(*)::integer into v_active_sessions
  from public.test_sessions session
  where session.tester_user_id=p_target_user_id and session.ended_at is null;

  select count(*)::integer into v_open_captures
  from public.provider_sale_captures capture
  where capture.rep_user_id=p_target_user_id
    and capture.status in ('dashboard_opened','details_required')
    and capture.rep_outcome is null;

  select count(*)::integer into v_historical_sales
  from public.sales_records sale where sale.rep_user_id=p_target_user_id;

  select count(*)::integer into v_historical_wins
  from public.sales_feed win where win.rep_user_id=p_target_user_id;

  select count(*)::integer into v_chargebacks
  from public.commission_chargebacks chargeback where chargeback.rep_user_id=p_target_user_id;

  select (
    (select count(*) from public.global_provider_identity_links link where link.rep_user_id=p_target_user_id and link.active is true)
    +(select count(*) from public.provider_seller_links link where link.rep_user_id=p_target_user_id and link.active is true)
    +(select count(*) from public.provider_corporate_access access where access.mccoy_user_id=p_target_user_id and access.active is true)
  )::integer into v_provider_links;

  return jsonb_build_object(
    'ok',true,
    'target_user_id',p_target_user_id,
    'target_email',v_email,
    'target_display_name',coalesce(v_display_name,v_email),
    'target_role',v_role,
    'access_active',v_access_active,
    'protected_original_owner',p_target_user_id='f9053207-1af1-4ed1-be43-28f4bf5d7732'::uuid or v_email='phillip.beatty@gmail.com',
    'protected_admin',coalesce(v_role,'')='admin',
    'blocked_by_storage',v_storage_objects>0,
    'storage_objects',v_storage_objects,
    'assigned_leads',v_assigned_leads,
    'direct_reports',v_direct_reports,
    'active_sessions',v_active_sessions,
    'active_visits',v_active_visits,
    'open_provider_captures',v_open_captures,
    'assigned_regions',v_regions,
    'provider_access_links',v_provider_links,
    'historical_sales_retained',v_historical_sales,
    'historical_wins_retained',v_historical_wins,
    'chargebacks_retained',v_chargebacks
  );
end;
$$;

create or replace function public.admin_prepare_user_account_removal(
  p_target_user_id uuid,
  p_target_email text,
  p_changed_by uuid,
  p_changed_by_email text,
  p_reason text
)
returns jsonb
language plpgsql
security invoker
set search_path=pg_catalog,public
as $$
declare
  v_email text:=lower(btrim(coalesce(p_target_email,'')));
  v_actor_email text:=lower(btrim(coalesce(p_changed_by_email,'')));
  v_reason text:=btrim(coalesce(p_reason,''));
  v_preview jsonb;
  v_profile_id uuid;
  v_audit_id uuid;
  v_now timestamptz:=clock_timestamp();
  v_count integer:=0;
  v_cleanup jsonb:='{}'::jsonb;
begin
  if char_length(v_reason)<10 or char_length(v_reason)>500 or v_reason~'[[:cntrl:]]' then
    raise exception 'removal_reason_must_be_10_to_500_printable_characters' using errcode='22023';
  end if;

  if not exists (
    select 1
    from public.users profile
    join public.app_user_access access on lower(access.email)=lower(profile.email)
    where profile.auth_user_id=p_changed_by
      and lower(profile.email)=v_actor_email
      and profile.active is true
      and access.active is true
      and access.role='admin'
  ) then
    raise exception 'active_admin_required' using errcode='42501';
  end if;

  if p_target_user_id=p_changed_by or v_email=v_actor_email then
    raise exception 'cannot_delete_own_account' using errcode='42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_target_user_id::text,0));
  v_preview:=public.admin_user_account_removal_preview(p_target_user_id,v_email);

  if coalesce((v_preview->>'protected_original_owner')::boolean,false) then
    raise exception 'original_owner_account_is_protected' using errcode='42501';
  end if;
  if coalesce((v_preview->>'protected_admin')::boolean,false) then
    raise exception 'revoke_secondary_admin_before_account_removal' using errcode='42501';
  end if;
  if coalesce((v_preview->>'blocked_by_storage')::boolean,false) then
    raise exception 'storage_objects_must_be_reassigned_before_account_removal' using errcode='55000';
  end if;

  select id into v_profile_id from public.users where auth_user_id=p_target_user_id;

  update public.app_user_access
  set active=false,
      assigned_manager_email=null,
      assigned_manager_name=null,
      assigned_admin_email=null,
      assigned_admin_name=null
  where lower(email)=v_email;
  get diagnostics v_count=row_count;
  v_cleanup:=v_cleanup||jsonb_build_object('access_rows_deactivated',v_count);

  update public.app_user_access
  set assigned_manager_email=case when lower(coalesce(assigned_manager_email,''))=v_email then null else assigned_manager_email end,
      assigned_manager_name=case when lower(coalesce(assigned_manager_email,''))=v_email then null else assigned_manager_name end,
      assigned_admin_email=case when lower(coalesce(assigned_admin_email,''))=v_email then null else assigned_admin_email end,
      assigned_admin_name=case when lower(coalesce(assigned_admin_email,''))=v_email then null else assigned_admin_name end
  where lower(coalesce(assigned_manager_email,''))=v_email
     or lower(coalesce(assigned_admin_email,''))=v_email;
  get diagnostics v_count=row_count;
  v_cleanup:=v_cleanup||jsonb_build_object('direct_reports_unassigned',v_count);

  update public.users set active=false where auth_user_id=p_target_user_id;
  get diagnostics v_count=row_count;
  v_cleanup:=v_cleanup||jsonb_build_object('profiles_deactivated',v_count);

  update public.test_sessions
  set ended_at=v_now
  where tester_user_id=p_target_user_id and ended_at is null;
  get diagnostics v_count=row_count;
  v_cleanup:=v_cleanup||jsonb_build_object('sessions_stopped',v_count);

  if v_profile_id is not null then
    update public.door_visits
    set status='cancelled',
        disposition_at=coalesce(disposition_at,v_now),
        dwell_seconds=coalesce(dwell_seconds,greatest(0,extract(epoch from(v_now-arrived_at)))::integer),
        cancelled_reason='user_account_removed',
        updated_at=v_now
    where rep_id=v_profile_id and status='active';
    get diagnostics v_count=row_count;
    v_cleanup:=v_cleanup||jsonb_build_object('active_visits_cancelled',v_count);

    update public.teams set manager_user_id=null where manager_user_id=v_profile_id;
    get diagnostics v_count=row_count;
    v_cleanup:=v_cleanup||jsonb_build_object('regions_unassigned',v_count);

    update public.leads
    set assigned_rep_id=case when assigned_rep_id=v_profile_id then null else assigned_rep_id end,
        assigned_manager_id=case when assigned_manager_id=v_profile_id then null else assigned_manager_id end,
        assigned_admin_email=case when lower(coalesce(assigned_admin_email,''))=v_email then null else assigned_admin_email end
    where assigned_rep_id=v_profile_id
       or assigned_manager_id=v_profile_id
       or lower(coalesce(assigned_admin_email,''))=v_email;
    get diagnostics v_count=row_count;
    v_cleanup:=v_cleanup||jsonb_build_object('lead_assignments_cleared',v_count);
  end if;

  update public.provider_sale_captures
  set status='cancelled',
      rep_outcome='abandoned',
      rep_outcome_at=v_now,
      updated_at=v_now,
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'account_removal',jsonb_build_object('removed_at',v_now,'removed_by',p_changed_by,'reason',v_reason)
      )
  where rep_user_id=p_target_user_id
    and status in ('dashboard_opened','details_required')
    and rep_outcome is null;
  get diagnostics v_count=row_count;
  v_cleanup:=v_cleanup||jsonb_build_object('provider_attempts_abandoned',v_count);

  update public.field_area_assignments set active=false,updated_at=v_now
  where user_id=p_target_user_id and active is true;
  get diagnostics v_count=row_count;
  v_cleanup:=v_cleanup||jsonb_build_object('field_areas_deactivated',v_count);

  update public.global_provider_identity_links set active=false
  where rep_user_id=p_target_user_id and active is true;
  get diagnostics v_count=row_count;
  v_cleanup:=v_cleanup||jsonb_build_object('global_provider_links_deactivated',v_count);

  update public.provider_seller_links set active=false,updated_at=v_now
  where rep_user_id=p_target_user_id and active is true;
  get diagnostics v_count=row_count;
  v_cleanup:=v_cleanup||jsonb_build_object('provider_seller_links_deactivated',v_count);

  update public.provider_corporate_access set active=false
  where mccoy_user_id=p_target_user_id and active is true;
  get diagnostics v_count=row_count;
  v_cleanup:=v_cleanup||jsonb_build_object('provider_access_deactivated',v_count);

  update public.accounting_access set active=false where lower(email)=v_email and active is true;
  update public.apple_notes_connections set active=false where owner_user_id=p_target_user_id and active is true;

  update public.rep_access_requests
  set status='rejected',reviewed_at=v_now,reviewed_by=v_actor_email,
      notes=left(concat_ws(' ',nullif(notes,''),'Account removed by Admin:',v_reason),1000)
  where user_id=p_target_user_id and status='pending';

  insert into public.user_account_removal_history(
    target_user_id,target_email,target_display_name,target_role,
    requested_by,requested_by_email,reason,status,impact
  ) values (
    p_target_user_id,v_email,v_preview->>'target_display_name',v_preview->>'target_role',
    p_changed_by,v_actor_email,v_reason,'prepared',v_preview||jsonb_build_object('cleanup',v_cleanup)
  ) returning id into v_audit_id;

  return jsonb_build_object('ok',true,'audit_id',v_audit_id,'impact',v_preview,'cleanup',v_cleanup);
end;
$$;

create or replace function public.admin_finalize_user_account_removal(
  p_audit_id uuid,
  p_changed_by uuid,
  p_changed_by_email text,
  p_auth_deleted boolean,
  p_error_code text default null
)
returns jsonb
language plpgsql
security invoker
set search_path=pg_catalog,public
as $$
declare
  v_actor_email text:=lower(btrim(coalesce(p_changed_by_email,'')));
  v_status text:=case when p_auth_deleted then 'auth_deleted' else 'auth_delete_failed' end;
  v_row public.user_account_removal_history%rowtype;
begin
  if not exists (
    select 1
    from public.users profile
    join public.app_user_access access on lower(access.email)=lower(profile.email)
    where profile.auth_user_id=p_changed_by
      and lower(profile.email)=v_actor_email
      and profile.active is true
      and access.active is true
      and access.role='admin'
  ) then
    raise exception 'active_admin_required' using errcode='42501';
  end if;

  select * into v_row
  from public.user_account_removal_history
  where id=p_audit_id and requested_by=p_changed_by and status='prepared'
  for update;
  if not found then raise exception 'prepared_removal_not_found' using errcode='P0002'; end if;

  update public.user_account_removal_history
  set status=v_status,
      error_code=case when p_auth_deleted then null else left(coalesce(nullif(p_error_code,''),'auth_delete_failed'),200) end,
      finalized_at=clock_timestamp()
  where id=p_audit_id;

  return jsonb_build_object('ok',true,'audit_id',p_audit_id,'status',v_status);
end;
$$;

revoke all on function public.admin_user_account_removal_preview(uuid,text) from public,anon,authenticated;
revoke all on function public.admin_prepare_user_account_removal(uuid,text,uuid,text,text) from public,anon,authenticated;
revoke all on function public.admin_finalize_user_account_removal(uuid,uuid,text,boolean,text) from public,anon,authenticated;
grant execute on function public.admin_user_account_removal_preview(uuid,text) to service_role;
grant execute on function public.admin_prepare_user_account_removal(uuid,text,uuid,text,text) to service_role;
grant execute on function public.admin_finalize_user_account_removal(uuid,uuid,text,boolean,text) to service_role;

comment on table public.user_account_removal_history is
  'Immutable Admin audit of McCoy access removal and Supabase Auth soft deletion; historical accounting identities remain referenced.';
comment on function public.admin_prepare_user_account_removal(uuid,text,uuid,text,text) is
  'Service-role-only transactional removal of live McCoy access and assignments before Auth account deletion.';

commit;
