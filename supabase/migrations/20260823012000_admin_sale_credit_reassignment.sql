alter table public.sales_records
  add column if not exists provider_reported_rep_user_id uuid,
  add column if not exists provider_reported_rep_email text,
  add column if not exists provider_reported_rep_name text,
  add column if not exists credit_assigned_by uuid,
  add column if not exists credit_assigned_at timestamptz,
  add column if not exists credit_assignment_reason text;

update public.sales_records
set provider_reported_rep_user_id=coalesce(provider_reported_rep_user_id,rep_user_id),
    provider_reported_rep_email=coalesce(provider_reported_rep_email,rep_email),
    provider_reported_rep_name=coalesce(provider_reported_rep_name,rep_name)
where provider_reported_rep_user_id is null or provider_reported_rep_email is null or provider_reported_rep_name is null;

create table if not exists public.sale_credit_assignment_history(
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales_records(id) on delete restrict,
  previous_rep_user_id uuid not null, previous_rep_email text not null, previous_rep_name text not null,
  new_rep_user_id uuid not null, new_rep_email text not null, new_rep_name text not null,
  changed_by_user_id uuid not null, changed_by_email text not null,
  reason text not null, created_at timestamptz not null default now()
);
create index if not exists sale_credit_assignment_history_sale_created_idx on public.sale_credit_assignment_history(sale_id,created_at desc);
create index if not exists sales_records_provider_reported_rep_idx on public.sales_records(provider_reported_rep_user_id,created_at desc);
alter table public.sale_credit_assignment_history enable row level security;
revoke all on public.sale_credit_assignment_history from anon;
revoke insert,update,delete on public.sale_credit_assignment_history from authenticated;
grant select on public.sale_credit_assignment_history to authenticated;
grant select on public.sales_records to authenticated;
drop policy if exists "Admins can view sale credit assignment history" on public.sale_credit_assignment_history;
create policy "Admins can view sale credit assignment history" on public.sale_credit_assignment_history for select to authenticated
using(exists(select 1 from auth.users au join public.app_user_access aua on lower(aua.email)=lower(au.email)
  where au.id=(select auth.uid()) and aua.active=true and lower(aua.role)='admin'));
drop policy if exists "Admins can read sales records for credit assignment" on public.sales_records;
create policy "Admins can read sales records for credit assignment" on public.sales_records for select to authenticated
using(exists(select 1 from auth.users au join public.app_user_access aua on lower(aua.email)=lower(au.email)
  where au.id=(select auth.uid()) and aua.active=true and lower(aua.role)='admin'));

create or replace function public.admin_reassign_sale_credit(p_sale_id uuid,p_new_rep_user_id uuid,p_reason text)
returns public.sales_records language plpgsql security definer set search_path=pg_catalog,public,auth as $$
declare v_actor_id uuid:=auth.uid();v_actor_email text;v_new_email text;v_new_name text;v_sale public.sales_records%rowtype;
v_previous_user_id uuid;v_previous_email text;v_previous_name text;
begin
  if v_actor_id is null then raise exception 'Authentication required';end if;
  select au.email into v_actor_email from auth.users au join public.app_user_access aua on lower(aua.email)=lower(au.email)
  where au.id=v_actor_id and aua.active=true and lower(aua.role)='admin';
  if v_actor_email is null then raise exception 'Admin access required';end if;
  if nullif(btrim(p_reason),'') is null then raise exception 'A reassignment reason is required';end if;
  select au.email,coalesce(nullif(aua.display_name,''),split_part(au.email,'@',1)) into v_new_email,v_new_name
  from auth.users au join public.app_user_access aua on lower(aua.email)=lower(au.email) where au.id=p_new_rep_user_id and aua.active=true;
  if v_new_email is null then raise exception 'Target user must have active McCoy access';end if;
  select * into v_sale from public.sales_records where id=p_sale_id for update;
  if not found then raise exception 'Sale not found';end if;
  if v_sale.rep_user_id=p_new_rep_user_id then raise exception 'Sale is already credited to that user';end if;
  v_previous_user_id:=v_sale.rep_user_id;v_previous_email:=v_sale.rep_email;v_previous_name:=v_sale.rep_name;
  update public.sales_records set
    provider_reported_rep_user_id=coalesce(provider_reported_rep_user_id,v_previous_user_id),
    provider_reported_rep_email=coalesce(provider_reported_rep_email,v_previous_email),
    provider_reported_rep_name=coalesce(provider_reported_rep_name,v_previous_name),
    rep_user_id=p_new_rep_user_id,rep_email=v_new_email,rep_name=v_new_name,
    credit_assigned_by=v_actor_id,credit_assigned_at=now(),credit_assignment_reason=btrim(p_reason)
  where id=p_sale_id returning * into v_sale;
  insert into public.sale_credit_assignment_history(sale_id,previous_rep_user_id,previous_rep_email,previous_rep_name,new_rep_user_id,new_rep_email,new_rep_name,changed_by_user_id,changed_by_email,reason)
  values(p_sale_id,v_previous_user_id,v_previous_email,v_previous_name,p_new_rep_user_id,v_new_email,v_new_name,v_actor_id,v_actor_email,btrim(p_reason));
  return v_sale;
end;$$;

create or replace function public.admin_reassign_sale_credit(p_sale_id uuid,p_new_rep_email text,p_reason text)
returns public.sales_records language plpgsql security definer set search_path=pg_catalog,public,auth as $$
declare v_target_id uuid;begin
  select au.id into v_target_id from auth.users au join public.app_user_access aua on lower(aua.email)=lower(au.email)
  where lower(au.email)=lower(btrim(p_new_rep_email)) and aua.active=true limit 1;
  if v_target_id is null then raise exception 'Target user must have active McCoy access';end if;
  return public.admin_reassign_sale_credit(p_sale_id,v_target_id,p_reason);
end;$$;

revoke all on function public.admin_reassign_sale_credit(uuid,uuid,text) from public,anon;
revoke all on function public.admin_reassign_sale_credit(uuid,text,text) from public,anon;
grant execute on function public.admin_reassign_sale_credit(uuid,uuid,text) to authenticated;
grant execute on function public.admin_reassign_sale_credit(uuid,text,text) to authenticated;
