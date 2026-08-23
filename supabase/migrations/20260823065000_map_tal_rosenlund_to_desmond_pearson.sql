-- Owner-authorized cross-provider identity control.
-- Exact ISP seller evidence for Tal Rosenlund belongs to Desmond Pearson.
do $$
declare
  v_target_id uuid;
  v_target_email text;
  v_target_name text;
  v_actor_id uuid;
  v_actor_email text;
  v_identity record;
  v_sale record;
  v_reason constant text := 'Owner control: all ISP sales labeled Tal Rosenlund belong to Desmond Pearson';
begin
  select u.id,lower(u.email),coalesce(nullif(trim(a.display_name),''),u.email)
    into v_target_id,v_target_email,v_target_name
  from auth.users u
  join public.app_user_access a on lower(a.email)=lower(u.email)
  where lower(u.email)='desmondpearson11@gmail.com'
    and a.active is true;
  if v_target_id is null then
    raise exception 'active_desmond_pearson_account_required';
  end if;

  select u.id,lower(u.email)
    into v_actor_id,v_actor_email
  from auth.users u
  join public.app_user_access a on lower(a.email)=lower(u.email)
  where lower(u.email)='phillip.beatty@gmail.com'
    and a.active is true
    and lower(a.role)='admin';
  if v_actor_id is null then
    raise exception 'original_owner_admin_required';
  end if;

  insert into public.global_provider_identity_links(
    identity_key,provider_identity_name,rep_user_id,rep_email,rep_name,assigned_by
  ) values (
    private.provider_identity_key('Tal Rosenlund'),'Tal Rosenlund',v_target_id,v_target_email,v_target_name,
    'owner_control:tal_rosenlund_to_desmond_pearson'
  )
  on conflict(identity_key) do update
  set provider_identity_name=excluded.provider_identity_name,
      rep_user_id=excluded.rep_user_id,
      rep_email=excluded.rep_email,
      rep_name=excluded.rep_name,
      active=true,
      assigned_at=now(),
      assigned_by=excluded.assigned_by;

  for v_identity in
    select distinct p.provider,
      coalesce(nullif(trim(p.seller_identifier),''),nullif(trim(p.seller_name),''),'Tal Rosenlund') as seller_identifier,
      coalesce(nullif(trim(p.seller_name),''),'Tal Rosenlund') as seller_name
    from public.provider_sales_rows p
    where private.provider_identity_key(coalesce(p.seller_name,''))=private.provider_identity_key('Tal Rosenlund')
       or private.provider_identity_key(coalesce(p.seller_identifier,''))=private.provider_identity_key('Tal Rosenlund')
       or private.provider_identity_key(coalesce(p.seller_email,''))=private.provider_identity_key('Tal Rosenlund')
  loop
    update public.provider_seller_links l
    set active=false,updated_at=now()
    where l.provider=v_identity.provider
      and l.rep_user_id<>v_target_id
      and (
        private.provider_identity_key(l.seller_identifier)=private.provider_identity_key(v_identity.seller_identifier)
        or private.provider_identity_key(coalesce(l.seller_name,''))=private.provider_identity_key('Tal Rosenlund')
      );

    insert into public.provider_seller_links(
      rep_user_id,rep_email,provider,seller_identifier,seller_name,active,updated_at
    ) values (
      v_target_id,v_target_email,v_identity.provider,v_identity.seller_identifier,'Tal Rosenlund',true,now()
    )
    on conflict(rep_user_id,provider,seller_identifier) do update
    set rep_email=excluded.rep_email,
        seller_name=excluded.seller_name,
        active=true,
        updated_at=excluded.updated_at;
  end loop;

  update public.provider_sales_rows p
  set materialization_reason=p.materialization_reason
  where private.provider_identity_key(coalesce(p.seller_name,''))=private.provider_identity_key('Tal Rosenlund')
     or private.provider_identity_key(coalesce(p.seller_identifier,''))=private.provider_identity_key('Tal Rosenlund')
     or private.provider_identity_key(coalesce(p.seller_email,''))=private.provider_identity_key('Tal Rosenlund');

  perform set_config('request.jwt.claim.sub',v_actor_id::text,true);
  for v_sale in
    select distinct s.id,s.rep_user_id
    from public.provider_sales_rows p
    join public.sales_records s on s.id=p.materialized_sale_id
    where private.provider_identity_key(coalesce(p.seller_name,''))=private.provider_identity_key('Tal Rosenlund')
       or private.provider_identity_key(coalesce(p.seller_identifier,''))=private.provider_identity_key('Tal Rosenlund')
       or private.provider_identity_key(coalesce(p.seller_email,''))=private.provider_identity_key('Tal Rosenlund')
    order by s.id
  loop
    if v_sale.rep_user_id<>v_target_id then
      perform public.admin_reassign_sale_credit(v_sale.id,v_target_id,v_reason);
    end if;
    update public.sales_records s
    set provider_reported_rep_user_id=v_target_id,
        provider_reported_rep_email=v_target_email,
        provider_reported_rep_name='Tal Rosenlund'
    where s.id=v_sale.id;
  end loop;
end
$$;
