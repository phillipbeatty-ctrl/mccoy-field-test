-- Ghost is a real, verified simulation account for period rankings. Its row is
-- always present. Ordinary users see a Ghost period total only while a real
-- user ranks ahead of Ghost for that period. There is no manual visibility
-- switch: recording enough verified Ghost sales to retake #1 hides that period
-- again. Admin and the exact Ghost identity always see the underlying totals.

create or replace function private.get_ghost_actual_period_metrics()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, auth, private
as $function$
with
settings as (
  select lower(trim(ghost_email)) ghost_email
  from public.ghost_ranking_settings
  where singleton is true
),
bounds as (
  select
    date_trunc('day',timezone('America/Los_Angeles',clock_timestamp())) at time zone 'America/Los_Angeles' today_start,
    date_trunc('week',timezone('America/Los_Angeles',clock_timestamp())) at time zone 'America/Los_Angeles' week_start,
    date_trunc('month',timezone('America/Los_Angeles',clock_timestamp())) at time zone 'America/Los_Angeles' month_start,
    date_trunc('year',timezone('America/Los_Angeles',clock_timestamp())) at time zone 'America/Los_Angeles' year_start
),
eligible as (
  select coalesce(p.sale_date,s.created_at) ranking_at,
    greatest(coalesce(s.att_mobile_lines,0),coalesce(s.mobile_phone_lines,0)) mobile_lines,
    coalesce(s.directv,false) directv,coalesce(s.vivint,false) vivint
  from public.sales_records s
  left join public.provider_sales_rows p on p.id=s.provider_sale_row_id
  cross join settings g
  where lower(trim(s.rep_email))=g.ghost_email
    and s.ranking_eligible is true
    and s.verification_status='verified_processed'
    and (
      coalesce(s.compensation_snapshot->>'sale_origin','')<>'outside_system'
      or lower(coalesce(s.compensation_snapshot#>>'{admin_approval,status}',''))='approved'
      or coalesce((s.compensation_snapshot#>>'{tester_simulation,enabled}')::boolean,false)
    )
    and (
      coalesce(s.compensation_snapshot->>'sale_context','')<>'out_of_area_phone'
      or lower(coalesce(s.compensation_snapshot#>>'{admin_approval,status}',''))='approved'
      or coalesce((s.compensation_snapshot#>>'{tester_simulation,enabled}')::boolean,false)
    )
),
period_counts as (
  select period_type,period_start,count(*)::int sale_count
  from eligible e
  cross join lateral (values
    ('day'::text,date_trunc('day',timezone('America/Los_Angeles',e.ranking_at))::date),
    ('week',date_trunc('week',timezone('America/Los_Angeles',e.ranking_at))::date),
    ('month',date_trunc('month',timezone('America/Los_Angeles',e.ranking_at))::date),
    ('year',date_trunc('year',timezone('America/Los_Angeles',e.ranking_at))::date)
  ) p(period_type,period_start)
  group by period_type,period_start
),
totals as (
  select
    count(*) filter(where e.ranking_at>=b.today_start)::int today_sales,
    count(*) filter(where e.ranking_at>=b.week_start)::int week_sales,
    count(*) filter(where e.ranking_at>=b.month_start)::int month_sales,
    count(*) filter(where e.ranking_at>=b.year_start)::int year_sales,
    extract(epoch from(max(e.ranking_at) filter(where e.ranking_at>=b.today_start)-min(e.ranking_at) filter(where e.ranking_at>=b.today_start)))::numeric today_elapsed_seconds,
    max(e.ranking_at) filter(where e.ranking_at>=b.today_start) today_reached_at,
    extract(epoch from(max(e.ranking_at) filter(where e.ranking_at>=b.week_start)-min(e.ranking_at) filter(where e.ranking_at>=b.week_start)))::numeric week_elapsed_seconds,
    max(e.ranking_at) filter(where e.ranking_at>=b.week_start) week_reached_at,
    extract(epoch from(max(e.ranking_at) filter(where e.ranking_at>=b.month_start)-min(e.ranking_at) filter(where e.ranking_at>=b.month_start)))::numeric month_elapsed_seconds,
    max(e.ranking_at) filter(where e.ranking_at>=b.month_start) month_reached_at,
    extract(epoch from(max(e.ranking_at) filter(where e.ranking_at>=b.year_start)-min(e.ranking_at) filter(where e.ranking_at>=b.year_start)))::numeric year_elapsed_seconds,
    max(e.ranking_at) filter(where e.ranking_at>=b.year_start) year_reached_at,
    coalesce(sum(e.mobile_lines) filter(where e.ranking_at>=b.month_start),0)::int month_mobile_lines,
    count(*) filter(where e.ranking_at>=b.month_start and e.directv)::int month_directv,
    count(*) filter(where e.ranking_at>=b.month_start and e.vivint)::int month_vivint
  from bounds b left join eligible e on true
  group by b.today_start,b.week_start,b.month_start,b.year_start
),
pending as (
  select count(*)::int pending_count
  from public.sales_records s cross join settings g
  where lower(trim(s.rep_email))=g.ghost_email
    and lower(coalesce(s.sale_status,''))<>'cancelled'
    and not(s.ranking_eligible is true and s.verification_status='verified_processed')
),
records as (
  select jsonb_build_object(
    'day',coalesce((select jsonb_build_object('count',sale_count,'period_start',period_start,'source','verified_ghost_account_sales') from period_counts where period_type='day' order by sale_count desc,period_start desc limit 1),jsonb_build_object('count',0,'period_start',null,'source','verified_ghost_account_sales')),
    'week',coalesce((select jsonb_build_object('count',sale_count,'period_start',period_start,'source','verified_ghost_account_sales') from period_counts where period_type='week' order by sale_count desc,period_start desc limit 1),jsonb_build_object('count',0,'period_start',null,'source','verified_ghost_account_sales')),
    'month',coalesce((select jsonb_build_object('count',sale_count,'period_start',period_start,'source','verified_ghost_account_sales') from period_counts where period_type='month' order by sale_count desc,period_start desc limit 1),jsonb_build_object('count',0,'period_start',null,'source','verified_ghost_account_sales')),
    'year',coalesce((select jsonb_build_object('count',sale_count,'period_start',period_start,'source','verified_ghost_account_sales') from period_counts where period_type='year' order by sale_count desc,period_start desc limit 1),jsonb_build_object('count',0,'period_start',null,'source','verified_ghost_account_sales'))
  ) personal_records
)
select jsonb_build_object(
  'today_sales',t.today_sales,'week_sales',t.week_sales,'month_sales',t.month_sales,'year_sales',t.year_sales,
  'ranking_velocity',jsonb_build_object(
    'today',jsonb_build_object('elapsed_seconds',t.today_elapsed_seconds,'reached_at',t.today_reached_at),
    'week',jsonb_build_object('elapsed_seconds',t.week_elapsed_seconds,'reached_at',t.week_reached_at),
    'month',jsonb_build_object('elapsed_seconds',t.month_elapsed_seconds,'reached_at',t.month_reached_at),
    'year',jsonb_build_object('elapsed_seconds',t.year_elapsed_seconds,'reached_at',t.year_reached_at)
  ),
  'personal_records',r.personal_records,
  'month_mobile_lines',t.month_mobile_lines,'month_directv',t.month_directv,'month_vivint',t.month_vivint,
  'pending_review_sales',p.pending_count,
  'source','verified_ghost_account_sales'
)
from totals t cross join records r cross join pending p;
$function$;

revoke all on function private.get_ghost_actual_period_metrics()
  from public,anon,authenticated,service_role;

create or replace function private.apply_ghost_actual_rankings(p_result jsonb,p_metrics jsonb)
returns jsonb
language plpgsql
immutable
set search_path = pg_catalog
as $function$
declare v_rows jsonb;v_result jsonb:=coalesce(p_result,'{}'::jsonb);
begin
  select coalesce(jsonb_agg(
    case when coalesce((entry.item->>'is_ghost')::boolean,false) then
      entry.item||jsonb_build_object(
        'today_sales',coalesce((p_metrics->>'today_sales')::int,0),
        'week_sales',coalesce((p_metrics->>'week_sales')::int,0),
        'month_sales',coalesce((p_metrics->>'month_sales')::int,0),
        'year_sales',coalesce((p_metrics->>'year_sales')::int,0),
        'all_time_sales',null,
        'ranking_velocity',coalesce(p_metrics->'ranking_velocity','{}'::jsonb),
        'personal_records',coalesce(p_metrics->'personal_records','{}'::jsonb),
        'month_mobile_lines',coalesce((p_metrics->>'month_mobile_lines')::int,0),
        'month_directv',coalesce((p_metrics->>'month_directv')::int,0),
        'month_vivint',coalesce((p_metrics->>'month_vivint')::int,0),
        'pending_review_sales',coalesce((p_metrics->>'pending_review_sales')::int,0),
        'ghost_rank_source','verified_ghost_account_sales'
      )
    else entry.item end order by entry.ordinality),'[]'::jsonb)
  into v_rows
  from jsonb_array_elements(coalesce(v_result->'rankings','[]'::jsonb)) with ordinality entry(item,ordinality);

  with rows as (
    select item,ordinality
    from jsonb_array_elements(v_rows) with ordinality r(item,ordinality)
  ), ranked as (
    select item,ordinality,
      row_number() over(order by coalesce((item->>'today_sales')::int,0) desc,nullif(item#>>'{ranking_velocity,today,elapsed_seconds}','')::numeric asc nulls last,nullif(item#>>'{ranking_velocity,today,reached_at}','')::timestamptz desc nulls last,lower(item->>'rep_name'),ordinality)::int today_rank,
      row_number() over(order by coalesce((item->>'week_sales')::int,0) desc,nullif(item#>>'{ranking_velocity,week,elapsed_seconds}','')::numeric asc nulls last,nullif(item#>>'{ranking_velocity,week,reached_at}','')::timestamptz desc nulls last,lower(item->>'rep_name'),ordinality)::int week_rank,
      row_number() over(order by coalesce((item->>'month_sales')::int,0) desc,nullif(item#>>'{ranking_velocity,month,elapsed_seconds}','')::numeric asc nulls last,nullif(item#>>'{ranking_velocity,month,reached_at}','')::timestamptz desc nulls last,lower(item->>'rep_name'),ordinality)::int month_rank,
      row_number() over(order by coalesce((item->>'year_sales')::int,0) desc,nullif(item#>>'{ranking_velocity,year,elapsed_seconds}','')::numeric asc nulls last,nullif(item#>>'{ranking_velocity,year,reached_at}','')::timestamptz desc nulls last,lower(item->>'rep_name'),ordinality)::int year_rank
    from rows
  ), rebuilt as (
    select case when coalesce((item->>'is_ghost')::boolean,false) then
      item||jsonb_build_object(
        'ranks',coalesce(item->'ranks','{}'::jsonb)||jsonb_build_object('today',today_rank,'week',week_rank,'month',month_rank,'year',year_rank,'all_time',null,'sales_per_hour',null),
        'ghost_visibility',jsonb_build_object(
          'today',jsonb_build_object('visible',true,'overtaken',today_rank>1,'rank',today_rank,'control','automatic_overtake'),
          'week',jsonb_build_object('visible',true,'overtaken',week_rank>1,'rank',week_rank,'control','automatic_overtake'),
          'month',jsonb_build_object('visible',true,'overtaken',month_rank>1,'rank',month_rank,'control','automatic_overtake'),
          'year',jsonb_build_object('visible',true,'overtaken',year_rank>1,'rank',year_rank,'control','automatic_overtake')
        )
      )
    else item||jsonb_build_object(
      'ranks',coalesce(item->'ranks','{}'::jsonb)||jsonb_build_object('today',today_rank,'week',week_rank,'month',month_rank,'year',year_rank)
    ) end item,week_rank,ordinality
    from ranked
  )
  select coalesce(jsonb_agg(item order by week_rank,ordinality),'[]'::jsonb) into v_rows from rebuilt;

  v_result:=jsonb_set(v_result,'{rankings}',v_rows,true);
  v_result:=jsonb_set(v_result,'{ghost_policy}',jsonb_build_object(
    'placement_rule','verified_ghost_sales_ranked_with_real_users_ghost_always_visible',
    'number_visibility','public_only_while_real_user_ranks_ahead',
    'overtake_control','always_active',
    'disable_public_reveal_rule','record_verified_ghost_sales_until_ghost_retakes_rank_1',
    'tie_break','faster_accumulation_then_later_matching_sale',
    'all_time_record',false
  ),true);
  v_result:=jsonb_set(v_result,'{ghost_admin_settings}',jsonb_build_object(
    'can_edit',false,'overtake_control','always_active',
    'disable_public_reveal_rule','sign_in_as_ghost_and_record_verified_sales_until_rank_1'
  ),true);
  return v_result;
end;
$function$;

revoke all on function private.apply_ghost_actual_rankings(jsonb,jsonb)
  from public,anon,authenticated,service_role;

create or replace function private.filter_ghost_ranking_numbers(p_item jsonb,p_can_see boolean,p_goals jsonb)
returns jsonb
language plpgsql
immutable
set search_path = pg_catalog
as $function$
declare
  v_item jsonb:=coalesce(p_item,'{}'::jsonb);v_period text;v_record_period text;v_sales_key text;
  v_state jsonb;v_overtaken boolean;v_allowed boolean;v_hidden_any boolean:=false;
begin
  if coalesce((v_item->>'is_ghost')::boolean,false) is not true then return v_item;end if;
  foreach v_period in array array['today','week','month','year'] loop
    v_record_period:=case when v_period='today' then 'day' else v_period end;
    v_sales_key:=v_period||'_sales';
    v_state:=coalesce(v_item#>array['ghost_visibility',v_period],'{}'::jsonb);
    v_overtaken:=coalesce((v_state->>'overtaken')::boolean,false);
    v_allowed:=coalesce(p_can_see,false) or v_overtaken;
    v_hidden_any:=v_hidden_any or not v_allowed;
    v_state:=v_state||jsonb_build_object('visible',true,'revealed',v_allowed,'overtaken',v_overtaken,'control','automatic_overtake');
    v_item:=jsonb_set(v_item,array['ghost_visibility',v_period],v_state,true);
    if not v_allowed then
      v_item:=jsonb_set(v_item,array[v_sales_key],'null'::jsonb,true);
      v_item:=jsonb_set(v_item,array['ranking_velocity',v_period],'null'::jsonb,true);
      v_item:=jsonb_set(v_item,array['personal_records',v_record_period,'count'],'null'::jsonb,true);
    end if;
  end loop;
  if not(coalesce(p_can_see,false) or coalesce((v_item#>>'{ghost_visibility,month,overtaken}')::boolean,false)) then
    v_item:=jsonb_set(v_item,'{month_mobile_lines}','null'::jsonb,true);
    v_item:=jsonb_set(v_item,'{month_directv}','null'::jsonb,true);
    v_item:=jsonb_set(v_item,'{month_vivint}','null'::jsonb,true);
  end if;
  if not coalesce(p_can_see,false) then v_item:=jsonb_set(v_item,'{pending_review_sales}','null'::jsonb,true);end if;
  v_item:=jsonb_set(v_item,'{all_time_sales}','null'::jsonb,true);
  return v_item||jsonb_build_object(
    'ghost_numbers_hidden',v_hidden_any,
    'ghost_numbers_visible_to','admin_ghost_or_metric_overtaken',
    'ghost_overtake_control','always_active'
  );
end;
$function$;

revoke all on function private.filter_ghost_ranking_numbers(jsonb,boolean,jsonb)
  from public,anon,authenticated,service_role;

create or replace function public.get_verified_sales_rankings()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog,public,auth,private
as $function$
declare
  v_requester_email text;v_requester_role text;v_requester_name text;v_ghost_email text;
  v_is_admin boolean:=false;v_is_ghost boolean:=false;v_can_see_ghost_numbers boolean:=false;
  v_result jsonb;v_goals jsonb;v_ghost_metrics jsonb;v_rankings jsonb;v_current jsonb;v_leader jsonb;
  v_sph_map jsonb;v_sph_leader jsonb;
begin
  if (select auth.uid()) is null then raise exception 'authentication_required' using errcode='42501';end if;
  select lower(trim(u.email)) into v_requester_email from auth.users u where u.id=(select auth.uid());
  select lower(trim(a.role)),lower(trim(a.display_name)) into v_requester_role,v_requester_name
  from public.app_user_access a where lower(trim(a.email))=v_requester_email and a.active is true;
  if v_requester_role is null then raise exception 'active_mccoy_access_required' using errcode='42501';end if;
  select lower(trim(s.ghost_email)),jsonb_build_object('day_goal',s.day_goal,'week_goal',s.week_goal,'month_goal',s.month_goal,'year_goal',s.year_goal)
  into v_ghost_email,v_goals from public.ghost_ranking_settings s where s.singleton is true;
  v_is_admin:=v_requester_role='admin';
  v_is_ghost:=v_requester_email=v_ghost_email and v_requester_name='ghost';
  v_can_see_ghost_numbers:=v_is_admin or v_is_ghost;

  v_result:=private.get_verified_sales_rankings_unredacted();
  v_ghost_metrics:=private.get_ghost_actual_period_metrics();
  v_result:=private.apply_ghost_actual_rankings(v_result,v_ghost_metrics);
  if not v_is_admin then v_result:=jsonb_set(v_result,'{ghost_admin_settings}','null'::jsonb,true);end if;

  select coalesce(jsonb_object_agg(lower(trim(m.rep_name))||'|'||lower(trim(m.role))||'|'||lower(trim(coalesce(m.team_name,''))),m.metric),'{}'::jsonb),
    (select x.metric||jsonb_build_object('name',x.rep_name) from private.get_authoritative_sph_metrics() x
      where (x.metric->>'qualified')::boolean and coalesce((x.metric->>'week_sales')::integer,0)>0 order by x.sph_rank limit 1)
  into v_sph_map,v_sph_leader
  from private.get_authoritative_sph_metrics() m;

  select coalesce(jsonb_agg(private.filter_ghost_ranking_numbers(
    private.apply_authoritative_sph(entry.item,v_sph_map),v_can_see_ghost_numbers,v_goals
  ) order by entry.ordinality),'[]'::jsonb)
  into v_rankings from jsonb_array_elements(coalesce(v_result->'rankings','[]'::jsonb)) with ordinality entry(item,ordinality);
  v_result:=jsonb_set(v_result,'{rankings}',v_rankings,true);

  select item into v_current from jsonb_array_elements(v_rankings) item where coalesce((item->>'is_current_user')::boolean,false) limit 1;
  v_result:=jsonb_set(v_result,'{current_rep}',coalesce(v_current,'null'::jsonb),true);

  select jsonb_build_object('name',item->>'rep_name','count',item->'today_sales','hidden',item->'today_sales'='null'::jsonb)
  into v_leader from jsonb_array_elements(v_rankings) item where (item#>>'{ranks,today}')::int=1 limit 1;
  v_result:=jsonb_set(v_result,'{leaders,today}',coalesce(v_leader,'null'::jsonb),true);
  select jsonb_build_object('name',item->>'rep_name','count',item->'week_sales','hidden',item->'week_sales'='null'::jsonb)
  into v_leader from jsonb_array_elements(v_rankings) item where (item#>>'{ranks,week}')::int=1 limit 1;
  v_result:=jsonb_set(v_result,'{leaders,week}',coalesce(v_leader,'null'::jsonb),true);
  select jsonb_build_object('name',item->>'rep_name','count',item->'month_sales','hidden',item->'month_sales'='null'::jsonb)
  into v_leader from jsonb_array_elements(v_rankings) item where (item#>>'{ranks,month}')::int=1 limit 1;
  v_result:=jsonb_set(v_result,'{leaders,month}',coalesce(v_leader,'null'::jsonb),true);
  select jsonb_build_object('name',item->>'rep_name','count',item->'year_sales','hidden',item->'year_sales'='null'::jsonb)
  into v_leader from jsonb_array_elements(v_rankings) item where (item#>>'{ranks,year}')::int=1 limit 1;
  v_result:=jsonb_set(v_result,'{leaders,year}',coalesce(v_leader,'null'::jsonb),true);
  v_result:=jsonb_set(v_result,'{leaders,sales_per_hour}',coalesce(v_sph_leader,'null'::jsonb),true);
  v_result:=jsonb_set(v_result,'{ghost_number_visibility}',to_jsonb('automatic_overtake_always_active'::text),true);
  return v_result;
end;
$function$;

revoke all on function public.get_verified_sales_rankings() from public,anon;
grant execute on function public.get_verified_sales_rankings() to authenticated,service_role;

-- Retire the old Admin goal editor as a runtime control. Historical values and
-- its audit log remain intact, but only verified sales on the Ghost account can
-- move Ghost back to #1 and turn public number visibility off.
revoke execute on function public.admin_set_ghost_ranking_goals(integer,integer,integer,integer)
  from authenticated;

comment on function public.get_verified_sales_rankings() is
  'Authoritative rankings with Ghost always listed. Ghost period numbers are public only while a real user ranks ahead; the rule is always active and resets only when verified Ghost-account sales retake rank one.';
