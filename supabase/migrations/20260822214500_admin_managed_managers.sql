begin;

update public.app_user_access as manager
set assigned_manager_email = administrator.email,
    assigned_manager_name = coalesce(administrator.display_name, administrator.email),
    assigned_admin_email = administrator.email,
    assigned_admin_name = coalesce(administrator.display_name, administrator.email)
from public.app_user_access as administrator
where manager.active is true
  and manager.role = 'manager'
  and administrator.active is true
  and administrator.role = 'admin'
  and lower(administrator.email) = lower(manager.assigned_admin_email);

do $$
begin
  if exists (
    select 1
    from public.app_user_access as manager
    left join public.app_user_access as administrator
      on lower(administrator.email) = lower(manager.assigned_manager_email)
     and administrator.active is true
     and administrator.role = 'admin'
    where manager.active is true
      and manager.role = 'manager'
      and (
        administrator.email is null
        or lower(manager.assigned_manager_email) <> lower(manager.assigned_admin_email)
      )
  ) then
    raise exception 'Every active Manager must have the same active Admin in assigned manager and assigned administrator fields';
  end if;
end
$$;

update public.leads as lead
set assigned_admin_email = manager_access.assigned_manager_email
from public.users as manager_profile
join public.app_user_access as manager_access
  on lower(manager_access.email) = lower(manager_profile.email)
where lead.assigned_manager_id = manager_profile.id
  and manager_access.active is true
  and manager_access.role = 'manager'
  and lower(coalesce(lead.assigned_admin_email, '')) <> lower(manager_access.assigned_manager_email);

commit;
