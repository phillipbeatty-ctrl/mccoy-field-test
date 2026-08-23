create table if not exists public.secondary_admin_assignments (
  id uuid primary key default gen_random_uuid(), owner_user_id uuid not null references auth.users(id) on delete restrict,
  secondary_user_id uuid not null references auth.users(id) on delete restrict, secondary_email text not null,
  prior_role text not null check (prior_role in ('rep','manager','trainer')), active boolean not null default true,
  assigned_at timestamptz not null default now(), revoked_at timestamptz
);
create unique index if not exists one_active_secondary_admin on public.secondary_admin_assignments ((active)) where active=true;
alter table public.secondary_admin_assignments enable row level security;
revoke all on public.secondary_admin_assignments from public,anon,authenticated;

create or replace function public.owner_set_secondary_admin(p_target_email text,p_enabled boolean)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,auth as $$
declare
 v_owner constant uuid:='f9053207-1af1-4ed1-be43-28f4bf5d7732'; v_owner_email constant text:='phillip.beatty@gmail.com';
 v_email text:=lower(trim(coalesce(p_target_email,''))); v_id uuid; v_role text; v_row public.secondary_admin_assignments%rowtype;
begin
 if (select auth.uid()) is distinct from v_owner then raise exception 'original_owner_only' using errcode='42501'; end if;
 if not exists(select 1 from auth.users where id=v_owner and lower(email)=v_owner_email) then raise exception 'owner_identity_mismatch'; end if;
 if v_email='' or v_email=v_owner_email then raise exception 'invalid_secondary_admin'; end if;
 select u.id,a.role into v_id,v_role from auth.users u join public.app_user_access a on lower(a.email)=lower(u.email)
 where lower(u.email)=v_email and a.active=true;
 if v_id is null then raise exception 'active_target_required'; end if;
 select * into v_row from public.secondary_admin_assignments where active=true limit 1 for update;
 if p_enabled then
  if v_row.id is not null and v_row.secondary_user_id<>v_id then raise exception 'secondary_admin_already_assigned'; end if;
  if v_row.id is null then
   if v_role not in ('rep','manager','trainer') then raise exception 'eligible_non_admin_required'; end if;
   insert into public.secondary_admin_assignments(owner_user_id,secondary_user_id,secondary_email,prior_role) values(v_owner,v_id,v_email,v_role);
  end if;
  update public.app_user_access set role='admin',assigned_manager_email=null,assigned_manager_name=null,assigned_admin_email=null,assigned_admin_name=null where email=v_email;
  update public.users set role='admin' where auth_user_id=v_id;
 else
  if v_row.id is null or v_row.secondary_user_id<>v_id then raise exception 'secondary_admin_assignment_not_found'; end if;
  update public.app_user_access set role=v_row.prior_role,
   assigned_manager_email=case when v_row.prior_role in ('manager','trainer') then v_owner_email else assigned_manager_email end,
   assigned_admin_email=case when v_row.prior_role in ('manager','trainer') then v_owner_email else null end,
   assigned_manager_name=case when v_row.prior_role in ('manager','trainer') then 'Phillip Beatty' else assigned_manager_name end,
   assigned_admin_name=case when v_row.prior_role in ('manager','trainer') then 'Phillip Beatty' else null end where email=v_email;
  update public.users set role=v_row.prior_role where auth_user_id=v_id;
  update public.secondary_admin_assignments set active=false,revoked_at=now() where id=v_row.id;
 end if;
 return jsonb_build_object('ok',true,'secondary_email',v_email,'enabled',p_enabled);
end $$;
revoke all on function public.owner_set_secondary_admin(text,boolean) from public,anon;
grant execute on function public.owner_set_secondary_admin(text,boolean) to authenticated;
