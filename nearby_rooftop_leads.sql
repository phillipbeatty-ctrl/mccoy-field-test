-- Finds distinct, rooftop-verified real addresses within a radius, for
-- detecting genuine ambiguity between two close-together real addresses
-- that GPS alone cannot distinguish. Deduplicates by normalized address
-- text given this lead pool's extensive duplicate-row issues.
create or replace function public.nearby_rooftop_leads(p_lat double precision, p_lng double precision, p_radius_meters double precision)
returns jsonb
language sql stable security definer
set search_path to 'pg_catalog', 'public'
as $function$
with candidates as (
  select
    upper(trim(coalesce(address1,'')))||'|'||upper(trim(coalesce(city,'')))||'|'||upper(trim(coalesce(zip,''))) as dedupe_key,
    address1, city, state, zip, latitude, longitude,
    2*6371000*asin(least(1,sqrt(
      power(sin(radians(latitude-p_lat)/2),2)
      +cos(radians(p_lat))*cos(radians(latitude))*power(sin(radians(longitude-p_lng)/2),2)
    ))) as distance_meters
  from public.leads
  where geocode_status='matched'
    and latitude is not null and longitude is not null
), nearby as (
  select distinct on (dedupe_key) dedupe_key, address1, city, state, zip, distance_meters
  from candidates
  where distance_meters <= p_radius_meters
  order by dedupe_key, distance_meters asc
)
select coalesce(jsonb_agg(jsonb_build_object(
  'address', concat_ws(', ', nullif(trim(address1),''), nullif(trim(city),''), nullif(trim(concat_ws(' ', state, zip)),'')),
  'distance_meters', round(distance_meters::numeric,1)
) order by distance_meters asc), '[]'::jsonb)
from nearby;
$function$;
