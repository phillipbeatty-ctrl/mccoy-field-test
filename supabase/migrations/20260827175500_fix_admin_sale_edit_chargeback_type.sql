create or replace function public.admin_edit_any_sale(
  p_sale_id uuid,
  p_changes jsonb default '{}'::jsonb
)
returns public.sales_records
language plpgsql
security definer
set search_path = pg_catalog, public, auth, private
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_email text;
  v_org uuid;
  v_before public.sales_records%rowtype;
  v_after public.sales_records%rowtype;
  v_changes jsonb := coalesce(p_changes,'{}'::jsonb);
  v_unknown text[];
begin
  if v_actor is null then raise exception 'Authentication required'; end if;

  select lower(u.email), a.organization_id
    into v_actor_email, v_org
  from auth.users u
  join public.app_user_access a on lower(a.email)=lower(u.email)
  where u.id=v_actor and a.active=true and lower(a.role)='admin';
  if v_org is null then raise exception 'Admin access required'; end if;

  select * into v_before
  from public.sales_records
  where id=p_sale_id and organization_id=v_org
  for update;
  if not found then raise exception 'Sale not found in Admin organization'; end if;

  select array_agg(k) into v_unknown
  from jsonb_object_keys(v_changes) k
  where k not in (
    'customer_first_name','customer_last_name','customer_phone','customer_email','service_address',
    'provider_order_number','provider_account_number','install_date','order_date','isp','internet_product',
    'internet_speed_mbps','voip_home_phone_lines','directv','directv_service','vivint','vivint_service',
    'mobile_phone_lines','mobile_device_count','mobile_device_protection','att_mobile_lines','att_device_count',
    'att_device_protection','att_total_home_care','notes','rep_email','rep_name','rep_user_id','lead_label',
    'sale_status','verification_status','verification_reason','competition_eligible','ranking_eligible','ranking_verified_at',
    'commission_gross_amount','commission_paid_amount','commission_paid_at','commission_chargeback_amount','commission_chargeback_applied'
  );
  if v_unknown is not null then raise exception 'Unsupported sale field(s): %',array_to_string(v_unknown,', '); end if;

  update public.sales_records s set
    customer_first_name = case when v_changes ? 'customer_first_name' then nullif(trim(v_changes->>'customer_first_name'),'') else s.customer_first_name end,
    customer_last_name = case when v_changes ? 'customer_last_name' then nullif(trim(v_changes->>'customer_last_name'),'') else s.customer_last_name end,
    customer_phone = case when v_changes ? 'customer_phone' then nullif(trim(v_changes->>'customer_phone'),'') else s.customer_phone end,
    customer_email = case when v_changes ? 'customer_email' then nullif(trim(v_changes->>'customer_email'),'') else s.customer_email end,
    service_address = case when v_changes ? 'service_address' then nullif(trim(v_changes->>'service_address'),'') else s.service_address end,
    provider_order_number = case when v_changes ? 'provider_order_number' then nullif(trim(v_changes->>'provider_order_number'),'') else s.provider_order_number end,
    provider_account_number = case when v_changes ? 'provider_account_number' then nullif(trim(v_changes->>'provider_account_number'),'') else s.provider_account_number end,
    install_date = case when v_changes ? 'install_date' then nullif(v_changes->>'install_date','')::date else s.install_date end,
    order_date = case when v_changes ? 'order_date' then nullif(v_changes->>'order_date','')::date else s.order_date end,
    isp = case when v_changes ? 'isp' then nullif(trim(v_changes->>'isp'),'') else s.isp end,
    internet_product = case when v_changes ? 'internet_product' then nullif(trim(v_changes->>'internet_product'),'') else s.internet_product end,
    internet_speed_mbps = case when v_changes ? 'internet_speed_mbps' then nullif(v_changes->>'internet_speed_mbps','')::integer else s.internet_speed_mbps end,
    voip_home_phone_lines = case when v_changes ? 'voip_home_phone_lines' then nullif(v_changes->>'voip_home_phone_lines','')::integer else s.voip_home_phone_lines end,
    directv = case when v_changes ? 'directv' then coalesce((v_changes->>'directv')::boolean,false) else s.directv end,
    directv_service = case when v_changes ? 'directv_service' then nullif(trim(v_changes->>'directv_service'),'') else s.directv_service end,
    vivint = case when v_changes ? 'vivint' then coalesce((v_changes->>'vivint')::boolean,false) else s.vivint end,
    vivint_service = case when v_changes ? 'vivint_service' then nullif(trim(v_changes->>'vivint_service'),'') else s.vivint_service end,
    mobile_phone_lines = case when v_changes ? 'mobile_phone_lines' then nullif(v_changes->>'mobile_phone_lines','')::integer else s.mobile_phone_lines end,
    mobile_device_count = case when v_changes ? 'mobile_device_count' then nullif(v_changes->>'mobile_device_count','')::integer else s.mobile_device_count end,
    mobile_device_protection = case when v_changes ? 'mobile_device_protection' then coalesce((v_changes->>'mobile_device_protection')::boolean,false) else s.mobile_device_protection end,
    att_mobile_lines = case when v_changes ? 'att_mobile_lines' then nullif(v_changes->>'att_mobile_lines','')::integer else s.att_mobile_lines end,
    att_device_count = case when v_changes ? 'att_device_count' then nullif(v_changes->>'att_device_count','')::integer else s.att_device_count end,
    att_device_protection = case when v_changes ? 'att_device_protection' then coalesce((v_changes->>'att_device_protection')::boolean,false) else s.att_device_protection end,
    att_total_home_care = case when v_changes ? 'att_total_home_care' then coalesce((v_changes->>'att_total_home_care')::boolean,false) else s.att_total_home_care end,
    notes = case when v_changes ? 'notes' then nullif(v_changes->>'notes','') else s.notes end,
    rep_email = case when v_changes ? 'rep_email' then nullif(lower(trim(v_changes->>'rep_email')),'') else s.rep_email end,
    rep_name = case when v_changes ? 'rep_name' then nullif(trim(v_changes->>'rep_name'),'') else s.rep_name end,
    rep_user_id = case when v_changes ? 'rep_user_id' then nullif(v_changes->>'rep_user_id','')::uuid else s.rep_user_id end,
    lead_label = case when v_changes ? 'lead_label' then nullif(trim(v_changes->>'lead_label'),'') else s.lead_label end,
    sale_status = case when v_changes ? 'sale_status' then nullif(trim(v_changes->>'sale_status'),'') else s.sale_status end,
    verification_status = case when v_changes ? 'verification_status' then nullif(trim(v_changes->>'verification_status'),'') else s.verification_status end,
    verification_reason = case when v_changes ? 'verification_reason' then nullif(v_changes->>'verification_reason','') else s.verification_reason end,
    competition_eligible = case when v_changes ? 'competition_eligible' then coalesce((v_changes->>'competition_eligible')::boolean,false) else s.competition_eligible end,
    ranking_eligible = case when v_changes ? 'ranking_eligible' then coalesce((v_changes->>'ranking_eligible')::boolean,false) else s.ranking_eligible end,
    ranking_verified_at = case when v_changes ? 'ranking_verified_at' then nullif(v_changes->>'ranking_verified_at','')::timestamptz else s.ranking_verified_at end,
    commission_gross_amount = case when v_changes ? 'commission_gross_amount' then nullif(v_changes->>'commission_gross_amount','')::numeric else s.commission_gross_amount end,
    commission_paid_amount = case when v_changes ? 'commission_paid_amount' then nullif(v_changes->>'commission_paid_amount','')::numeric else s.commission_paid_amount end,
    commission_paid_at = case when v_changes ? 'commission_paid_at' then nullif(v_changes->>'commission_paid_at','')::timestamptz else s.commission_paid_at end,
    commission_chargeback_amount = case when v_changes ? 'commission_chargeback_amount' then nullif(v_changes->>'commission_chargeback_amount','')::numeric else s.commission_chargeback_amount end,
    commission_chargeback_applied = case when v_changes ? 'commission_chargeback_applied' then coalesce(nullif(v_changes->>'commission_chargeback_applied','')::numeric,0) else s.commission_chargeback_applied end
  where s.id=p_sale_id
  returning * into v_after;

  insert into public.sale_admin_edit_history(sale_id,organization_id,changed_by,changed_by_email,action,before_sale,after_sale)
  values(p_sale_id,v_org,v_actor,v_actor_email,'edit',to_jsonb(v_before),to_jsonb(v_after));

  return v_after;
end;
$$;

revoke all on function public.admin_edit_any_sale(uuid,jsonb) from public;
grant execute on function public.admin_edit_any_sale(uuid,jsonb) to authenticated;

comment on function public.admin_edit_any_sale(uuid,jsonb)
is 'Allows organization-scoped Admins to edit allow-listed sale fields with audit history. commission_chargeback_applied remains numeric to match sales_records.';
