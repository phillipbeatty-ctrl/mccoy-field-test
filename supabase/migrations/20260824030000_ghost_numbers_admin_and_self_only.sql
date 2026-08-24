-- Ghost benchmark numbers are private to the original Admin and the exact
-- Ghost account. Placement remains visible under the existing benchmark rule,
-- but no ordinary user or team lead receives the underlying Ghost totals.

alter function public.get_verified_sales_rankings()
  rename to get_verified_sales_rankings_unredacted;
alter function public.get_verified_sales_rankings_unredacted()
  set schema private;

revoke all on function private.get_verified_sales_rankings_unredacted()
  from public, anon, authenticated;

create or replace function private.filter_ghost_ranking_numbers(
  p_item jsonb,
  p_can_see boolean,
  p_goals jsonb
)
returns jsonb
language plpgsql
immutable
set search_path = pg_catalog
as $function$
declare
  v_item jsonb := coalesce(p_item, '{}'::jsonb);
  v_period text;
  v_record_period text;
  v_goal_key text;
  v_state jsonb;
begin
  if coalesce((v_item->>'is_ghost')::boolean, false) is not true then
    return v_item;
  end if;

  if p_can_see then
    v_item := jsonb_set(v_item, '{today_sales}', coalesce(p_goals->'day_goal', 'null'::jsonb), true);
    v_item := jsonb_set(v_item, '{week_sales}', coalesce(p_goals->'week_goal', 'null'::jsonb), true);
    v_item := jsonb_set(v_item, '{month_sales}', coalesce(p_goals->'month_goal', 'null'::jsonb), true);
    v_item := jsonb_set(v_item, '{year_sales}', coalesce(p_goals->'year_goal', 'null'::jsonb), true);
    v_item := jsonb_set(v_item, '{month_mobile_lines}', '0'::jsonb, true);
    v_item := jsonb_set(v_item, '{month_directv}', '0'::jsonb, true);
    v_item := jsonb_set(v_item, '{month_vivint}', '0'::jsonb, true);
    v_item := jsonb_set(v_item, '{pending_review_sales}', '0'::jsonb, true);

    foreach v_record_period in array array['day','week','month','year'] loop
      v_goal_key := v_record_period || '_goal';
      v_item := jsonb_set(
        v_item,
        array['personal_records', v_record_period, 'count'],
        coalesce(p_goals->v_goal_key, 'null'::jsonb),
        true
      );
    end loop;
  else
    v_item := jsonb_set(v_item, '{today_sales}', 'null'::jsonb, true);
    v_item := jsonb_set(v_item, '{week_sales}', 'null'::jsonb, true);
    v_item := jsonb_set(v_item, '{month_sales}', 'null'::jsonb, true);
    v_item := jsonb_set(v_item, '{year_sales}', 'null'::jsonb, true);
    v_item := jsonb_set(v_item, '{all_time_sales}', 'null'::jsonb, true);
    v_item := jsonb_set(v_item, '{month_mobile_lines}', 'null'::jsonb, true);
    v_item := jsonb_set(v_item, '{month_directv}', 'null'::jsonb, true);
    v_item := jsonb_set(v_item, '{month_vivint}', 'null'::jsonb, true);
    v_item := jsonb_set(v_item, '{pending_review_sales}', 'null'::jsonb, true);

    foreach v_record_period in array array['day','week','month','year'] loop
      v_item := jsonb_set(
        v_item,
        array['personal_records', v_record_period, 'count'],
        'null'::jsonb,
        true
      );
    end loop;
  end if;

  foreach v_period in array array['today','week','month','year'] loop
    v_state := coalesce(v_item#>array['ghost_visibility', v_period], '{}'::jsonb);
    v_state := jsonb_set(v_state, '{revealed}', to_jsonb(p_can_see), true);
    if not p_can_see then
      v_state := v_state - 'beaten_by';
    end if;
    v_item := jsonb_set(v_item, array['ghost_visibility', v_period], v_state, true);
  end loop;

  return v_item || jsonb_build_object(
    'ghost_numbers_hidden', not p_can_see,
    'ghost_numbers_visible_to', 'admin_and_ghost'
  );
end;
$function$;

revoke all on function private.filter_ghost_ranking_numbers(jsonb, boolean, jsonb)
  from public, anon, authenticated;

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

comment on function public.get_verified_sales_rankings() is
  'Authoritative sales rankings. Ghost placement is public to authenticated McCoy users under the benchmark rule, but Ghost numeric totals are returned only to an active Admin or the exact active Ghost account.';
