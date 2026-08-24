-- Ensure every real McCoy user receives a weekly sales/hour rank. Users with
-- no tracked hours receive a 0.00 rate and rank after users with tracked time;
-- this avoids division-by-zero without excluding a real user. Ghost remains
-- the only account excluded from this metric.

create or replace function public.get_verified_sales_rankings()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_requester_email text;
  v_requester_role text;
  v_is_admin boolean := false;
  v_result jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  select lower(trim(u.email)) into v_requester_email
  from auth.users u
  where u.id = (select auth.uid());

  select lower(a.role) into v_requester_role
  from public.app_user_access a
  where lower(trim(a.email)) = v_requester_email and a.active is true;

  if v_requester_role is null then
    raise exception 'active_mccoy_access_required' using errcode = '42501';
  end if;
  v_is_admin := v_requester_role = 'admin';

  with
  settings as (
    select * from public.ghost_ranking_settings where singleton is true
  ),
  bounds as (
    select
      now() as generated_at,
      date_trunc('day', timezone('America/Los_Angeles', now())) at time zone 'America/Los_Angeles' as today_start,
      date_trunc('week', timezone('America/Los_Angeles', now())) at time zone 'America/Los_Angeles' as week_start,
      date_trunc('month', timezone('America/Los_Angeles', now())) at time zone 'America/Los_Angeles' as month_start,
      date_trunc('year', timezone('America/Los_Angeles', now())) at time zone 'America/Los_Angeles' as year_start
  ),
  ghost_account as (
    select lower(trim(a.email)) as rep_email,
      'Ghost'::text as rep_name,
      lower(a.role) as role,
      nullif(trim(a.team_name), '') as team_name
    from public.app_user_access a, settings s
    where a.active is true and lower(trim(a.email)) = lower(trim(s.ghost_email))
  ),
  accounts as (
    select
      lower(trim(a.email)) as rep_email,
      au.id as rep_user_id,
      coalesce(nullif(trim(a.display_name), ''), 'Rep') as rep_name,
      lower(a.role) as role,
      nullif(trim(a.team_name), '') as team_name
    from public.app_user_access a
    left join auth.users au on lower(trim(au.email)) = lower(trim(a.email))
    cross join settings s
    where a.active is true
      and lower(trim(a.email)) <> lower(trim(s.ghost_email))
  ),
  eligible_sales as (
    select
      lower(trim(sr.rep_email)) as rep_email,
      coalesce(p.sale_date, sr.created_at) as ranking_at,
      greatest(coalesce(sr.att_mobile_lines, 0), coalesce(sr.mobile_phone_lines, 0)) as mobile_lines,
      coalesce(sr.directv, false) as directv,
      coalesce(sr.vivint, false) as vivint
    from public.sales_records sr
    left join public.provider_sales_rows p on p.id = sr.provider_sale_row_id
    cross join settings s
    where sr.ranking_eligible is true
      and sr.verification_status = 'verified_processed'
      and lower(trim(sr.rep_email)) <> lower(trim(s.ghost_email))
      and (
        coalesce(sr.compensation_snapshot->>'sale_origin', '') <> 'outside_system'
        or lower(coalesce(sr.compensation_snapshot#>>'{admin_approval,status}', '')) = 'approved'
      )
      and (
        coalesce(sr.compensation_snapshot->>'sale_context', '') <> 'out_of_area_phone'
        or lower(coalesce(sr.compensation_snapshot#>>'{admin_approval,status}', '')) = 'approved'
      )
  ),
  record_period_counts as (
    select e.rep_email, period.period_type, period.period_start, count(*)::int as sale_count
    from eligible_sales e
    cross join lateral (values
      ('day'::text, date_trunc('day', timezone('America/Los_Angeles', e.ranking_at))::date),
      ('week', date_trunc('week', timezone('America/Los_Angeles', e.ranking_at))::date),
      ('month', date_trunc('month', timezone('America/Los_Angeles', e.ranking_at))::date),
      ('year', date_trunc('year', timezone('America/Los_Angeles', e.ranking_at))::date)
    ) period(period_type, period_start)
    group by e.rep_email, period.period_type, period.period_start
  ),
  record_winners as (
    select r.*, row_number() over (
      partition by r.rep_email, r.period_type
      order by r.sale_count desc, r.period_start desc
    ) as record_order
    from record_period_counts r
  ),
  personal_records as (
    select r.rep_email,
      coalesce(max(r.sale_count) filter (where r.period_type='day' and r.record_order=1), 0)::int as best_day_sales,
      max(r.period_start) filter (where r.period_type='day' and r.record_order=1) as best_day_start,
      coalesce(max(r.sale_count) filter (where r.period_type='week' and r.record_order=1), 0)::int as best_week_sales,
      max(r.period_start) filter (where r.period_type='week' and r.record_order=1) as best_week_start,
      coalesce(max(r.sale_count) filter (where r.period_type='month' and r.record_order=1), 0)::int as best_month_sales,
      max(r.period_start) filter (where r.period_type='month' and r.record_order=1) as best_month_start,
      coalesce(max(r.sale_count) filter (where r.period_type='year' and r.record_order=1), 0)::int as best_year_sales,
      max(r.period_start) filter (where r.period_type='year' and r.record_order=1) as best_year_start
    from record_winners r where r.record_order=1 group by r.rep_email
  ),
  session_activity as (
    select
      ts.tester_user_id,
      ts.started_at,
      greatest(
        ts.started_at,
        least(
          case
            when ts.ended_at is not null then ts.ended_at
            when max(te.event_time) is not null and max(te.event_time) >= now() - interval '30 minutes' then now()
            when max(te.event_time) is not null then max(te.event_time)
            else least(now(), ts.started_at + interval '30 minutes')
          end,
          ts.started_at + interval '16 hours',
          now()
        )
      ) as effective_end
    from public.test_sessions ts
    left join public.test_events te on te.session_id = ts.id
    where ts.tester_user_id is not null and ts.started_at is not null
    group by ts.id, ts.tester_user_id, ts.started_at, ts.ended_at
  ),
  session_day_slices as (
    select
      sa.tester_user_id,
      d.day_start,
      greatest(
        0::numeric,
        extract(epoch from least(sa.effective_end, d.day_start + interval '1 day') - greatest(sa.started_at, d.day_start))
      ) as active_seconds
    from session_activity sa
    cross join bounds bd
    cross join lateral generate_series(
      date_trunc('day', timezone('America/Los_Angeles', sa.started_at)) at time zone 'America/Los_Angeles',
      date_trunc('day', timezone('America/Los_Angeles', sa.effective_end)) at time zone 'America/Los_Angeles',
      interval '1 day'
    ) d(day_start)
    where d.day_start >= bd.week_start
      and d.day_start < bd.week_start + interval '7 days'
  ),
  weekly_hours as (
    select tester_user_id,
      round((sum(least(daily_seconds, 57600::numeric)) / 3600)::numeric, 4) as week_tracked_hours
    from (
      select tester_user_id, day_start, sum(active_seconds) as daily_seconds
      from session_day_slices
      group by tester_user_id, day_start
    ) daily
    group by tester_user_id
  ),
  totals as (
    select a.rep_email, a.rep_user_id, a.rep_name, a.role, a.team_name,
      count(e.rep_email) filter (where e.ranking_at >= b.today_start)::int as today_sales,
      count(e.rep_email) filter (where e.ranking_at >= b.week_start)::int as week_sales,
      count(e.rep_email) filter (where e.ranking_at >= b.month_start)::int as month_sales,
      count(e.rep_email) filter (where e.ranking_at >= b.year_start)::int as year_sales,
      count(e.rep_email)::int as all_time_sales,
      extract(epoch from (
        max(e.ranking_at) filter (where e.ranking_at >= b.today_start)
        - min(e.ranking_at) filter (where e.ranking_at >= b.today_start)
      ))::numeric as today_elapsed_seconds,
      max(e.ranking_at) filter (where e.ranking_at >= b.today_start) as today_reached_at,
      extract(epoch from (
        max(e.ranking_at) filter (where e.ranking_at >= b.week_start)
        - min(e.ranking_at) filter (where e.ranking_at >= b.week_start)
      ))::numeric as week_elapsed_seconds,
      max(e.ranking_at) filter (where e.ranking_at >= b.week_start) as week_reached_at,
      extract(epoch from (
        max(e.ranking_at) filter (where e.ranking_at >= b.month_start)
        - min(e.ranking_at) filter (where e.ranking_at >= b.month_start)
      ))::numeric as month_elapsed_seconds,
      max(e.ranking_at) filter (where e.ranking_at >= b.month_start) as month_reached_at,
      extract(epoch from (
        max(e.ranking_at) filter (where e.ranking_at >= b.year_start)
        - min(e.ranking_at) filter (where e.ranking_at >= b.year_start)
      ))::numeric as year_elapsed_seconds,
      max(e.ranking_at) filter (where e.ranking_at >= b.year_start) as year_reached_at,
      extract(epoch from (max(e.ranking_at) - min(e.ranking_at)))::numeric as all_time_elapsed_seconds,
      max(e.ranking_at) as all_time_reached_at,
      count(e.rep_email) filter (where e.ranking_at >= b.today_start - interval '1 day' and e.ranking_at < b.today_start)::int as previous_today_sales,
      count(e.rep_email) filter (where e.ranking_at >= b.week_start - interval '7 days' and e.ranking_at < b.week_start)::int as previous_week_sales,
      count(e.rep_email) filter (where e.ranking_at >= b.month_start - interval '1 month' and e.ranking_at < b.month_start)::int as previous_month_sales,
      count(e.rep_email) filter (where e.ranking_at >= b.year_start - interval '1 year' and e.ranking_at < b.year_start)::int as previous_year_sales,
      extract(epoch from (
        max(e.ranking_at) filter (where e.ranking_at >= b.today_start - interval '1 day' and e.ranking_at < b.today_start)
        - min(e.ranking_at) filter (where e.ranking_at >= b.today_start - interval '1 day' and e.ranking_at < b.today_start)
      ))::numeric as previous_today_elapsed_seconds,
      max(e.ranking_at) filter (where e.ranking_at >= b.today_start - interval '1 day' and e.ranking_at < b.today_start) as previous_today_reached_at,
      extract(epoch from (
        max(e.ranking_at) filter (where e.ranking_at >= b.week_start - interval '7 days' and e.ranking_at < b.week_start)
        - min(e.ranking_at) filter (where e.ranking_at >= b.week_start - interval '7 days' and e.ranking_at < b.week_start)
      ))::numeric as previous_week_elapsed_seconds,
      max(e.ranking_at) filter (where e.ranking_at >= b.week_start - interval '7 days' and e.ranking_at < b.week_start) as previous_week_reached_at,
      extract(epoch from (
        max(e.ranking_at) filter (where e.ranking_at >= b.month_start - interval '1 month' and e.ranking_at < b.month_start)
        - min(e.ranking_at) filter (where e.ranking_at >= b.month_start - interval '1 month' and e.ranking_at < b.month_start)
      ))::numeric as previous_month_elapsed_seconds,
      max(e.ranking_at) filter (where e.ranking_at >= b.month_start - interval '1 month' and e.ranking_at < b.month_start) as previous_month_reached_at,
      extract(epoch from (
        max(e.ranking_at) filter (where e.ranking_at >= b.year_start - interval '1 year' and e.ranking_at < b.year_start)
        - min(e.ranking_at) filter (where e.ranking_at >= b.year_start - interval '1 year' and e.ranking_at < b.year_start)
      ))::numeric as previous_year_elapsed_seconds,
      max(e.ranking_at) filter (where e.ranking_at >= b.year_start - interval '1 year' and e.ranking_at < b.year_start) as previous_year_reached_at,
      coalesce(wh.week_tracked_hours, 0::numeric) as week_tracked_hours,
      case when coalesce(wh.week_tracked_hours, 0) > 0
        then round((count(e.rep_email) filter (where e.ranking_at >= b.week_start)::numeric / wh.week_tracked_hours), 4)
        else 0::numeric
      end as week_sales_per_hour,
      coalesce(sum(e.mobile_lines) filter (where e.ranking_at >= b.month_start), 0)::int as month_mobile_lines,
      count(e.rep_email) filter (where e.ranking_at >= b.month_start and e.directv)::int as month_directv,
      count(e.rep_email) filter (where e.ranking_at >= b.month_start and e.vivint)::int as month_vivint
    from accounts a cross join bounds b
    left join eligible_sales e on e.rep_email = a.rep_email
    left join weekly_hours wh on wh.tester_user_id = a.rep_user_id
    group by a.rep_email, a.rep_user_id, a.rep_name, a.role, a.team_name, wh.week_tracked_hours
  ),
  ranked as (
    select t.*,
      row_number() over (order by today_sales desc, today_elapsed_seconds asc nulls last, today_reached_at desc nulls last, week_sales desc, month_sales desc, lower(rep_name), rep_email)::int as today_rank,
      row_number() over (order by week_sales desc, week_elapsed_seconds asc nulls last, week_reached_at desc nulls last, month_sales desc, year_sales desc, lower(rep_name), rep_email)::int as week_rank,
      row_number() over (order by month_sales desc, month_elapsed_seconds asc nulls last, month_reached_at desc nulls last, year_sales desc, week_sales desc, lower(rep_name), rep_email)::int as month_rank,
      row_number() over (order by year_sales desc, year_elapsed_seconds asc nulls last, year_reached_at desc nulls last, month_sales desc, week_sales desc, lower(rep_name), rep_email)::int as year_rank,
      row_number() over (order by all_time_sales desc, all_time_elapsed_seconds asc nulls last, all_time_reached_at desc nulls last, year_sales desc, month_sales desc, lower(rep_name), rep_email)::int as all_time_rank,
      row_number() over (order by previous_today_sales desc, previous_today_elapsed_seconds asc nulls last, previous_today_reached_at desc nulls last, lower(rep_name), rep_email)::int as previous_today_rank,
      row_number() over (order by previous_week_sales desc, previous_week_elapsed_seconds asc nulls last, previous_week_reached_at desc nulls last, lower(rep_name), rep_email)::int as previous_week_rank,
      row_number() over (order by previous_month_sales desc, previous_month_elapsed_seconds asc nulls last, previous_month_reached_at desc nulls last, lower(rep_name), rep_email)::int as previous_month_rank,
      row_number() over (order by previous_year_sales desc, previous_year_elapsed_seconds asc nulls last, previous_year_reached_at desc nulls last, lower(rep_name), rep_email)::int as previous_year_rank,
      row_number() over (
        order by (week_tracked_hours > 0) desc, week_sales_per_hour desc,
          week_sales desc, week_elapsed_seconds asc nulls last, week_reached_at desc nulls last,
          lower(rep_name), rep_email
      )::int as sales_per_hour_rank
    from totals t
  ),
  pending as (
    select lower(trim(sr.rep_email)) as rep_email, count(*)::int as pending_count
    from public.sales_records sr cross join settings s
    where lower(trim(sr.rep_email)) <> lower(trim(s.ghost_email))
      and lower(coalesce(sr.sale_status, '')) <> 'cancelled'
      and not (sr.competition_eligible is true and sr.verification_status = 'verified_processed')
    group by lower(trim(sr.rep_email))
  ),
  benchmark as (
    select
      count(*) filter (where t.today_sales >= s.day_goal)::int as today_passed,
      count(*) filter (where t.week_sales >= s.week_goal)::int as week_passed,
      count(*) filter (where t.month_sales >= s.month_goal)::int as month_passed,
      count(*) filter (where t.year_sales >= s.year_goal)::int as year_passed,
      count(*) filter (where t.previous_today_sales >= s.day_goal)::int as previous_today_passed,
      count(*) filter (where t.previous_week_sales >= s.week_goal)::int as previous_week_passed,
      count(*) filter (where t.previous_month_sales >= s.month_goal)::int as previous_month_passed,
      count(*) filter (where t.previous_year_sales >= s.year_goal)::int as previous_year_passed
    from totals t cross join settings s
  ),
  real_objects as (
    select jsonb_build_object(
      'rep_name', r.rep_name, 'role', r.role, 'team_name', r.team_name,
      'today_sales', r.today_sales, 'week_sales', r.week_sales,
      'month_sales', r.month_sales, 'year_sales', r.year_sales,
      'all_time_sales', r.all_time_sales,
      'sales_per_hour', jsonb_build_object(
        'period','week','rate',r.week_sales_per_hour,'tracked_hours',r.week_tracked_hours,'rank',r.sales_per_hour_rank
      ),
      'ranking_velocity', jsonb_build_object(
        'today',jsonb_build_object('elapsed_seconds',r.today_elapsed_seconds,'reached_at',r.today_reached_at),
        'week',jsonb_build_object('elapsed_seconds',r.week_elapsed_seconds,'reached_at',r.week_reached_at),
        'month',jsonb_build_object('elapsed_seconds',r.month_elapsed_seconds,'reached_at',r.month_reached_at),
        'year',jsonb_build_object('elapsed_seconds',r.year_elapsed_seconds,'reached_at',r.year_reached_at)
      ),
      'personal_records', jsonb_build_object(
        'day', jsonb_build_object('count',coalesce(pr.best_day_sales,0),'period_start',pr.best_day_start),
        'week', jsonb_build_object('count',coalesce(pr.best_week_sales,0),'period_start',pr.best_week_start),
        'month', jsonb_build_object('count',coalesce(pr.best_month_sales,0),'period_start',pr.best_month_start),
        'year', jsonb_build_object('count',coalesce(pr.best_year_sales,0),'period_start',pr.best_year_start)
      ),
      'month_mobile_lines', r.month_mobile_lines,
      'month_directv', r.month_directv, 'month_vivint', r.month_vivint,
      'pending_review_sales', coalesce(p.pending_count, 0),
      'ranks', jsonb_build_object(
        'today', r.today_rank + case when b.today_passed < 2 and r.today_rank > b.today_passed then 1 else 0 end,
        'week', r.week_rank + case when b.week_passed < 2 and r.week_rank > b.week_passed then 1 else 0 end,
        'month', r.month_rank + case when b.month_passed < 2 and r.month_rank > b.month_passed then 1 else 0 end,
        'year', r.year_rank + case when b.year_passed < 2 and r.year_rank > b.year_passed then 1 else 0 end,
        'all_time', r.all_time_rank,
        'sales_per_hour', r.sales_per_hour_rank
      ),
      'rank_movement', jsonb_build_object(
        'today', (r.previous_today_rank + case when b.previous_today_passed < 2 and r.previous_today_rank > b.previous_today_passed then 1 else 0 end)
          - (r.today_rank + case when b.today_passed < 2 and r.today_rank > b.today_passed then 1 else 0 end),
        'week', (r.previous_week_rank + case when b.previous_week_passed < 2 and r.previous_week_rank > b.previous_week_passed then 1 else 0 end)
          - (r.week_rank + case when b.week_passed < 2 and r.week_rank > b.week_passed then 1 else 0 end),
        'month', (r.previous_month_rank + case when b.previous_month_passed < 2 and r.previous_month_rank > b.previous_month_passed then 1 else 0 end)
          - (r.month_rank + case when b.month_passed < 2 and r.month_rank > b.month_passed then 1 else 0 end),
        'year', (r.previous_year_rank + case when b.previous_year_passed < 2 and r.previous_year_rank > b.previous_year_passed then 1 else 0 end)
          - (r.year_rank + case when b.year_passed < 2 and r.year_rank > b.year_passed then 1 else 0 end)
      ),
      'is_current_user', r.rep_email = v_requester_email,
      'is_ghost', false
    ) as item,
    r.*, b.*
    from ranked r
    cross join benchmark b
    left join pending p using (rep_email)
    left join personal_records pr using (rep_email)
  ),
  ghost_object as (
    select jsonb_build_object(
      'rep_name', 'Ghost', 'role', g.role, 'team_name', g.team_name,
      'today_sales', case when v_is_admin or b.today_passed >= 1 then s.day_goal else null end,
      'week_sales', case when v_is_admin or b.week_passed >= 1 then s.week_goal else null end,
      'month_sales', case when v_is_admin or b.month_passed >= 1 then s.month_goal else null end,
      'year_sales', case when v_is_admin or b.year_passed >= 1 then s.year_goal else null end,
      'all_time_sales', null,
      'sales_per_hour', null,
      'ranking_velocity', jsonb_build_object('today',null,'week',null,'month',null,'year',null),
      'personal_records', jsonb_build_object(
        'day', jsonb_build_object('count',case when v_is_admin or b.today_passed >= 1 then s.day_goal else null end,'period_start',null,'source','admin_benchmark'),
        'week', jsonb_build_object('count',case when v_is_admin or b.week_passed >= 1 then s.week_goal else null end,'period_start',null,'source','admin_benchmark'),
        'month', jsonb_build_object('count',case when v_is_admin or b.month_passed >= 1 then s.month_goal else null end,'period_start',null,'source','admin_benchmark'),
        'year', jsonb_build_object('count',case when v_is_admin or b.year_passed >= 1 then s.year_goal else null end,'period_start',null,'source','admin_benchmark')
      ),
      'month_mobile_lines', 0, 'month_directv', 0, 'month_vivint', 0,
      'pending_review_sales', 0,
      'ranks', jsonb_build_object(
        'today', case when b.today_passed < 2 then b.today_passed + 1 else null end,
        'week', case when b.week_passed < 2 then b.week_passed + 1 else null end,
        'month', case when b.month_passed < 2 then b.month_passed + 1 else null end,
        'year', case when b.year_passed < 2 then b.year_passed + 1 else null end,
        'all_time', null,
        'sales_per_hour', null
      ),
      'rank_movement', jsonb_build_object('today',null,'week',null,'month',null,'year',null),
      'ghost_visibility', jsonb_build_object(
        'today', jsonb_build_object('visible',b.today_passed < 2,'revealed',v_is_admin or b.today_passed >= 1,'beaten_by',b.today_passed,'rank',case when b.today_passed < 2 then b.today_passed + 1 else null end),
        'week', jsonb_build_object('visible',b.week_passed < 2,'revealed',v_is_admin or b.week_passed >= 1,'beaten_by',b.week_passed,'rank',case when b.week_passed < 2 then b.week_passed + 1 else null end),
        'month', jsonb_build_object('visible',b.month_passed < 2,'revealed',v_is_admin or b.month_passed >= 1,'beaten_by',b.month_passed,'rank',case when b.month_passed < 2 then b.month_passed + 1 else null end),
        'year', jsonb_build_object('visible',b.year_passed < 2,'revealed',v_is_admin or b.year_passed >= 1,'beaten_by',b.year_passed,'rank',case when b.year_passed < 2 then b.year_passed + 1 else null end)
      ),
      'is_current_user', g.rep_email = v_requester_email,
      'is_ghost', true
    ) as item
    from ghost_account g cross join settings s cross join benchmark b
  ),
  combined_objects as (
    select item, (item#>>'{ranks,week}')::integer as week_order, lower(item->>'rep_name') as sort_name
    from real_objects
    union all
    select item, coalesce((item#>>'{ranks,week}')::integer, 2147483647), 'ghost'
    from ghost_object
  )
  select jsonb_build_object(
    'ok', true,
    'generated_at', bd.generated_at,
    'timezone', 'America/Los_Angeles',
    'eligibility_policy', 'provider_verified_ranking_credit_cancellations_accounting_only',
    'personal_record_policy', 'pacific_calendar_periods_monday_week_most_recent_tie_ghost_uses_admin_benchmarks',
    'tie_break_policy', 'equal_sales_faster_elapsed_accumulation_then_later_goal_time_wins_no_shared_rank',
    'sales_per_hour_policy', 'verified_week_sales_divided_by_capped_tracked_field_session_hours_zero_hour_users_rank_after_tracked_ghost_excluded',
    'ghost_policy', jsonb_build_object(
      'placement_rule', 'zero_reps_at_goal_rank_1_one_rep_at_goal_rank_2_two_reps_at_goal_hidden',
      'comparison', 'greater_than_or_equal',
      'goals_hidden_until_first_rep_reaches_them', true,
      'all_time_record', false
    ),
    'ghost_admin_settings', case when v_is_admin then jsonb_build_object(
      'can_edit', true,
      'day_goal', s.day_goal, 'week_goal', s.week_goal,
      'month_goal', s.month_goal, 'year_goal', s.year_goal,
      'minimums', jsonb_build_object('day',3,'week',15,'month',30,'year',600),
      'updated_at', s.updated_at
    ) else null end,
    'period_starts', jsonb_build_object('today', bd.today_start, 'week', bd.week_start, 'month', bd.month_start, 'year', bd.year_start),
    'leaders', jsonb_build_object(
      'today', (select case when today_sales > 0 then jsonb_build_object('name', rep_name, 'count', today_sales) end from ranked order by today_rank limit 1),
      'week', (select case when week_sales > 0 then jsonb_build_object('name', rep_name, 'count', week_sales) end from ranked order by week_rank limit 1),
      'month', (select case when month_sales > 0 then jsonb_build_object('name', rep_name, 'count', month_sales) end from ranked order by month_rank limit 1),
      'year', (select case when year_sales > 0 then jsonb_build_object('name', rep_name, 'count', year_sales) end from ranked order by year_rank limit 1),
      'all_time', (select case when all_time_sales > 0 then jsonb_build_object('name', rep_name, 'count', all_time_sales) end from ranked order by all_time_rank limit 1),
      'sales_per_hour', (select case when week_tracked_hours > 0 then jsonb_build_object(
        'name',rep_name,'rate',week_sales_per_hour,'tracked_hours',week_tracked_hours,'week_sales',week_sales
      ) end from ranked where week_tracked_hours > 0 order by sales_per_hour_rank limit 1)
    ),
    'rankings', coalesce((select jsonb_agg(item order by week_order, sort_name) from combined_objects), '[]'::jsonb),
    'current_rep', coalesce(
      (select item from real_objects where rep_email = v_requester_email),
      (select item from ghost_object where item->>'is_current_user' = 'true')
    ),
    'pending_review_sales', (select count(*) from public.sales_records sr where sr.ranking_eligible is not true and lower(coalesce(sr.sale_status, '')) <> 'cancelled')
  ) into v_result
  from bounds bd cross join settings s;

  return v_result;
end;
$$;

revoke all on function public.get_verified_sales_rankings() from public, anon;
grant execute on function public.get_verified_sales_rankings() to authenticated;

comment on function public.get_verified_sales_rankings() is
  'Single authoritative verified-sales ranking with faster-accumulation tie breaks and weekly verified sales/hour for every real user; zero-hour users rank after tracked users, and Ghost is excluded from sales/hour and all-time records.';


