create or replace function public.get_closest_mccoy_lead(
  p_lat double precision,
  p_lng double precision
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_email text := lower(coalesce((select auth.jwt()) ->> 'email', ''));
  v_access jsonb;
  v_access_org text;
  v_result jsonb;
begin
  if p_lat is null or p_lng is null
     or p_lat < -90 or p_lat > 90
     or p_lng < -180 or p_lng > 180 then
    raise exception 'valid_location_required' using errcode = '22023';
  end if;

  select to_jsonb(access_row)
    into v_access
  from public.app_user_access access_row
  where lower(access_row.email) = v_email
    and lower(coalesce(to_jsonb(access_row) ->> 'active', 'false')) in ('true', '1', 'yes')
  limit 1;

  if v_access is null then
    raise exception 'active_access_required' using errcode = '42501';
  end if;

  v_access_org := coalesce(
    nullif(v_access ->> 'organization_id', ''),
    nullif(v_access ->> 'tenant_id', ''),
    nullif(v_access ->> 'company_id', '')
  );

  with lead_json as (
    select
      to_jsonb(lead_row) as lead,
      case
        when coalesce(to_jsonb(lead_row) ->> 'latitude', to_jsonb(lead_row) ->> 'lat', '')
             ~ '^-?[0-9]+([.][0-9]+)?$'
          then coalesce(to_jsonb(lead_row) ->> 'latitude', to_jsonb(lead_row) ->> 'lat')::double precision
        else null
      end as lead_lat,
      case
        when coalesce(to_jsonb(lead_row) ->> 'longitude', to_jsonb(lead_row) ->> 'lng', to_jsonb(lead_row) ->> 'lon', '')
             ~ '^-?[0-9]+([.][0-9]+)?$'
          then coalesce(to_jsonb(lead_row) ->> 'longitude', to_jsonb(lead_row) ->> 'lng', to_jsonb(lead_row) ->> 'lon')::double precision
        else null
      end as lead_lng,
      coalesce(
        nullif(to_jsonb(lead_row) ->> 'organization_id', ''),
        nullif(to_jsonb(lead_row) ->> 'tenant_id', ''),
        nullif(to_jsonb(lead_row) ->> 'company_id', '')
      ) as lead_org
    from public.leads lead_row
  ), eligible as (
    select
      lead,
      lead_lat,
      lead_lng,
      2 * 6371000 * asin(
        least(
          1,
          sqrt(
            power(sin(radians(lead_lat - p_lat) / 2), 2)
            + cos(radians(p_lat)) * cos(radians(lead_lat))
              * power(sin(radians(lead_lng - p_lng) / 2), 2)
          )
        )
      ) as distance_meters
    from lead_json
    where lead_lat between -90 and 90
      and lead_lng between -180 and 180
      and lower(coalesce(lead ->> 'deleted', lead ->> 'is_deleted', 'false')) not in ('true', '1', 'yes')
      and lower(coalesce(lead ->> 'archived', lead ->> 'is_archived', 'false')) not in ('true', '1', 'yes')
      and lower(coalesce(lead ->> 'active', 'true')) not in ('false', '0', 'no')
      and (
        lead_org is null
        or v_access_org is null
        or lead_org = v_access_org
      )
  )
  select jsonb_build_object(
    'id', coalesce(lead ->> 'id', lead ->> 'lead_id'),
    'address', coalesce(
      nullif(lead ->> 'full_address', ''),
      nullif(lead ->> 'service_address', ''),
      nullif(lead ->> 'address', ''),
      nullif(concat_ws(', ',
        nullif(lead ->> 'street_address', ''),
        nullif(lead ->> 'city', ''),
        nullif(lead ->> 'state', ''),
        nullif(lead ->> 'zip', '')
      ), '')
    ),
    'latitude', lead_lat,
    'longitude', lead_lng,
    'distance_meters', round(distance_meters::numeric, 1),
    'owner_email', coalesce(lead ->> 'rep_email', lead ->> 'assigned_rep_email', lead ->> 'owner_email'),
    'organization_id', lead_org
  )
    into v_result
  from eligible
  where coalesce(
    nullif(lead ->> 'full_address', ''),
    nullif(lead ->> 'service_address', ''),
    nullif(lead ->> 'address', ''),
    nullif(lead ->> 'street_address', '')
  ) is not null
  order by distance_meters, coalesce(lead ->> 'id', lead ->> 'lead_id')
  limit 1;

  return v_result;
end;
$$;

revoke all on function public.get_closest_mccoy_lead(double precision, double precision) from public;
grant execute on function public.get_closest_mccoy_lead(double precision, double precision) to authenticated;

comment on function public.get_closest_mccoy_lead(double precision, double precision)
is 'Returns only the nearest active lead visible to the caller organization, independent of lead assignment, for empty Sales Hub address auto-fill.';
