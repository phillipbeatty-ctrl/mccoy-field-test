create table if not exists public.sale_rep_detail_history (
  id bigserial primary key,
  sale_id uuid not null references public.sales_records(id) on delete cascade,
  organization_id uuid not null references public.organizations(id),
  changed_by uuid not null references auth.users(id),
  changed_by_email text not null,
  changed_at timestamptz not null default now(),
  before_sale jsonb not null,
  after_sale jsonb not null,
  corrections jsonb not null default '{}'::jsonb
);
alter table public.sale_rep_detail_history enable row level security;
revoke all on public.sale_rep_detail_history from public,anon;
grant select on public.sale_rep_detail_history to authenticated;
drop policy if exists sale_rep_detail_history_select on public.sale_rep_detail_history;
create policy sale_rep_detail_history_select on public.sale_rep_detail_history for select to authenticated using (organization_id=private.current_organization_id() and (changed_by=auth.uid() or exists(select 1 from auth.users u join public.app_user_access a on lower(a.email)=lower(u.email) where u.id=auth.uid() and a.active=true and lower(a.role)='admin')));

create or replace function public.my_sales_to_complete() returns jsonb language plpgsql stable security definer set search_path='pg_catalog','public','auth','private' as $function$
declare v_actor uuid:=auth.uid(); v_org uuid:=private.current_organization_id(); v_rows jsonb;
begin
 if v_actor is null or v_org is null then raise exception 'Authentication required'; end if;
 select coalesce(jsonb_agg(to_jsonb(s) order by s.created_at desc),'[]'::jsonb) into v_rows from public.sales_records s where s.organization_id=v_org and s.rep_user_id=v_actor and lower(coalesce(s.sale_status,'')) not in ('not_a_sale','cancelled','charged_back') and coalesce(s.compensation_snapshot#>>'{admin_approval,status}','')<>'approved';
 return jsonb_build_object('ok',true,'rows',v_rows);
end;$function$;
revoke all on function public.my_sales_to_complete() from public,anon; grant execute on function public.my_sales_to_complete() to authenticated;

create or replace function public.save_my_sale_details(p_sale_id uuid,p_corrections jsonb default '{}'::jsonb) returns public.sales_records language plpgsql security definer set search_path='pg_catalog','public','auth','private' as $function$
declare v_actor uuid:=auth.uid(); v_org uuid:=private.current_organization_id(); v_email text; v_before public.sales_records%rowtype; v_after public.sales_records%rowtype; v_corrections jsonb:=coalesce(p_corrections,'{}'::jsonb); v_unknown text[];
begin
 if v_actor is null or v_org is null then raise exception 'Authentication required'; end if;
 select lower(email) into v_email from auth.users where id=v_actor;
 select * into v_before from public.sales_records where id=p_sale_id and organization_id=v_org and rep_user_id=v_actor for update;
 if not found then raise exception 'Sale not found or not assigned to this user'; end if;
 if lower(coalesce(v_before.sale_status,'')) in ('not_a_sale','cancelled','charged_back') then raise exception 'This sale is not editable'; end if;
 if coalesce(v_before.compensation_snapshot#>>'{admin_approval,status}','')='approved' or lower(coalesce(v_before.verification_reason,'')) like 'admin_sale_review_verified:%' then raise exception 'Admin-approved sales are locked. Ask Admin to correct the sale in SALE REVIEW'; end if;
 select array_agg(k) into v_unknown from jsonb_object_keys(v_corrections) k where k not in ('customer_first_name','customer_last_name','customer_phone','customer_email','service_address','provider_order_number','provider_account_number','install_date','order_date','isp','internet_product','internet_speed_mbps','notes');
 if v_unknown is not null then raise exception 'Unsupported sale field(s): %',array_to_string(v_unknown,', '); end if;
 update public.sales_records s set customer_first_name=case when v_corrections?'customer_first_name' then trim(coalesce(v_corrections->>'customer_first_name','')) else s.customer_first_name end, customer_last_name=case when v_corrections?'customer_last_name' then trim(coalesce(v_corrections->>'customer_last_name','')) else s.customer_last_name end, customer_phone=case when v_corrections?'customer_phone' then nullif(trim(v_corrections->>'customer_phone'),'') else s.customer_phone end, customer_email=case when v_corrections?'customer_email' then nullif(trim(v_corrections->>'customer_email'),'') else s.customer_email end, service_address=case when v_corrections?'service_address' then trim(coalesce(v_corrections->>'service_address','')) else s.service_address end, provider_order_number=case when v_corrections?'provider_order_number' then nullif(trim(v_corrections->>'provider_order_number'),'') else s.provider_order_number end, provider_account_number=case when v_corrections?'provider_account_number' then nullif(trim(v_corrections->>'provider_account_number'),'') else s.provider_account_number end, install_date=case when v_corrections?'install_date' then nullif(v_corrections->>'install_date','')::date else s.install_date end, order_date=case when v_corrections?'order_date' then nullif(v_corrections->>'order_date','')::date else s.order_date end, isp=case when v_corrections?'isp' then trim(coalesce(v_corrections->>'isp','')) else s.isp end, internet_product=case when v_corrections?'internet_product' then nullif(trim(v_corrections->>'internet_product'),'') else s.internet_product end, internet_speed_mbps=case when v_corrections?'internet_speed_mbps' then nullif(v_corrections->>'internet_speed_mbps','')::integer else s.internet_speed_mbps end, notes=case when v_corrections?'notes' then nullif(v_corrections->>'notes','') else s.notes end, verification_status=case when s.verification_status='verified_processed' then s.verification_status else 'pending_verification' end, verification_reason=case when s.verification_status='verified_processed' then s.verification_reason else 'rep_details_updated_pending_isp_admin_verification' end where s.id=p_sale_id returning * into v_after;
 insert into public.sale_rep_detail_history(sale_id,organization_id,changed_by,changed_by_email,before_sale,after_sale,corrections) values(p_sale_id,v_org,v_actor,coalesce(v_email,''),to_jsonb(v_before),to_jsonb(v_after),v_corrections);
 return v_after;
end;$function$;
revoke all on function public.save_my_sale_details(uuid,jsonb) from public,anon; grant execute on function public.save_my_sale_details(uuid,jsonb) to authenticated;
