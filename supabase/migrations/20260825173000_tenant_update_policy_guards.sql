drop policy if exists users_select_scope on public.users;
create policy users_select_scope on public.users for select to authenticated using (
  organization_id=private.current_organization_id() and
  (id=private.current_app_user_id() or private.current_app_role()='admin' or (
    private.current_app_role()=any(array['manager','trainer']) and (
      team_id=private.current_team_id() or exists(
        select 1 from public.app_user_access direct_report
        where direct_report.organization_id=users.organization_id and lower(direct_report.email)=lower(users.email) and direct_report.active and
              direct_report.role=any(array['rep','tester']) and lower(coalesce(direct_report.assigned_manager_email,''))=lower(coalesce(auth.jwt()->>'email',''))
      )
    )
  ))
);

drop policy if exists teams_update_scope on public.teams;
create policy teams_update_scope on public.teams for update to authenticated
using (organization_id=private.current_organization_id() and (private.current_app_role()='admin' or (private.current_app_role()=any(array['manager','trainer']) and id=private.current_team_id())))
with check (organization_id=private.current_organization_id() and (private.current_app_role()='admin' or (private.current_app_role()=any(array['manager','trainer']) and id=private.current_team_id())));

drop policy if exists territories_update_scope on public.territories;
create policy territories_update_scope on public.territories for update to authenticated
using (organization_id=private.current_organization_id() and (private.current_app_role()='admin' or (private.current_app_role()=any(array['manager','trainer']) and assigned_team_id=private.current_team_id())))
with check (organization_id=private.current_organization_id() and (private.current_app_role()='admin' or (private.current_app_role()=any(array['manager','trainer']) and assigned_team_id=private.current_team_id())));
