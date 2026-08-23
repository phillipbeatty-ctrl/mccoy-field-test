-- Resolve a sale's region from its linked lead/team or service state before rep-team fallback.
create or replace function private.sale_credit_region(
  p_lead_team text,
  p_lead_state text,
  p_service_address text,
  p_rep_team text
)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select coalesce(
    nullif(trim(p_lead_team),''),
    case upper(coalesce(
      nullif(trim(p_lead_state),''),
      substring(upper(coalesce(p_service_address,'')) from '([A-Z]{2})[ ,]+[0-9]{5}(-[0-9]{4})?[[:space:]]*$')
    ))
      when 'OR' then 'Pacific Northwest'
      when 'WA' then 'Pacific Northwest'
      when 'ID' then 'Pacific Northwest'
      when 'NC' then 'North Carolina'
      when 'TX' then 'Texas'
      when 'CA' then 'California'
      when 'IL' then 'Midwest' when 'IN' then 'Midwest' when 'IA' then 'Midwest'
      when 'KS' then 'Midwest' when 'MI' then 'Midwest' when 'MN' then 'Midwest'
      when 'MO' then 'Midwest' when 'NE' then 'Midwest' when 'ND' then 'Midwest'
      when 'OH' then 'Midwest' when 'SD' then 'Midwest' when 'WI' then 'Midwest'
      when 'AL' then 'South East' when 'AR' then 'South East' when 'FL' then 'South East'
      when 'GA' then 'South East' when 'KY' then 'South East' when 'LA' then 'South East'
      when 'MS' then 'South East' when 'SC' then 'South East' when 'TN' then 'South East'
      when 'VA' then 'South East' when 'WV' then 'South East'
      when 'CT' then 'North East' when 'DE' then 'North East' when 'ME' then 'North East'
      when 'MD' then 'North East' when 'MA' then 'North East' when 'NH' then 'North East'
      when 'NJ' then 'North East' when 'NY' then 'North East' when 'PA' then 'North East'
      when 'RI' then 'North East' when 'VT' then 'North East' when 'DC' then 'North East'
      else null
    end,
    nullif(trim(p_rep_team),''),
    'Unassigned'
  );
$$;
revoke all on function private.sale_credit_region(text,text,text,text) from public,anon,authenticated;

create or replace function public.admin_sale_credit_dashboard_page(
  p_limit integer default 100,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog,public,auth,private
as $$
declare
  v_actor uuid := auth.uid();
  v_limit integer := greatest(1,least(coalesce(p_limit,100),250));
  v_offset integer := greatest(0,coalesce(p_offset,0));
  v_total integer;
  v_rows jsonb;
begin
  if v_actor is null or not exists (
    select 1 from auth.users u
    join public.app_user_access a on lower(a.email)=lower(u.email)
    where u.id=v_actor and a.active=true and lower(a.role)='admin'
  ) then raise exception 'Admin access required'; end if;

  select count(*)::integer into v_total from public.sales_records;
  select coalesce(jsonb_agg(row_data order by created_at desc),'[]'::jsonb)
  into v_rows
  from (
    select s.created_at,jsonb_build_object(
      'sale',to_jsonb(s),
      'region',private.sale_credit_region(t.name,l.state,s.service_address,a.team_name),
      'provider_account',case when p.id is null then null else to_jsonb(p) end,
      'credit_history',coalesce((
        select jsonb_agg(to_jsonb(h) order by h.created_at desc)
        from public.sale_credit_assignment_history h where h.sale_id=s.id
      ),'[]'::jsonb),
      'ranking_credit_history',coalesce((
        select jsonb_agg(to_jsonb(rh) order by rh.created_at desc)
        from public.sale_ranking_credit_history rh where rh.sale_id=s.id
      ),'[]'::jsonb),
      'review_queue_history',coalesce((
        select jsonb_agg(to_jsonb(qh) order by qh.created_at desc)
        from public.sale_credit_review_queue_history qh where qh.sale_id=s.id
      ),'[]'::jsonb),
      'review_history',coalesce((
        select jsonb_agg(to_jsonb(r) order by r.created_at desc)
        from public.sale_review_disposition_history r where r.sale_id=s.id
      ),'[]'::jsonb)
    ) as row_data
    from public.sales_records s
    left join public.provider_sales_rows p on p.id=s.provider_sale_row_id
    left join public.app_user_access a on lower(a.email)=lower(s.rep_email)
    left join public.leads l on l.id=s.distance_lead_id
    left join public.teams t on t.id=l.assigned_team_id
    order by s.created_at desc
    limit v_limit offset v_offset
  ) page;

  return jsonb_build_object(
    'ok',true,'total_count',v_total,'offset',v_offset,'limit',v_limit,'rows',v_rows
  );
end;
$$;
revoke all on function public.admin_sale_credit_dashboard_page(integer,integer) from public,anon;
grant execute on function public.admin_sale_credit_dashboard_page(integer,integer) to authenticated;
