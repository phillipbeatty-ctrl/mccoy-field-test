-- One authoritative verified-sale event stream for rankings, Live Wins, and celebrations.
alter table public.sales_feed
  add column if not exists celebration_types text[] not null default '{}'::text[],
  add column if not exists celebration_messages jsonb not null default '[]'::jsonb,
  add column if not exists celebration_payload jsonb not null default '{}'::jsonb,
  add column if not exists celebration_version integer not null default 0,
  add column if not exists animation_enabled boolean not null default false,
  add column if not exists ranking_eligible_at_event boolean not null default false;

comment on column public.sales_feed.celebration_messages is
  'Server-authored public celebration scripts. Customer and order details are intentionally excluded.';

update public.sales_feed f
set ranking_eligible_at_event = coalesce(s.ranking_eligible, false),
    celebration_types = case when coalesce(s.ranking_eligible, false) then array['sale']::text[] else '{}'::text[] end,
    celebration_messages = case when coalesce(s.ranking_eligible, false) then jsonb_build_array(f.message) else '[]'::jsonb end,
    celebration_payload = jsonb_build_object('historical', true),
    animation_enabled = false
from public.sales_records s
where s.id = f.sale_id and f.celebration_version = 0;

create or replace function private.publish_verified_sale_live_win()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, auth, private
as $$
declare
  v_origin text := lower(coalesce(new.compensation_snapshot->>'sale_origin', ''));
  v_became_eligible boolean := false;
  v_credit_changed boolean := false;
  v_ranking_at timestamptz;
  v_day_start timestamptz;
  v_week_start timestamptz;
  v_month_start timestamptz;
  v_year_start timestamptz;
  v_day_count integer := 0;
  v_week_count integer := 0;
  v_month_count integer := 0;
  v_year_count integer := 0;
  v_day_best integer := 0;
  v_week_best integer := 0;
  v_month_best integer := 0;
  v_year_best integer := 0;
  v_week_rank integer;
  v_previous_week_rank integer;
  v_active_knockers integer := 0;
  v_active_includes_rep boolean := false;
  v_knockers_today integer := 0;
  v_last_sale_already_posted boolean := false;
  v_message text;
  v_messages jsonb := '[]'::jsonb;
  v_types text[] := '{}'::text[];
  v_payload jsonb := '{}'::jsonb;
