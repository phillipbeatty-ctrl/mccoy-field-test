-- Date-only values are calendar facts, not UTC instants. Use the approved order
-- date for ranking-day/week/month/year buckets while preserving the actual local
-- time of day for tie-speed calculations. Grossly invalid dates fall back to the
-- provider/created timestamp instead of corrupting rankings.

create or replace function private.sale_ranking_at(
  p_order_date date,
  p_provider_sale_at timestamptz,
  p_created_at timestamptz
)
returns timestamptz
language sql
stable
set search_path = pg_catalog, public, private
as $$
  with fallback as (
    select coalesce(p_provider_sale_at,p_created_at) as actual_at
  )
  select case
    when p_order_date between date '2000-01-01'
         and timezone('America/Los_Angeles',current_timestamp)::date + 1
      then (
        p_order_date
        + coalesce(
            timezone('America/Los_Angeles',fallback.actual_at)::time,
            time '12:00'
          )
      ) at time zone 'America/Los_Angeles'
    else fallback.actual_at
  end
  from fallback;
$$;

comment on function private.sale_ranking_at(date,timestamptz,timestamptz)
is 'Returns the ranking instant using order_date as the Pacific calendar date and the provider/created timestamp local time. Invalid date-only values fall back to the actual timestamp.';

-- Patch every authoritative ranking path that previously bucketed only by the
-- provider timestamp or created_at. Schema-qualified helper calls keep this safe
-- even for functions whose search_path does not include private.
do $migration$
declare
  v_oid oid;
  v_name text;
  v_sql text;
  v_original text;
begin
  for v_oid,v_name in
    select p.oid,p.proname
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='private'
      and p.prokind='f'
      and p.proname in (
        'get_verified_sales_rankings_unredacted',
        'get_ghost_actual_period_metrics',
        'get_authoritative_sph_metrics',
        'publish_verified_sale_live_win'
      )
    order by p.proname
  loop
    v_sql:=pg_get_functiondef(v_oid);
    if position('private.sale_ranking_at(' in v_sql)>0 then
      continue;
    end if;
    v_original:=v_sql;

    v_sql:=replace(v_sql,
      'coalesce(p.sale_date, sr.created_at)',
      'private.sale_ranking_at(sr.order_date,p.sale_date,sr.created_at)');
    v_sql:=replace(v_sql,
      'coalesce(p.sale_date,sr.created_at)',
      'private.sale_ranking_at(sr.order_date,p.sale_date,sr.created_at)');
    v_sql:=replace(v_sql,
      'coalesce(p.sale_date, s.created_at)',
      'private.sale_ranking_at(s.order_date,p.sale_date,s.created_at)');
    v_sql:=replace(v_sql,
      'coalesce(p.sale_date,s.created_at)',
      'private.sale_ranking_at(s.order_date,p.sale_date,s.created_at)');
    v_sql:=replace(v_sql,
      'coalesce(p.sale_date, new.created_at)',
      'private.sale_ranking_at(new.order_date,p.sale_date,new.created_at)');
    v_sql:=replace(v_sql,
      'coalesce(p.sale_date,new.created_at)',
      'private.sale_ranking_at(new.order_date,p.sale_date,new.created_at)');

    if v_sql=v_original or position('private.sale_ranking_at(' in v_sql)=0 then
      raise exception 'Could not patch ranking calendar source in private.%',v_name;
    end if;
    execute v_sql;
  end loop;
end;
$migration$;

-- Migration-time contract check using the reported Bill Mesteth timestamp shape:
-- 2026-08-27 03:48 UTC is 2026-08-26 in Pacific time, and the date-only order
-- value must remain 2026-08-26 instead of shifting to 2026-08-25 in a browser.
do $validation$
declare
  v_rank_at timestamptz;
begin
  v_rank_at:=private.sale_ranking_at(
    date '2026-08-26',
    null,
    timestamptz '2026-08-27 03:48:16+00'
  );
  if timezone('America/Los_Angeles',v_rank_at)::date<>date '2026-08-26' then
    raise exception 'Order-date ranking calendar validation failed';
  end if;
end;
$validation$;
