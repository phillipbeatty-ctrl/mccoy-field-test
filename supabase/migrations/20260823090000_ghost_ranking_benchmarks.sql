-- Tester PKB is the single Ghost benchmark account. Ghost is a virtual,
-- Admin-managed ranking target; its simulation sales remain auditable but do
-- not determine its benchmark position and never create an all-time record.

create table if not exists public.ghost_ranking_settings (
  singleton boolean primary key default true check (singleton is true),
  ghost_email text not null default 'phillipkbeatty@gmail.com'
    check (lower(trim(ghost_email)) = 'phillipkbeatty@gmail.com'),
  display_name text not null default 'Ghost'
    check (lower(trim(display_name)) = 'ghost'),
  day_goal integer not null default 3 check (day_goal >= 3),
  week_goal integer not null default 15 check (week_goal >= 15),
  month_goal integer not null default 30 check (month_goal >= 30),
  year_goal integer not null default 600 check (year_goal >= 600),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

create table if not exists public.ghost_ranking_setting_changes (
  id bigint generated always as identity primary key,
  changed_at timestamptz not null default now(),
  changed_by uuid not null references auth.users(id),
  previous_settings jsonb not null,
  new_settings jsonb not null
);

alter table public.ghost_ranking_settings enable row level security;
alter table public.ghost_ranking_setting_changes enable row level security;
revoke all on public.ghost_ranking_settings from public, anon, authenticated;
revoke all on public.ghost_ranking_setting_changes from public, anon, authenticated;

insert into public.ghost_ranking_settings (
  singleton, ghost_email, display_name, day_goal, week_goal, month_goal, year_goal
) values (
  true, 'phillipkbeatty@gmail.com', 'Ghost', 3, 15, 30, 600
)
on conflict (singleton) do update set
  ghost_email = excluded.ghost_email,
  display_name = excluded.display_name,
  day_goal = greatest(public.ghost_ranking_settings.day_goal, 3),
  week_goal = greatest(public.ghost_ranking_settings.week_goal, 15),
  month_goal = greatest(public.ghost_ranking_settings.month_goal, 30),
  year_goal = greatest(public.ghost_ranking_settings.year_goal, 600);

create or replace function public.admin_set_ghost_ranking_goals(
  p_day_goal integer,
  p_week_goal integer,
  p_month_goal integer,
  p_year_goal integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_previous public.ghost_ranking_settings%rowtype;
  v_updated public.ghost_ranking_settings%rowtype;
begin
  if (select auth.uid()) is null or not public.is_mccoy_admin() then
    raise exception 'admin_required' using errcode = '42501';
  end if;
  if p_day_goal < 3 or p_week_goal < 15 or p_month_goal < 30 or p_year_goal < 600 then
    raise exception 'ghost_goal_below_required_minimum' using errcode = '22023';
  end if;
  if p_day_goal > 1000 or p_week_goal > 5000 or p_month_goal > 20000 or p_year_goal > 100000 then
    raise exception 'ghost_goal_above_safe_limit' using errcode = '22023';
  end if;

  select * into v_previous
  from public.ghost_ranking_settings
  where singleton is true
  for update;

  update public.ghost_ranking_settings
  set day_goal = p_day_goal,
      week_goal = p_week_goal,
      month_goal = p_month_goal,
      year_goal = p_year_goal,
      updated_at = now(),
      updated_by = (select auth.uid())
  where singleton is true
  returning * into v_updated;

  insert into public.ghost_ranking_setting_changes (
    changed_by, previous_settings, new_settings
  ) values (
    (select auth.uid()), to_jsonb(v_previous), to_jsonb(v_updated)
  );

  return jsonb_build_object(
    'ok', true,
    'day_goal', v_updated.day_goal,
    'week_goal', v_updated.week_goal,
    'month_goal', v_updated.month_goal,
    'year_goal', v_updated.year_goal,
    'updated_at', v_updated.updated_at
  );
end;
$$;

revoke all on function public.admin_set_ghost_ranking_goals(integer, integer, integer, integer) from public, anon;
grant execute on function public.admin_set_ghost_ranking_goals(integer, integer, integer, integer) to authenticated;

comment on function public.admin_set_ghost_ranking_goals(integer, integer, integer, integer) is
  'Admin-only audited Ghost benchmark editor. Enforces minimum targets of 3/day, 15/week, 30/month, and 600/year.';

-- Reserve the Ghost label for the exact Tester PKB login and make that login
-- authoritative even if an older client submits the previous display name.
create or replace function private.enforce_reserved_ghost_identity()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if lower(trim(new.email)) = 'phillipkbeatty@gmail.com' then
    new.display_name := 'Ghost';
  elsif lower(trim(coalesce(new.display_name, ''))) = 'ghost' then
    raise exception 'ghost_display_name_reserved' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function private.enforce_reserved_ghost_identity() from public, anon, authenticated;
drop trigger if exists app_user_access_enforce_reserved_ghost on public.app_user_access;
create trigger app_user_access_enforce_reserved_ghost
before insert or update of email, display_name on public.app_user_access
for each row execute function private.enforce_reserved_ghost_identity();

update public.app_user_access
set display_name = 'Ghost'
where lower(trim(email)) = 'phillipkbeatty@gmail.com';

-- Every historical and future Tester PKB sale is labeled Ghost. The sale stays
-- in the accounting/audit data, but the ranking function below excludes it
-- from real-rep totals and supplies the virtual benchmark instead.
create or replace function private.normalize_ghost_sale_identity()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if lower(trim(coalesce(new.rep_email, ''))) = 'phillipkbeatty@gmail.com' then
    new.rep_name := 'Ghost';
    if coalesce((new.compensation_snapshot#>>'{tester_simulation,enabled}')::boolean, false) then
      new.compensation_snapshot := jsonb_set(
        coalesce(new.compensation_snapshot, '{}'::jsonb),
        '{tester_simulation,account}',
        to_jsonb('Ghost'::text),
        true
      );
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.normalize_ghost_sale_identity() from public, anon, authenticated;
drop trigger if exists sales_records_normalize_ghost_identity on public.sales_records;
create trigger sales_records_normalize_ghost_identity
before insert or update of rep_email, rep_name, compensation_snapshot on public.sales_records
for each row execute function private.normalize_ghost_sale_identity();

alter table public.sales_records
  drop constraint if exists sales_records_tester_pkb_simulation_identity_check;

alter table public.sales_records
  add constraint sales_records_ghost_simulation_identity_check check (
    verification_reason <> 'tester_pkb_simulation_authorized'
    or (
      lower(trim(rep_email)) = 'phillipkbeatty@gmail.com'
      and lower(trim(rep_name)) = 'ghost'
      and compensation_snapshot#>>'{tester_simulation,enabled}' = 'true'
      and lower(coalesce(compensation_snapshot#>>'{tester_simulation,account}', '')) = 'ghost'
      and compensation_snapshot#>>'{tester_simulation,provider_dashboard_bypassed}' = 'true'
      and compensation_snapshot#>>'{tester_simulation,provider_evidence_claimed}' = 'false'
      and provider_sale_row_id is null
    )
  ) not valid;

update public.sales_records
set rep_name = 'Ghost',
    compensation_snapshot = case
      when coalesce((compensation_snapshot#>>'{tester_simulation,enabled}')::boolean, false)
        then jsonb_set(coalesce(compensation_snapshot, '{}'::jsonb), '{tester_simulation,account}', to_jsonb('Ghost'::text), true)
      else compensation_snapshot
    end
where lower(trim(rep_email)) = 'phillipkbeatty@gmail.com';

alter table public.sales_records validate constraint sales_records_ghost_simulation_identity_check;

comment on constraint sales_records_ghost_simulation_identity_check on public.sales_records is
  'Restricts the no-provider Ghost simulation authority to the dedicated Tester PKB login and prevents it from claiming ISP evidence.';

-- Generic Ghost live-win scripts prevent the test identity, benchmark counts,
-- personal records, and rank movement from leaking through public feed rows.
create or replace function private.sanitize_ghost_sales_feed()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_is_ghost boolean := false;
  v_message text;
begin
  select exists (
    select 1
    from public.sales_records s
    where s.id = new.sale_id
      and lower(trim(s.rep_email)) = 'phillipkbeatty@gmail.com'
  ) into v_is_ghost;

  if not v_is_ghost and new.rep_user_id is not null then
    select exists (
      select 1 from auth.users u
      where u.id = new.rep_user_id
        and lower(trim(u.email)) = 'phillipkbeatty@gmail.com'
    ) into v_is_ghost;
  end if;

  if v_is_ghost then
    v_message := case when new.ranking_eligible_at_event is true
      then format('👻 Ghost recorded a verified %s benchmark simulation.', coalesce(nullif(trim(new.isp), ''), 'provider'))
      else format('👻 Ghost recorded a %s benchmark simulation pending verification.', coalesce(nullif(trim(new.isp), ''), 'provider'))
    end;
    new.rep_name := 'Ghost';
    new.message := v_message;
    new.celebration_types := array[case when new.ranking_eligible_at_event is true then 'ghost_sale' else 'ghost_sale_pending' end]::text[];
    new.celebration_messages := jsonb_build_array(v_message);
    new.celebration_payload := (
      coalesce(new.celebration_payload, '{}'::jsonb)
      - 'counts' - 'weekly_rank' - 'previous_weekly_rank'
    ) || jsonb_build_object('ghost', true, 'benchmark_audit', true);
  end if;
  return new;
end;
$$;

revoke all on function private.sanitize_ghost_sales_feed() from public, anon, authenticated;
drop trigger if exists ghost_sales_feed_sanitize on public.sales_feed;
create trigger ghost_sales_feed_sanitize
before insert or update on public.sales_feed
for each row execute function private.sanitize_ghost_sales_feed();

update public.sales_feed f
set rep_name = f.rep_name
where exists (
  select 1 from public.sales_records s
  where s.id = f.sale_id
    and lower(trim(s.rep_email)) = 'phillipkbeatty@gmail.com'
);

-- Replace, rather than fork, the authoritative ranking calculation. Real
-- users are ranked from verified sales. Ghost is injected as a benchmark:
-- zero real reps at/above a goal => Ghost #1; one => Ghost #2; two or more =>
-- Ghost hidden for that period. Hidden goal values are not returned until a
-- real rep reaches the goal. Ghost never participates in all-time rankings.
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
      coalesce(nullif(trim(a.display_name), ''), 'Rep') as rep_name,
      lower(a.role) as role,
      nullif(trim(a.team_name), '') as team_name
    from public.app_user_access a, settings s
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
  totals as (
    select a.rep_email, a.rep_name, a.role, a.team_name,
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
        'all_time', r.all_time_rank
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
        'all_time', null
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
      'all_time', (select case when all_time_sales > 0 then jsonb_build_object('name', rep_name, 'count', all_time_sales) end from ranked order by all_time_rank limit 1)
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
  'Single authoritative verified-sales ranking with an Admin-managed Ghost benchmark: 0 real reps at goal is Ghost #1, 1 is Ghost #2, and 2+ hides Ghost; no Ghost all-time record.';
