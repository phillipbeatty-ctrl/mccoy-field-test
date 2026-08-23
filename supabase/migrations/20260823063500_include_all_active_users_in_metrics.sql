-- Keep rankings and metric enrollment role-neutral so every active McCoy
-- account participates now and any future app role participates automatically.
do $$
declare
  v_definition text;
  v_updated text;
begin
  select pg_get_functiondef('public.get_verified_sales_rankings()'::regprocedure)
    into v_definition;

  v_updated := replace(
    v_definition,
    'where a.active is true and lower(a.role) in (''rep'', ''manager'', ''trainer'', ''admin'')',
    'where a.active is true'
  );

  if v_updated = v_definition then
    raise exception 'all_active_user_ranking_update_not_applied';
  end if;

  execute v_updated;
end
$$;

insert into public.rep_metrics_visibility(
  rep_email,
  rep_metrics_enabled,
  manager_metrics_enabled,
  updated_at
)
select lower(trim(a.email)), true, true, now()
from public.app_user_access a
where a.active is true
on conflict (rep_email) do update
set rep_metrics_enabled = true,
    updated_at = excluded.updated_at;

comment on function public.get_verified_sales_rankings() is
  'Authoritative provider-verified rankings for every active McCoy account, independent of app role; cancellations affect accounting only.';
