-- Owner-authorized cross-provider identity control.
-- Exact ISP seller evidence for Rashon Durr belongs to Dustin Gallagher.
do $$
declare
  v_target_id uuid;
  v_target_email text;
  v_target_name text;
  v_actor_id uuid;
  v_actor_email text;
  v_identity record;
  v_sale record;
  v_reason constant text := 'Owner control: all ISP sales labeled Rashon Durr belong to Dustin Gallagher';
begin
  select u.id,lower(u.email),coalesce(nullif(trim(a.display_name),''),u.email)
    into v_target_id,v_target_email,v_target_name
  from auth.users u
  join public.app_user_access a on lower(a.email)=lower(u.email)
  where lower(u.email)='dustin_gallagher19@hotmail.com'
    and a.active is true;
  if v_target_id is null then
    raise exception 'active_dustin_gallagher_account_required';
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
    private.provider_identity_key('Rashon Durr'),'Rashon Durr',v_target_id,v_target_email,v_target_name,
    'owner_control:rashon_durr_to_dustin_gallagher'
  )
  on conflict(identity_key) do update
  set provider_identity_name=excluded.provider_identity_name,
      rep_user_id=excluded.rep_user_id,
      rep_email=excluded.rep_email,
      rep_name=excluded.rep_name,
      active=true,
      assigned_at=now(),
      assigned_by=excluded.assigned_by;

  -- Seed exact provider identifiers already present in corporate evidence. Future
  -- providers and identifiers are added by the global identity trigger on import.
  for v_identity in
    select distinct p.provider,
      coalesce(nullif(trim(p.seller_identifier),''),nullif(trim(p.seller_name),''),'Rashon Durr') as seller_identifier,
      coalesce(nullif(trim(p.seller_name),''),'Rashon Durr') as seller_name
    from public.provider_sales_rows p
    where private.provider_identity_key(coalesce(p.seller_name,''))=private.provider_identity_key('Rashon Durr')
       or private.provider_identity_key(coalesce(p.seller_identifier,''))=private.provider_identity_key('Rashon Durr')
       or private.provider_identity_key(coalesce(p.seller_email,''))=private.provider_identity_key('Rashon Durr')
  loop
    update public.provider_seller_links l
    set active=false,updated_at=now()
    where l.provider=v_identity.provider
      and l.rep_user_id<>v_target_id
      and (
        private.provider_identity_key(l.seller_identifier)=private.provider_identity_key(v_identity.seller_identifier)
        or private.provider_identity_key(coalesce(l.seller_name,''))=private.provider_identity_key('Rashon Durr')
      );

    insert into public.provider_seller_links(
      rep_user_id,rep_email,provider,seller_identifier,seller_name,active,updated_at
    ) values (
      v_target_id,v_target_email,v_identity.provider,v_identity.seller_identifier,'Rashon Durr',true,now()
    )
    on conflict(rep_user_id,provider,seller_identifier) do update
    set rep_email=excluded.rep_email,
        seller_name=excluded.seller_name,
        active=true,
        updated_at=excluded.updated_at;
  end loop;

  -- Re-run existing evidence. The global identity trigger handles future rows;
  -- the existing materialization and completeness gates decide ranking/pay state.
  update public.provider_sales_rows p
  set materialization_reason=p.materialization_reason
  where private.provider_identity_key(coalesce(p.seller_name,''))=private.provider_identity_key('Rashon Durr')
     or private.provider_identity_key(coalesce(p.seller_identifier,''))=private.provider_identity_key('Rashon Durr')
     or private.provider_identity_key(coalesce(p.seller_email,''))=private.provider_identity_key('Rashon Durr');

  -- Reassign every already-materialized Rashon sale through the audited Admin
  -- RPC. The provider-facing name remains Rashon Durr as immutable evidence.
  perform set_config('request.jwt.claim.sub',v_actor_id::text,true);
  for v_sale in
    select distinct s.id,s.rep_user_id
    from public.provider_sales_rows p
    join public.sales_records s on s.id=p.materialized_sale_id
    where private.provider_identity_key(coalesce(p.seller_name,''))=private.provider_identity_key('Rashon Durr')
       or private.provider_identity_key(coalesce(p.seller_identifier,''))=private.provider_identity_key('Rashon Durr')
       or private.provider_identity_key(coalesce(p.seller_email,''))=private.provider_identity_key('Rashon Durr')
    order by s.id
  loop
    if v_sale.rep_user_id<>v_target_id then
      perform public.admin_reassign_sale_credit(v_sale.id,v_target_id,v_reason);
    end if;
    update public.sales_records s
    set provider_reported_rep_user_id=v_target_id,
        provider_reported_rep_email=v_target_email,
        provider_reported_rep_name='Rashon Durr'
    where s.id=v_sale.id;
  end loop;
end
$$;
