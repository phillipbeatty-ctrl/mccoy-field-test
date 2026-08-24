-- Restore Admin-managed Ghost records while preserving Ghost-account sale simulations.
-- Test sales remain auditable ranking/accounting evidence, but the authoritative
-- Ghost leaderboard totals come from the Admin-set day/week/month/year limits.

alter function private.apply_ghost_actual_rankings(jsonb,jsonb)
  rename to apply_ghost_actual_rankings_from_test_sales;

create or replace function private.apply_ghost_actual_rankings(p_result jsonb,p_metrics jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_settings public.ghost_ranking_settings%rowtype;
  v_metrics jsonb;
  v_result jsonb;
begin
  select * into strict v_settings
  from public.ghost_ranking_settings
  where singleton is true;

  v_metrics := coalesce(p_metrics,'{}'::jsonb) || jsonb_build_object(
    'today_sales',v_settings.day_goal,
    'week_sales',v_settings.week_goal,
    'month_sales',v_settings.month_goal,
    'year_sales',v_settings.year_goal,
    'ranking_velocity',jsonb_build_object(
      'today',jsonb_build_object('elapsed_seconds',null,'reached_at',null),
      'week',jsonb_build_object('elapsed_seconds',null,'reached_at',null),
      'month',jsonb_build_object('elapsed_seconds',null,'reached_at',null),
      'year',jsonb_build_object('elapsed_seconds',null,'reached_at',null)
    ),
    'personal_records',jsonb_build_object(
      'day',jsonb_build_object('count',v_settings.day_goal,'period_start',null,'source','admin_ghost_limit'),
      'week',jsonb_build_object('count',v_settings.week_goal,'period_start',null,'source','admin_ghost_limit'),
      'month',jsonb_build_object('count',v_settings.month_goal,'period_start',null,'source','admin_ghost_limit'),
      'year',jsonb_build_object('count',v_settings.year_goal,'period_start',null,'source','admin_ghost_limit')
    ),
    'source','admin_ghost_limits'
  );

  v_result := private.apply_ghost_actual_rankings_from_test_sales(p_result,v_metrics);
  v_result := jsonb_set(v_result,'{ghost_policy}',coalesce(v_result->'ghost_policy','{}'::jsonb) ||
    jsonb_build_object(
      'rank_source','admin_ghost_limits',
      'test_sale_policy','auditable_testing_and_accounting_not_ghost_rank_totals',
      'overtake_control','always_active',
      'all_time_record',false,
      'sales_per_hour','excluded'
    ),true);
  v_result := jsonb_set(v_result,'{ghost_admin_settings}',jsonb_build_object(
    'can_edit',true,
    'day_goal',v_settings.day_goal,
    'week_goal',v_settings.week_goal,
    'month_goal',v_settings.month_goal,
    'year_goal',v_settings.year_goal,
    'minimums',jsonb_build_object('day',3,'week',15,'month',30,'year',600),
    'updated_at',v_settings.updated_at,
    'overtake_control','always_active',
    'rank_source','admin_ghost_limits'
  ),true);
  return v_result;
end;
$function$;

revoke all on function private.apply_ghost_actual_rankings(jsonb,jsonb)
  from public,anon,authenticated,service_role;
revoke all on function private.apply_ghost_actual_rankings_from_test_sales(jsonb,jsonb)
  from public,anon,authenticated,service_role;

grant execute on function public.admin_set_ghost_ranking_goals(integer,integer,integer,integer)
  to authenticated;

comment on function public.admin_set_ghost_ranking_goals(integer,integer,integer,integer) is
  'Admin-only audited Ghost leaderboard record editor for day, week, month, and year. Test sales remain auditable but do not replace these limits.';

comment on function private.apply_ghost_actual_rankings(jsonb,jsonb) is
  'Applies Admin-set Ghost limits to authoritative period rankings while preserving Ghost test-sale audit/accounting metrics.';
