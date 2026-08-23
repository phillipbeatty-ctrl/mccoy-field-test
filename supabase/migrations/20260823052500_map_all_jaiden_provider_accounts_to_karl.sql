-- Cross-provider identity control. Exact provider aliases named Jaiden Hervi
-- resolve to the already-established Karl Homola McCoy rep account.
create table if not exists public.global_provider_identity_links (
  identity_key text primary key,
  provider_identity_name text not null,
  rep_user_id uuid not null references auth.users(id) on delete restrict,
  rep_email text not null,
  rep_name text not null,
  active boolean not null default true,
  assigned_at timestamptz not null default now(),
  assigned_by text not null
);
alter table public.global_provider_identity_links enable row level security;
revoke all on public.global_provider_identity_links from public,anon,authenticated;

insert into public.global_provider_identity_links(identity_key,provider_identity_name,rep_user_id,rep_email,rep_name,assigned_by)
select private.provider_identity_key('Jaiden Hervi'),'Jaiden Hervi',u.id,lower(u.email),'Karl Homola','owner_control:all_jaiden_isp_accounts'
from auth.users u join public.app_user_access a on lower(a.email)=lower(u.email)
where u.id='278a5053-1348-42c7-914f-7b7eabdeddd9'
 and lower(u.email)='karl.mccoyplatforms@gmail.com' and a.active=true
on conflict(identity_key) do update set rep_user_id=excluded.rep_user_id,rep_email=excluded.rep_email,
 rep_name=excluded.rep_name,active=true,assigned_by=excluded.assigned_by;

create or replace function private.apply_global_provider_identity_link()
returns trigger language plpgsql security definer set search_path=pg_catalog,public,auth,private as $$
declare v_link public.global_provider_identity_links%rowtype; v_identifier text;
begin
 select * into v_link from public.global_provider_identity_links g where g.active=true and g.identity_key in(
  private.provider_identity_key(coalesce(new.seller_name,'')),
  private.provider_identity_key(coalesce(new.seller_identifier,'')),
  private.provider_identity_key(coalesce(new.seller_email,''))) limit 1;
 if v_link.identity_key is null then return new; end if;
 if not exists(select 1 from public.app_user_access a join auth.users u on lower(u.email)=lower(a.email)
  where u.id=v_link.rep_user_id and lower(u.email)=lower(v_link.rep_email) and a.active=true) then
  raise exception 'global_provider_identity_target_inactive';
 end if;
 v_identifier:=coalesce(nullif(trim(new.seller_identifier),''),nullif(trim(new.seller_name),''),v_link.provider_identity_name);
 update public.provider_seller_links set active=false where provider=new.provider and
  private.provider_identity_key(seller_identifier)=private.provider_identity_key(v_identifier) and rep_user_id<>v_link.rep_user_id;
 insert into public.provider_seller_links(rep_user_id,rep_email,provider,seller_identifier,seller_name,active)
 values(v_link.rep_user_id,v_link.rep_email,new.provider,v_identifier,v_link.provider_identity_name,true)
 on conflict(rep_user_id,provider,seller_identifier) do update set rep_email=excluded.rep_email,seller_name=excluded.seller_name,active=true;
 return new;
end $$;

drop trigger if exists provider_sales_rows_global_identity on public.provider_sales_rows;
create trigger provider_sales_rows_global_identity before insert or update on public.provider_sales_rows
for each row execute function private.apply_global_provider_identity_link();

-- Apply the control to all existing Jaiden rows and let ranking triggers re-evaluate them.
update public.provider_sales_rows set materialization_reason=materialization_reason
where private.provider_identity_key(coalesce(seller_name,''))=private.provider_identity_key('Jaiden Hervi')
   or private.provider_identity_key(coalesce(seller_identifier,''))=private.provider_identity_key('Jaiden Hervi');
