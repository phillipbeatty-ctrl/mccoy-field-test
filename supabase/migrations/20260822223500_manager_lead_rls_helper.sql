begin;

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
    and manager_access.role = 'manager'
    and lower(manager_access.assigned_manager_email) = lower(manager_access.assigned_admin_email)
  limit 1;
$$;

revoke all on function private.current_manager_admin_email() from public;
grant execute on function private.current_manager_admin_email() to authenticated, service_role;

drop policy if exists leads_select_scope on public.leads;
create policy leads_select_scope
on public.leads
for select
to authenticated
using (
  (select private.current_app_role()) = 'admin'
  or (
    (select private.current_app_role()) = 'manager'
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
    (select private.current_app_role()) = 'manager'
    and assigned_manager_id = (select private.current_app_user_id())
    and assigned_admin_email is not null
    and lower(assigned_admin_email) = lower((select private.current_manager_admin_email()))
  )
)
with check (
  (select private.current_app_role()) = 'admin'
  or (
    (select private.current_app_role()) = 'manager'
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

commit;
