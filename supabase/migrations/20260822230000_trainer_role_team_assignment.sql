begin;

alter table public.app_user_access drop constraint if exists app_user_access_role_check;
alter table public.app_user_access
  add constraint app_user_access_role_check
  check (role in ('admin', 'manager', 'trainer', 'rep', 'tester'));

alter table public.users drop constraint if exists users_role_check;
alter table public.users
  add constraint users_role_check
  check (role in ('rep', 'manager', 'trainer', 'admin'));

create or replace function private.current_manager_admin_email()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select administrator.email
  from public.app_user_access as manager_access
  join public.app_user_access as administrator
    on lower(administrator.email) = lower(manager_access.assigned_manager_email)
   and administrator.active is true
   and administrator.role = 'admin'
  where lower(manager_access.email) = lower(coalesce((select auth.jwt()) ->> 'email', ''))
    and manager_access.active is true
    and manager_access.role in ('manager', 'trainer')
    and lower(manager_access.assigned_manager_email) = lower(manager_access.assigned_admin_email)
  limit 1;
$$;

revoke all on function private.current_manager_admin_email() from public;
grant execute on function private.current_manager_admin_email() to authenticated, service_role;

create or replace function public.is_field_admin_or_manager(p_email text)
returns boolean
language sql
as $$
  select exists(
    select 1
    from public.app_user_access
    where lower(email) = lower(p_email)
      and active = true
      and role in ('admin', 'manager', 'trainer')
  );
$$;

