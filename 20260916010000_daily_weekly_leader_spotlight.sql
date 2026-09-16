-- Powers the new daily/weekly leader spotlight display: top 2 reps only
-- (crown + closest competitor), for today and this week. Reuses the same
-- proven primitives as the authoritative rankings (sale_ranking_at,
-- ranking_eligible, the America/Los_Angeles day/week convention, and
-- excluding the Ghost benchmark account) but applies a deliberately
-- different tie-break rule specified directly for this feature: the crown
-- goes to whoever reached the current top count earliest, and it is sticky
-- -- only a strictly higher count by someone else takes it over. This
-- differs from the main rankings' "fastest elapsed accumulation" tie-break,
-- which is a different metric (spread between first and last sale of the
-- period, not who hit the current count first), so it is intentionally not
-- reused as-is here.
create or replace function public.my_daily_weekly_leader_spotlight()
returns jsonb
language plpgsql
stable
security definer
set search_path=pg_catalog,public,auth,private
as $$
declare
  v_requester_email text;
  v_result jsonb;
begin
  if (select auth.uid()) is null then raise exception 'authentication_required' using errcode='42501'; end if;
  select lower(trim(u.email)) into v_requester_email from auth.users u where u.id=(select auth.uid());
  if not exists(select 1 from public.app_user_access a where lower(trim(a.email))=v_requester_email and a.active is true) then
    raise exception 'active_mccoy_access_required' using errcode='42501';
  end if;

  with settings as (
    select lower(trim(ghost_email)) as ghost_email from public.ghost_ranking_settings where singleton is true
  ),
  bounds as (
    select
      date_trunc('day', timezone('America/Los_Angeles', now())) at time zone 'America/Los_Angeles' as today_start,
      date_trunc('week', timezone('America/Los_Angeles', now())) at time zone 'America/Los_Angeles' as week_start
  ),
  accounts as (
    select lower(trim(a.email)) as rep_email, coalesce(nullif(trim(a.display_name),''),'Rep') as rep_name
    from public.app_user_access a cross join settings s
    where a.active is true and lower(trim(a.email)) <> s.ghost_email
  ),
  eligible_sales as (
    select
      lower(trim(sr.rep_email)) as rep_email,
      private.sale_ranking_at(sr.order_date,p.sale_date,sr.created_at) as ranking_at
    from public.sales_records sr
    left join public.provider_sales_rows p on p.id=sr.provider_sale_row_id
    cross join settings s
    where sr.ranking_eligible is true
      and lower(trim(sr.rep_email)) <> s.ghost_email
  ),
  period_totals as (
    select a.rep_email, a.rep_name, 'today'::text as period,
      count(e.rep_email) filter (where e.ranking_at>=b.today_start)::int as sale_count,
      max(e.ranking_at) filter (where e.ranking_at>=b.today_start) as reached_at
    from accounts a cross join bounds b left join eligible_sales e on e.rep_email=a.rep_email
    group by a.rep_email,a.rep_name
    union all
    select a.rep_email, a.rep_name, 'week',
      count(e.rep_email) filter (where e.ranking_at>=b.week_start)::int,
      max(e.ranking_at) filter (where e.ranking_at>=b.week_start)
    from accounts a cross join bounds b left join eligible_sales e on e.rep_email=a.rep_email
    group by a.rep_email,a.rep_name
  ),
  spotlight as (
    select *, row_number() over (partition by period order by sale_count desc, reached_at asc nulls last, lower(rep_name), rep_email) as spot
    from period_totals where sale_count>0
  ),
  totals as (
    select period, coalesce(sum(sale_count),0)::int as total
    from period_totals group by period
  )
  select jsonb_build_object(
    'ok', true,
    'today', jsonb_build_object(
      'total', (select total from totals where period='today'),
      'leader', (select jsonb_build_object('name',rep_name,'count',sale_count) from spotlight where period='today' and spot=1),
      'runner_up', (select jsonb_build_object('name',rep_name,'count',sale_count) from spotlight where period='today' and spot=2)
    ),
    'week', jsonb_build_object(
      'total', (select total from totals where period='week'),
      'leader', (select jsonb_build_object('name',rep_name,'count',sale_count) from spotlight where period='week' and spot=1),
      'runner_up', (select jsonb_build_object('name',rep_name,'count',sale_count) from spotlight where period='week' and spot=2)
    )
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.my_daily_weekly_leader_spotlight() from public,anon;
grant execute on function public.my_daily_weekly_leader_spotlight() to authenticated;