begin
  if tg_op = 'INSERT' then
    v_became_eligible := new.ranking_eligible is true;
  else
    v_became_eligible := new.ranking_eligible is true and old.ranking_eligible is not true;
    v_credit_changed := new.ranking_eligible is true and old.ranking_eligible is true and
      (new.rep_user_id is distinct from old.rep_user_id or new.rep_name is distinct from old.rep_name);
  end if;

  -- A revoked or disputed sale disappears from Live Wins and rankings together.
  if tg_op = 'UPDATE' and old.ranking_eligible is true and new.ranking_eligible is not true then
    delete from public.sales_feed where sale_id = new.id;
    return new;
  end if;

  if new.ranking_eligible is not true or new.verification_status <> 'verified_processed' then
    return new;
  end if;

  -- Only sales submitted through McCoy create live celebrations. Historical provider imports
  -- still update rankings, but do not replay as new workday wins.
  if v_origin not in ('mccoy_app', 'outside_system') then
    return new;
  end if;

  if v_credit_changed then
    v_message := format('🎉 %s has verified %s sale credit in the live rankings.', new.rep_name, new.isp);
    update public.sales_feed
    set rep_user_id = new.rep_user_id,
        rep_name = new.rep_name,
        isp = new.isp,
        internet_product = new.internet_product,
        directv = coalesce(new.directv, false),
        mobile_phone_lines = greatest(coalesce(new.mobile_phone_lines, 0), coalesce(new.att_mobile_lines, 0)),
        mobile_device_count = coalesce(new.mobile_device_count, 0),
        att_mobile_lines = greatest(coalesce(new.att_mobile_lines, 0), coalesce(new.mobile_phone_lines, 0)),
        vivint = coalesce(new.vivint, false),
        message = v_message,
        celebration_types = array['sale_credit_updated']::text[],
        celebration_messages = jsonb_build_array(v_message),
        celebration_payload = jsonb_build_object('sale_id', new.id, 'credit_updated', true),
        ranking_eligible_at_event = true,
        animation_enabled = false
    where sale_id = new.id;
    return new;
  end if;

  if not v_became_eligible then return new; end if;

  select coalesce(p.sale_date, new.created_at)
  into v_ranking_at
  from (select 1) seed
  left join public.provider_sales_rows p on p.id = new.provider_sale_row_id;
  v_ranking_at := coalesce(v_ranking_at, new.created_at, now());
  v_day_start := date_trunc('day', timezone('America/Los_Angeles', v_ranking_at)) at time zone 'America/Los_Angeles';
  v_week_start := date_trunc('week', timezone('America/Los_Angeles', v_ranking_at)) at time zone 'America/Los_Angeles';
  v_month_start := date_trunc('month', timezone('America/Los_Angeles', v_ranking_at)) at time zone 'America/Los_Angeles';
  v_year_start := date_trunc('year', timezone('America/Los_Angeles', v_ranking_at)) at time zone 'America/Los_Angeles';

  with eligible as (
    select s.id, coalesce(p.sale_date, s.created_at) as ranking_at
    from public.sales_records s
    left join public.provider_sales_rows p on p.id = s.provider_sale_row_id
    where lower(trim(s.rep_email)) = lower(trim(new.rep_email))
      and s.ranking_eligible is true
      and s.verification_status = 'verified_processed'
      and (
        coalesce(s.compensation_snapshot->>'sale_origin', '') <> 'outside_system'
        or lower(coalesce(s.compensation_snapshot#>>'{admin_approval,status}', '')) = 'approved'
      )
  ), daily as (
    select date_trunc('day', timezone('America/Los_Angeles', ranking_at)) as bucket, count(*)::int as total
    from eligible group by 1
  ), weekly as (
    select date_trunc('week', timezone('America/Los_Angeles', ranking_at)) as bucket, count(*)::int as total
    from eligible group by 1
  ), monthly as (
    select date_trunc('month', timezone('America/Los_Angeles', ranking_at)) as bucket, count(*)::int as total
    from eligible group by 1
  ), yearly as (
    select date_trunc('year', timezone('America/Los_Angeles', ranking_at)) as bucket, count(*)::int as total
    from eligible group by 1
  )
  select
    count(*) filter (where ranking_at >= v_day_start and ranking_at < v_day_start + interval '1 day')::int,
    count(*) filter (where ranking_at >= v_week_start and ranking_at < v_week_start + interval '7 days')::int,
    count(*) filter (where ranking_at >= v_month_start and ranking_at < v_month_start + interval '1 month')::int,
    count(*) filter (where ranking_at >= v_year_start and ranking_at < v_year_start + interval '1 year')::int,
    coalesce((select max(total) from daily where bucket < timezone('America/Los_Angeles', v_day_start)), 0),
    coalesce((select max(total) from weekly where bucket < timezone('America/Los_Angeles', v_week_start)), 0),
    coalesce((select max(total) from monthly where bucket < timezone('America/Los_Angeles', v_month_start)), 0),
    coalesce((select max(total) from yearly where bucket < timezone('America/Los_Angeles', v_year_start)), 0)
  into v_day_count, v_week_count, v_month_count, v_year_count,
       v_day_best, v_week_best, v_month_best, v_year_best
  from eligible;

  with accounts as (
    select lower(trim(a.email)) as rep_email,
      coalesce(nullif(trim(a.display_name), ''), lower(trim(a.email))) as rep_name
    from public.app_user_access a
    where a.active is true and lower(a.role) in ('rep','manager','trainer','admin')
  ), eligible as (
    select s.id, lower(trim(s.rep_email)) as rep_email, coalesce(p.sale_date, s.created_at) as ranking_at
    from public.sales_records s
    left join public.provider_sales_rows p on p.id = s.provider_sale_row_id
    where s.ranking_eligible is true and s.verification_status = 'verified_processed'
      and (coalesce(s.compensation_snapshot->>'sale_origin', '') <> 'outside_system'
        or lower(coalesce(s.compensation_snapshot#>>'{admin_approval,status}', '')) = 'approved')
  ), totals as (
    select a.rep_email, a.rep_name,
      count(e.id) filter (where e.ranking_at >= v_day_start)::int as today_after,
      count(e.id) filter (where e.ranking_at >= v_week_start)::int as week_after,
      count(e.id) filter (where e.ranking_at >= v_month_start)::int as month_after,
      count(e.id) filter (where e.ranking_at >= v_year_start)::int as year_after,
      count(e.id) filter (where e.id <> new.id and e.ranking_at >= v_day_start)::int as today_before,
      count(e.id) filter (where e.id <> new.id and e.ranking_at >= v_week_start)::int as week_before,
      count(e.id) filter (where e.id <> new.id and e.ranking_at >= v_month_start)::int as month_before,
      count(e.id) filter (where e.id <> new.id and e.ranking_at >= v_year_start)::int as year_before
    from accounts a left join eligible e on e.rep_email = a.rep_email
    group by a.rep_email, a.rep_name
  ), ranked as (
    select *,
      row_number() over (order by week_after desc, month_after desc, year_after desc, today_after desc, lower(rep_name), rep_email)::int as after_rank,
      row_number() over (order by week_before desc, month_before desc, year_before desc, today_before desc, lower(rep_name), rep_email)::int as before_rank
    from totals
  )
  select after_rank, before_rank into v_week_rank, v_previous_week_rank
  from ranked where rep_email = lower(trim(new.rep_email));

  v_message := format('🎉 %s closed a verified %s sale — it is live in the rankings!', new.rep_name, new.isp);
  v_messages := v_messages || jsonb_build_array(v_message);
  v_types := array_append(v_types, 'sale');

  if v_day_count = 1 then
    v_messages := v_messages || jsonb_build_array(format('🌅 FIRST SALE OF THE DAY: %s put the first verified win on the board!', new.rep_name));
    v_types := array_append(v_types, 'first_sale_day');
  end if;
  if v_day_best > 0 and v_day_count > v_day_best then
    v_messages := v_messages || jsonb_build_array(format('🔥 DAILY PERSONAL RECORD: %s reached %s verified sales today — a new best!', new.rep_name, v_day_count));
    v_types := array_append(v_types, 'personal_record_day');
  end if;
  if v_week_best > 0 and v_week_count > v_week_best then
    v_messages := v_messages || jsonb_build_array(format('🚀 WEEKLY PERSONAL RECORD: %s reached %s verified sales this week — a new best!', new.rep_name, v_week_count));
    v_types := array_append(v_types, 'personal_record_week');
  end if;
  if v_month_best > 0 and v_month_count > v_month_best then
    v_messages := v_messages || jsonb_build_array(format('🏆 MONTHLY PERSONAL RECORD: %s reached %s verified sales this month — a new best!', new.rep_name, v_month_count));
    v_types := array_append(v_types, 'personal_record_month');
  end if;
  if v_year_best > 0 and v_year_count > v_year_best then
    v_messages := v_messages || jsonb_build_array(format('👑 YEARLY PERSONAL RECORD: %s reached %s verified sales this year — a new best!', new.rep_name, v_year_count));
    v_types := array_append(v_types, 'personal_record_year');
  end if;
  if v_week_rank is not null and v_previous_week_rank is not null and v_week_rank < v_previous_week_rank then
    v_messages := v_messages || jsonb_build_array(format('📈 RANK OVERTAKE: %s moved to #%s this week, passing %s competitor%s!', new.rep_name, v_week_rank, v_previous_week_rank-v_week_rank, case when v_previous_week_rank-v_week_rank=1 then '' else 's' end));
    v_types := array_append(v_types, 'rank_overtake');
  end if;

  -- "Last sale" is emitted once per day, only after at least two reps knocked that day
  -- and exactly one rep has recent activity in an open field session.
  select count(distinct s.tester_user_id),
         coalesce(bool_or(s.tester_user_id = new.rep_user_id), false)
  into v_active_knockers, v_active_includes_rep
  from public.test_sessions s
  where s.ended_at is null
    and s.started_at >= v_day_start
    and exists (
      select 1 from public.test_events e
      where e.session_id = s.id and e.event_time >= now() - interval '30 minutes'
    );
  select count(distinct tester_user_id) into v_knockers_today
  from public.test_sessions where started_at >= v_day_start and tester_user_id is not null;
  select exists (
    select 1 from public.sales_feed f
    where f.created_at >= v_day_start and 'last_sale_day' = any(f.celebration_types)
  ) into v_last_sale_already_posted;
  if v_active_knockers = 1 and v_active_includes_rep and v_knockers_today >= 2 and not v_last_sale_already_posted then
    v_messages := v_messages || jsonb_build_array(format('🌙 LAST SALE OF THE DAY: %s, the final rep still knocking, closed one more verified sale!', new.rep_name));
    v_types := array_append(v_types, 'last_sale_day');
  end if;

  v_payload := jsonb_build_object(
    'sale_id', new.id,
    'ranking_at', v_ranking_at,
    'counts', jsonb_build_object('day',v_day_count,'week',v_week_count,'month',v_month_count,'year',v_year_count),
    'weekly_rank', v_week_rank,
    'previous_weekly_rank', v_previous_week_rank,
    'active_knockers', v_active_knockers
  );

  insert into public.sales_feed(
    sale_id, rep_user_id, rep_name, isp, internet_product, directv,
    mobile_phone_lines, mobile_device_count, att_mobile_lines, vivint, message,
    celebration_types, celebration_messages, celebration_payload,
    celebration_version, animation_enabled, ranking_eligible_at_event, created_at
  ) values (
    new.id, new.rep_user_id, new.rep_name, new.isp, new.internet_product, coalesce(new.directv,false),
    greatest(coalesce(new.mobile_phone_lines,0),coalesce(new.att_mobile_lines,0)), coalesce(new.mobile_device_count,0),
    greatest(coalesce(new.att_mobile_lines,0),coalesce(new.mobile_phone_lines,0)), coalesce(new.vivint,false), v_message,
    v_types, v_messages, v_payload, 1, true, true, now()
  )
  on conflict (sale_id) do update set
    created_at = excluded.created_at,
    rep_user_id = excluded.rep_user_id,
    rep_name = excluded.rep_name,
    isp = excluded.isp,
    internet_product = excluded.internet_product,
    directv = excluded.directv,
    mobile_phone_lines = excluded.mobile_phone_lines,
    mobile_device_count = excluded.mobile_device_count,
    att_mobile_lines = excluded.att_mobile_lines,
    vivint = excluded.vivint,
    message = excluded.message,
    celebration_types = excluded.celebration_types,
    celebration_messages = excluded.celebration_messages,
    celebration_payload = excluded.celebration_payload,
    celebration_version = public.sales_feed.celebration_version + 1,
    animation_enabled = true,
    ranking_eligible_at_event = true;
  return new;
end;
$$;

revoke all on function private.publish_verified_sale_live_win() from public, anon, authenticated;

drop trigger if exists sales_records_verified_live_win on public.sales_records;
create trigger sales_records_verified_live_win
after insert or update of ranking_eligible, verification_status, rep_user_id, rep_name
on public.sales_records
for each row execute function private.publish_verified_sale_live_win();

revoke insert, update, delete, truncate on public.sales_feed from anon, authenticated;
grant select on public.sales_feed to authenticated;

