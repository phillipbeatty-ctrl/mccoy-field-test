-- Recent live wins for the COMMS page's "reply to a win" picker. sales_feed
-- has RLS enabled with no policies defined, so a direct client-side select
-- would return nothing; this mirrors the security-definer pattern already
-- used for send/list above rather than depending on that table's RLS setup.
create or replace function public.list_recent_live_wins_for_reply(p_limit integer default 15)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text;
  v_org uuid;
  v_limit integer := greatest(1, least(50, coalesce(p_limit, 15)));
  v_result jsonb;
begin
  if v_uid is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  select lower(trim(email)) into v_email from auth.users where id = v_uid;
  select organization_id into v_org from public.app_user_access
    where lower(trim(email)) = v_email and active is true;
  if v_org is null then raise exception 'active_mccoy_access_required' using errcode = '42501'; end if;

  select coalesce(jsonb_agg(row_to_json(w)), '[]'::jsonb) into v_result
  from (
    select id, rep_name, isp, internet_product, created_at
    from public.sales_feed
    where organization_id = v_org
    order by created_at desc
    limit v_limit
  ) w;

  return v_result;
end;
$$;

revoke all on function public.list_recent_live_wins_for_reply(integer) from public, anon;
grant execute on function public.list_recent_live_wins_for_reply(integer) to authenticated;
