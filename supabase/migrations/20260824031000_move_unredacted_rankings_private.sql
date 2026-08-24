-- The first production application of the Ghost-visibility wrapper briefly
-- retained its internal ranking calculator in public. Move that implementation
-- behind the private schema; only the filtered public RPC remains callable.
alter function public.get_verified_sales_rankings_unredacted()
  set schema private;

revoke all on function private.get_verified_sales_rankings_unredacted()
  from public, anon, authenticated, service_role;

create or replace function public.get_verified_sales_rankings()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth, private
as $function$
declare
  v_requester_email text;
  v_requester_role text;
  v_requester_name text;
  v_ghost_email text;
  v_is_admin boolean := false;
  v_is_ghost boolean := false;
  v_can_see_ghost_numbers boolean := false;
  v_result jsonb;
  v_goals jsonb;
  v_rankings jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  select lower(trim(u.email))
  into v_requester_email
  from auth.users u
  where u.id = (select auth.uid());

  select lower(trim(a.role)), lower(trim(a.display_name))
  into v_requester_role, v_requester_name
  from public.app_user_access a
  where lower(trim(a.email)) = v_requester_email
    and a.active is true;

  if v_requester_role is null then
    raise exception 'active_mccoy_access_required' using errcode = '42501';
  end if;

  select lower(trim(s.ghost_email)), jsonb_build_object(
    'day_goal', s.day_goal,
    'week_goal', s.week_goal,
    'month_goal', s.month_goal,
    'year_goal', s.year_goal
  )
  into v_ghost_email, v_goals
  from public.ghost_ranking_settings s
  where s.singleton is true;

  v_is_admin := v_requester_role = 'admin';
  v_is_ghost := v_requester_email = v_ghost_email
    and v_requester_name = 'ghost';
  v_can_see_ghost_numbers := v_is_admin or v_is_ghost;

  v_result := private.get_verified_sales_rankings_unredacted();

  select coalesce(
    jsonb_agg(
      private.filter_ghost_ranking_numbers(entry.item, v_can_see_ghost_numbers, v_goals)
      order by entry.ordinality
    ),
    '[]'::jsonb
  )
  into v_rankings
  from jsonb_array_elements(coalesce(v_result->'rankings', '[]'::jsonb))
    with ordinality as entry(item, ordinality);

  v_result := jsonb_set(v_result, '{rankings}', v_rankings, true);

  if coalesce((v_result#>>'{current_rep,is_ghost}')::boolean, false) is true then
    v_result := jsonb_set(
      v_result,
      '{current_rep}',
      private.filter_ghost_ranking_numbers(
        v_result->'current_rep',
        v_can_see_ghost_numbers,
        v_goals
      ),
      true
    );
  end if;

  v_result := jsonb_set(
    v_result,
    '{ghost_number_visibility}',
    to_jsonb('admin_and_ghost_only'::text),
    true
  );

  return v_result;
end;
$function$;

revoke all on function public.get_verified_sales_rankings()
  from public, anon;
grant execute on function public.get_verified_sales_rankings()
  to authenticated, service_role;
