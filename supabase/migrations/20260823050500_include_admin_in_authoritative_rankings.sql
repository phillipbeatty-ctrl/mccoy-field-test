do $$
declare v_definition text; v_updated text;
begin
  select pg_get_functiondef('public.get_verified_sales_rankings()'::regprocedure) into v_definition;
  v_updated := replace(v_definition,
    'where a.active is true and lower(a.role) in (''rep'', ''manager'', ''trainer'')',
    'where a.active is true and lower(a.role) in (''rep'', ''manager'', ''trainer'', ''admin'')');
  v_updated := replace(v_updated,
    'where s.competition_eligible is true
      and s.verification_status = ''verified_processed''
      and lower(coalesce(s.sale_status, '''')) <> ''cancelled''',
    'where s.ranking_eligible is true
      and s.verification_status = ''verified_processed''');
  if v_updated = v_definition then raise exception 'ranking_definition_update_not_applied'; end if;
  if position('admin' in v_updated)=0 or position('s.ranking_eligible is true' in v_updated)=0 then
    raise exception 'ranking_definition_update_incomplete';
  end if;
  execute v_updated;
end $$;
comment on function public.get_verified_sales_rankings() is
  'Authoritative provider-verified rankings for all active McCoy roles including Admin; cancellations affect accounting only and retain ranking credit.';