create or replace function public.admin_set_manager_override_authority(
  p_manager_email text,
  p_enabled boolean,
  p_changed_by uuid,
  p_changed_by_email text
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_email text := lower(trim(p_manager_email));
  v_name text;
  v_previous boolean := true;
  v_had_control boolean := false;
  v_changed boolean;
begin
  select coalesce(nullif(trim(display_name),''),email) into v_name
  from public.app_user_access
  where lower(email)=v_email and active=true and role in ('manager','trainer','admin');
  if not found then raise exception 'active_manager_or_trainer_required'; end if;

  select overrides_enabled into v_previous
  from public.manager_override_controls where manager_email=v_email;
  v_had_control := found;
  if not v_had_control then v_previous := true; end if;
  v_changed := v_previous is distinct from p_enabled;

  insert into public.manager_override_controls (
    manager_email,manager_name,overrides_enabled,updated_at,updated_by
  ) values (v_email,v_name,p_enabled,now(),p_changed_by)
  on conflict (manager_email) do update set
    manager_name=excluded.manager_name,
    overrides_enabled=excluded.overrides_enabled,
    updated_at=excluded.updated_at,
    updated_by=excluded.updated_by;

  if v_changed then
    insert into public.manager_override_authority_changes (
      changed_by,changed_by_email,manager_email,manager_name,previous_enabled,new_enabled
    ) values (
      p_changed_by,lower(trim(p_changed_by_email)),v_email,v_name,v_previous,p_enabled
    );
  end if;

  return jsonb_build_object(
    'changed',v_changed,'manager_email',v_email,'manager_name',v_name,
    'previous_enabled',v_previous,'overrides_enabled',p_enabled
  );
end;
$$;

revoke all on function public.admin_set_manager_override_authority(text,boolean,uuid,text) from public,anon,authenticated;
grant execute on function public.admin_set_manager_override_authority(text,boolean,uuid,text) to service_role;

drop policy if exists "managers can read direct report access" on public.app_user_access;
create policy "managers can read direct report access"
on public.app_user_access
for select
to authenticated
using (
  (select private.current_app_role()) in ('manager', 'trainer')
  and role in ('rep', 'tester')
  and active
  and lower(coalesce(assigned_manager_email, '')) = lower(coalesce((select auth.jwt()) ->> 'email', ''))
);

drop policy if exists door_activities_select_scope on public.door_activities;
create policy door_activities_select_scope
on public.door_activities
for select
to authenticated
using (
  (select private.current_app_role()) = 'admin'
  or rep_id = (select private.current_app_user_id())
  or (
    (select private.current_app_role()) in ('manager', 'trainer')
    and exists (
      select 1 from public.users r
      where r.id = door_activities.rep_id
        and r.team_id = (select private.current_team_id())
    )
  )
);

drop policy if exists door_visits_select_scope on public.door_visits;
create policy door_visits_select_scope
on public.door_visits
for select
to authenticated
using (
  (select private.current_app_role()) = 'admin'
  or rep_id = (select private.current_app_user_id())
  or (
    (select private.current_app_role()) in ('manager', 'trainer')
    and exists (
      select 1 from public.users r
      where r.id = door_visits.rep_id
        and r.team_id = (select private.current_team_id())
    )
  )
);

drop policy if exists field_sessions_select_scope on public.field_sessions;
create policy field_sessions_select_scope
on public.field_sessions
for select
to authenticated
using (
  (select private.current_app_role()) = 'admin'
  or rep_id = (select private.current_app_user_id())
  or (
    (select private.current_app_role()) in ('manager', 'trainer')
    and exists (
      select 1 from public.users r
      where r.id = field_sessions.rep_id
        and r.team_id = (select private.current_team_id())
    )
  )
);

drop policy if exists lead_assignment_history_insert_scope on public.lead_assignment_history;
create policy lead_assignment_history_insert_scope
on public.lead_assignment_history
for insert
to authenticated
with check (
  (select private.current_app_role()) = 'admin'
  or (
    (select private.current_app_role()) in ('manager', 'trainer')
    and coalesce(new_team_id, previous_team_id) = (select private.current_team_id())
    and changed_by_user_id = (select private.current_app_user_id())
  )
);

drop policy if exists leads_select_scope on public.leads;
create policy leads_select_scope
on public.leads
for select
to authenticated
using (
  (select private.current_app_role()) = 'admin'
  or (
    (select private.current_app_role()) in ('manager', 'trainer')
    and assigned_manager_id = (select private.current_app_user_id())
    and assigned_admin_email is not null
    and lower(assigned_admin_email) = lower((select private.current_manager_admin_email()))
  )
  or (
    (select private.current_app_role()) = 'rep'
    and assigned_rep_id = (select private.current_app_user_id())
  )
);

drop policy if exists leads_update_scope on public.leads;
create policy leads_update_scope
on public.leads
for update
to authenticated
using (
  (select private.current_app_role()) = 'admin'
  or (
    (select private.current_app_role()) in ('manager', 'trainer')
    and assigned_manager_id = (select private.current_app_user_id())
    and assigned_admin_email is not null
    and lower(assigned_admin_email) = lower((select private.current_manager_admin_email()))
  )
)
with check (
  (select private.current_app_role()) = 'admin'
  or (
    (select private.current_app_role()) in ('manager', 'trainer')
    and assigned_manager_id = (select private.current_app_user_id())
    and assigned_admin_email is not null
    and lower(assigned_admin_email) = lower((select private.current_manager_admin_email()))
    and (
      assigned_rep_id is null
      or exists (
        select 1
        from public.users as target_rep
        join public.app_user_access as target_access
          on lower(target_access.email) = lower(target_rep.email)
        where target_rep.id = leads.assigned_rep_id
          and target_rep.active is true
          and target_rep.role = 'rep'
          and target_access.active is true
          and target_access.role in ('rep', 'tester')
          and lower(coalesce(target_access.assigned_manager_email, '')) = lower(coalesce((select auth.jwt()) ->> 'email', ''))
      )
    )
  )
);

drop policy if exists location_events_select_scope on public.location_events;
create policy location_events_select_scope
on public.location_events
for select
to authenticated
using (
  (select private.current_app_role()) = 'admin'
  or rep_id = (select private.current_app_user_id())
  or (
    (select private.current_app_role()) in ('manager', 'trainer')
    and exists (
      select 1 from public.users r
      where r.id = location_events.rep_id
        and r.team_id = (select private.current_team_id())
    )
  )
);

drop policy if exists teams_update_scope on public.teams;
create policy teams_update_scope
on public.teams
for update
to authenticated
using (
  (select private.current_app_role()) = 'admin'
  or (
    (select private.current_app_role()) in ('manager', 'trainer')
    and id = (select private.current_team_id())
  )
)
with check (
  (select private.current_app_role()) = 'admin'
  or (
    (select private.current_app_role()) in ('manager', 'trainer')
    and id = (select private.current_team_id())
  )
);

drop policy if exists territories_update_scope on public.territories;
create policy territories_update_scope
on public.territories
for update
to authenticated
using (
  (select private.current_app_role()) = 'admin'
  or (
    (select private.current_app_role()) in ('manager', 'trainer')
    and assigned_team_id = (select private.current_team_id())
  )
)
with check (
  (select private.current_app_role()) = 'admin'
  or (
    (select private.current_app_role()) in ('manager', 'trainer')
    and assigned_team_id = (select private.current_team_id())
  )
);

drop policy if exists users_select_scope on public.users;
create policy users_select_scope
on public.users
for select
to authenticated
using (
  id = (select private.current_app_user_id())
  or (select private.current_app_role()) = 'admin'
  or (
    (select private.current_app_role()) in ('manager', 'trainer')
    and (
      team_id = (select private.current_team_id())
      or exists (
        select 1
        from public.app_user_access direct_report
        where lower(direct_report.email) = lower(users.email)
          and direct_report.active
          and direct_report.role in ('rep', 'tester')
          and lower(coalesce(direct_report.assigned_manager_email, '')) = lower(coalesce((select auth.jwt()) ->> 'email', ''))
      )
    )
  )
);

comment on function private.current_manager_admin_email() is
  'Returns the active Admin supervisor for the authenticated Manager or Trainer when both hierarchy fields agree.';

commit;
