-- One database-authoritative ranking calculation for every McCoy client.
-- Provider sale_date controls the ranking period when available; McCoy record
-- creation time is only the fallback. Only verified, competition-eligible,
-- non-cancelled sales are counted, and rep_email is the audited credit owner.

create index if not exists sales_records_ranking_eligible_idx
  on public.sales_records (created_at, lower(rep_email))
  where competition_eligible is true
    and verification_status = 'verified_processed'
    and lower(coalesce(sale_status, '')) <> 'cancelled';

create or replace function public.get_verified_sales_rankings()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_requester_email text;
  v_result jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  select lower(trim(u.email)) into v_requester_email
  from auth.users u
  where u.id = (select auth.uid());

  if v_requester_email is null or not exists (
    select 1 from public.app_user_access a
    where lower(trim(a.email)) = v_requester_email and a.active is true
  ) then
    raise exception 'active_mccoy_access_required' using errcode = '42501';
  end if;

  with
  bounds as (
    select
      now() as generated_at,
      date_trunc('day', timezone('America/Los_Angeles', now())) at time zone 'America/Los_Angeles' as today_start,
      date_trunc('week', timezone('America/Los_Angeles', now())) at time zone 'America/Los_Angeles' as week_start,
      date_trunc('month', timezone('America/Los_Angeles', now())) at time zone 'America/Los_Angeles' as month_start,
      date_trunc('year', timezone('America/Los_Angeles', now())) at time zone 'America/Los_Angeles' as year_start
  ),
  accounts as (
    select
      lower(trim(a.email)) as rep_email,
      coalesce(nullif(trim(a.display_name), ''), 'Rep') as rep_name,
      lower(a.role) as role,
      nullif(trim(a.team_name), '') as team_name
    from public.app_user_access a
    where a.active is true and lower(a.role) in ('rep', 'manager', 'trainer')
  ),
  eligible_sales as (
    select
      lower(trim(s.rep_email)) as rep_email,
      coalesce(p.sale_date, s.created_at) as ranking_at,
      greatest(coalesce(s.att_mobile_lines, 0), coalesce(s.mobile_phone_lines, 0)) as mobile_lines,
      coalesce(s.directv, false) as directv,
      coalesce(s.vivint, false) as vivint
    from public.sales_records s
    left join public.provider_sales_rows p on p.id = s.provider_sale_row_id
    where s.competition_eligible is true
      and s.verification_status = 'verified_processed'
      and lower(coalesce(s.sale_status, '')) <> 'cancelled'
      and (
        coalesce(s.compensation_snapshot->>'sale_origin', '') <> 'outside_system'
        or lower(coalesce(s.compensation_snapshot#>>'{admin_approval,status}', '')) = 'approved'
      )
      and (
        coalesce(s.compensation_snapshot->>'sale_context', '') <> 'out_of_area_phone'
        or lower(coalesce(s.compensation_snapshot#>>'{admin_approval,status}', '')) = 'approved'
      )
  ),
  totals as (
    select
      a.rep_email, a.rep_name, a.role, a.team_name,
      count(e.rep_email) filter (where e.ranking_at >= b.today_start)::int as today_sales,
      count(e.rep_email) filter (where e.ranking_at >= b.week_start)::int as week_sales,
      count(e.rep_email) filter (where e.ranking_at >= b.month_start)::int as month_sales,
      count(e.rep_email) filter (where e.ranking_at >= b.year_start)::int as year_sales,
      count(e.rep_email)::int as all_time_sales,
      count(e.rep_email) filter (where e.ranking_at >= b.today_start - interval '1 day' and e.ranking_at < b.today_start)::int as previous_today_sales,
      count(e.rep_email) filter (where e.ranking_at >= b.week_start - interval '7 days' and e.ranking_at < b.week_start)::int as previous_week_sales,
      count(e.rep_email) filter (where e.ranking_at >= b.month_start - interval '1 month' and e.ranking_at < b.month_start)::int as previous_month_sales,
      count(e.rep_email) filter (where e.ranking_at >= b.year_start - interval '1 year' and e.ranking_at < b.year_start)::int as previous_year_sales,
      coalesce(sum(e.mobile_lines) filter (where e.ranking_at >= b.month_start), 0)::int as month_mobile_lines,
      count(e.rep_email) filter (where e.ranking_at >= b.month_start and e.directv)::int as month_directv,
      count(e.rep_email) filter (where e.ranking_at >= b.month_start and e.vivint)::int as month_vivint
    from accounts a cross join bounds b
    left join eligible_sales e on e.rep_email = a.rep_email
    group by a.rep_email, a.rep_name, a.role, a.team_name
  ),
  ranked as (
    select t.*,
      row_number() over (order by today_sales desc, week_sales desc, month_sales desc, year_sales desc, lower(rep_name), rep_email)::int as today_rank,
      row_number() over (order by week_sales desc, month_sales desc, year_sales desc, today_sales desc, lower(rep_name), rep_email)::int as week_rank,
      row_number() over (order by month_sales desc, year_sales desc, week_sales desc, today_sales desc, lower(rep_name), rep_email)::int as month_rank,
      row_number() over (order by year_sales desc, month_sales desc, week_sales desc, today_sales desc, lower(rep_name), rep_email)::int as year_rank,
      row_number() over (order by all_time_sales desc, year_sales desc, month_sales desc, lower(rep_name), rep_email)::int as all_time_rank,
      row_number() over (order by previous_today_sales desc, lower(rep_name), rep_email)::int as previous_today_rank,
      row_number() over (order by previous_week_sales desc, lower(rep_name), rep_email)::int as previous_week_rank,
      row_number() over (order by previous_month_sales desc, lower(rep_name), rep_email)::int as previous_month_rank,
      row_number() over (order by previous_year_sales desc, lower(rep_name), rep_email)::int as previous_year_rank
    from totals t
  ),
  pending as (
    select lower(trim(s.rep_email)) as rep_email, count(*)::int as pending_count
    from public.sales_records s
    where lower(coalesce(s.sale_status, '')) <> 'cancelled'
      and not (s.competition_eligible is true and s.verification_status = 'verified_processed')
    group by lower(trim(s.rep_email))
  ),
  ranking_objects as (
    select jsonb_build_object(
        'rep_name', r.rep_name, 'role', r.role, 'team_name', r.team_name,
        'today_sales', r.today_sales, 'week_sales', r.week_sales,
        'month_sales', r.month_sales, 'year_sales', r.year_sales,
        'all_time_sales', r.all_time_sales,
        'month_mobile_lines', r.month_mobile_lines,
        'month_directv', r.month_directv, 'month_vivint', r.month_vivint,
        'pending_review_sales', coalesce(p.pending_count, 0),
        'ranks', jsonb_build_object('today', r.today_rank, 'week', r.week_rank, 'month', r.month_rank, 'year', r.year_rank, 'all_time', r.all_time_rank),
        'rank_movement', jsonb_build_object(
          'today', r.previous_today_rank - r.today_rank,
          'week', r.previous_week_rank - r.week_rank,
          'month', r.previous_month_rank - r.month_rank,
          'year', r.previous_year_rank - r.year_rank
        ),
        'is_current_user', r.rep_email = v_requester_email
      ) as item,
      r.*
    from ranked r left join pending p using (rep_email)
  )
  select jsonb_build_object(
    'ok', true,
    'generated_at', b.generated_at,
    'timezone', 'America/Los_Angeles',
    'eligibility_policy', 'provider_verified_competition_eligible_non_cancelled_admin_approved',
    'period_starts', jsonb_build_object('today', b.today_start, 'week', b.week_start, 'month', b.month_start, 'year', b.year_start),
    'leaders', jsonb_build_object(
      'today', (select case when today_sales > 0 then jsonb_build_object('name', rep_name, 'count', today_sales) end from ranking_objects order by today_rank limit 1),
      'week', (select case when week_sales > 0 then jsonb_build_object('name', rep_name, 'count', week_sales) end from ranking_objects order by week_rank limit 1),
      'month', (select case when month_sales > 0 then jsonb_build_object('name', rep_name, 'count', month_sales) end from ranking_objects order by month_rank limit 1),
      'year', (select case when year_sales > 0 then jsonb_build_object('name', rep_name, 'count', year_sales) end from ranking_objects order by year_rank limit 1),
      'all_time', (select case when all_time_sales > 0 then jsonb_build_object('name', rep_name, 'count', all_time_sales) end from ranking_objects order by all_time_rank limit 1)
    ),
    'rankings', coalesce((select jsonb_agg(item order by week_rank) from ranking_objects), '[]'::jsonb),
    'current_rep', (select item from ranking_objects where rep_email = v_requester_email),
    'pending_review_sales', (select count(*) from public.sales_records s where lower(coalesce(s.sale_status, '')) <> 'cancelled' and not (s.competition_eligible is true and s.verification_status = 'verified_processed'))
  ) into v_result
  from bounds b;

  return v_result;
end;
$$;

revoke all on function public.get_verified_sales_rankings() from public, anon;
grant execute on function public.get_verified_sales_rankings() to authenticated;

comment on function public.get_verified_sales_rankings() is
  'Authoritative company rankings. Returns aggregated, non-customer data only and requires an active authenticated McCoy account.';
