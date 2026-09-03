begin;

create or replace function private.sync_app_access_identity(
  p_organization_id uuid,
  p_auth_user_id uuid,
  p_email text,
  p_role text,
  p_active boolean,
  p_display_name text,
  p_team_name text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, auth
as $$
declare
  v_auth_email text;
  v_auth_deleted_at timestamptz;
  v_normalized_email text := lower(btrim(coalesce(p_email,'')));
  v_role text := lower(btrim(coalesce(p_role,'')));
  v_profile_role text;
  v_display_name text;
  v_first_name text;
  v_last_name text;
  v_team_id uuid;
  v_now timestamptz := clock_timestamp();
begin
  if p_organization_id is null then
    raise exception 'organization_id_required' using errcode='23514';
  end if;
  if p_auth_user_id is null then
    raise exception 'auth_user_id_required' using errcode='23514';
  end if;

  select lower(u.email),u.deleted_at
  into v_auth_email,v_auth_deleted_at
  from auth.users u
  where u.id=p_auth_user_id;

  if coalesce(p_active,false) and (v_auth_email is null or v_auth_deleted_at is not null) then
    raise exception 'active_auth_user_required' using errcode='23514';
  end if;
  if v_auth_email is null and not coalesce(p_active,false) then
    v_auth_email := nullif(v_normalized_email,'');
  end if;
  if v_auth_email is null then
    raise exception 'auth_user_identity_required' using errcode='23514';
  end if;
  if v_normalized_email='' or v_normalized_email<>v_auth_email then
    raise exception 'auth_email_mismatch' using errcode='23514';
  end if;
  if v_role not in ('admin','manager','trainer','rep','tester') then
    raise exception 'invalid_app_user_role' using errcode='23514';
  end if;
  if not exists(select 1 from public.organizations o where o.id=p_organization_id) then
    raise exception 'organization_not_found' using errcode='23503';
  end if;

  v_profile_role := case when v_role='tester' then 'rep' else v_role end;
  v_display_name := nullif(regexp_replace(btrim(coalesce(p_display_name,'')),'\s+',' ','g'),'');
  if v_display_name is null then v_display_name := split_part(v_auth_email,'@',1); end if;
  v_first_name := split_part(v_display_name,' ',1);
  v_last_name := nullif(btrim(substr(v_display_name,length(v_first_name)+1)),'');

  if nullif(btrim(coalesce(p_team_name,'')),'') is not null then
    select t.id
    into v_team_id
    from public.teams t
    where t.organization_id=p_organization_id
      and t.name=btrim(p_team_name)
      and t.active
    order by t.created_at asc
    limit 1;
  end if;

  if not coalesce(p_active,false) then
    update public.organization_memberships
    set email=v_auth_email,
        role=v_role,
        active=false,
        is_default=false,
        updated_at=v_now
    where organization_id=p_organization_id
      and auth_user_id=p_auth_user_id;

    update public.users
    set email=v_auth_email,
        first_name=v_first_name,
        last_name=v_last_name,
        role=v_profile_role,
        team_id=v_team_id,
        active=false
    where auth_user_id=p_auth_user_id
      and organization_id=p_organization_id;

    return jsonb_build_object(
      'ok',true,
      'organization_id',p_organization_id,
      'auth_user_id',p_auth_user_id,
      'email',v_auth_email,
      'role',v_role,
      'active',false
    );
  end if;

  insert into public.users(
    id,auth_user_id,email,first_name,last_name,role,team_id,active,organization_id
  ) values (
    p_auth_user_id,p_auth_user_id,v_auth_email,v_first_name,v_last_name,
    v_profile_role,v_team_id,true,p_organization_id
  )
  on conflict (auth_user_id) do update
  set email=excluded.email,
      first_name=excluded.first_name,
      last_name=excluded.last_name,
      role=excluded.role,
      team_id=excluded.team_id,
      active=true,
      organization_id=excluded.organization_id;

  update public.organization_memberships
  set is_default=false,
      updated_at=v_now
  where auth_user_id=p_auth_user_id
    and organization_id<>p_organization_id
    and active
    and is_default;

  insert into public.organization_memberships(
    organization_id,auth_user_id,email,role,active,is_default,created_at,updated_at
  ) values (
    p_organization_id,p_auth_user_id,v_auth_email,v_role,true,true,v_now,v_now
  )
  on conflict (organization_id,auth_user_id) do update
  set email=excluded.email,
      role=excluded.role,
      active=true,
      is_default=true,
      updated_at=excluded.updated_at;

  return jsonb_build_object(
    'ok',true,
    'organization_id',p_organization_id,
    'auth_user_id',p_auth_user_id,
    'email',v_auth_email,
    'role',v_role,
    'active',true,
    'is_default',true
  );
end
$$;

create or replace function private.sync_app_user_access_identity_trigger()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private, auth
as $$
declare
  v_auth_user_id uuid;
  v_old_auth_user_id uuid;
begin
  if tg_op='DELETE' then
    select coalesce(
      (
        select u.id
        from auth.users u
        where lower(u.email)=lower(old.email)
        order by u.created_at desc
        limit 1
      ),
      (
        select m.auth_user_id
        from public.organization_memberships m
        where m.organization_id=old.organization_id
          and lower(m.email)=lower(old.email)
        order by m.is_default desc,m.updated_at desc
        limit 1
      ),
      (
        select p.auth_user_id
        from public.users p
        where p.organization_id=old.organization_id
          and lower(p.email)=lower(old.email)
        limit 1
      )
    ) into v_old_auth_user_id;
    if v_old_auth_user_id is not null then
      perform private.sync_app_access_identity(
        old.organization_id,v_old_auth_user_id,old.email,old.role,false,
        old.display_name,old.team_name
      );
    end if;
    return old;
  end if;

  if tg_op='UPDATE'
     and (old.organization_id is distinct from new.organization_id
          or lower(old.email) is distinct from lower(new.email)) then
    select coalesce(
      (
        select u.id
        from auth.users u
        where lower(u.email)=lower(old.email)
        order by u.created_at desc
        limit 1
      ),
      (
        select m.auth_user_id
        from public.organization_memberships m
        where m.organization_id=old.organization_id
          and lower(m.email)=lower(old.email)
        order by m.is_default desc,m.updated_at desc
        limit 1
      ),
      (
        select p.auth_user_id
        from public.users p
        where p.organization_id=old.organization_id
          and lower(p.email)=lower(old.email)
        limit 1
      )
    ) into v_old_auth_user_id;
    if v_old_auth_user_id is not null then
      perform private.sync_app_access_identity(
        old.organization_id,v_old_auth_user_id,old.email,old.role,false,
        old.display_name,old.team_name
      );
    end if;
  end if;

  if new.active then
    select u.id into v_auth_user_id
    from auth.users u
    where lower(u.email)=lower(new.email)
      and u.deleted_at is null
    order by u.created_at desc
    limit 1;
  else
    select coalesce(
      (
        select u.id
        from auth.users u
        where lower(u.email)=lower(new.email)
        order by u.created_at desc
        limit 1
      ),
      (
        select m.auth_user_id
        from public.organization_memberships m
        where m.organization_id=new.organization_id
          and lower(m.email)=lower(new.email)
        order by m.is_default desc,m.updated_at desc
        limit 1
      ),
      (
        select p.auth_user_id
        from public.users p
        where p.organization_id=new.organization_id
          and lower(p.email)=lower(new.email)
        limit 1
      )
    ) into v_auth_user_id;
  end if;

  if v_auth_user_id is null then
    if new.active then
      raise exception 'active_access_requires_auth_account' using errcode='23514';
    end if;
    return new;
  end if;

  perform private.sync_app_access_identity(
    new.organization_id,v_auth_user_id,new.email,new.role,new.active,
    new.display_name,new.team_name
  );
  return new;
end
$$;

revoke all on function private.sync_app_access_identity(uuid,uuid,text,text,boolean,text,text)
  from public,anon,authenticated,service_role;
revoke all on function private.sync_app_user_access_identity_trigger()
  from public,anon,authenticated,service_role;

commit;