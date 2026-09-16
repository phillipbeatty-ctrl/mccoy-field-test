-- Extends the existing lead-verification claim function with an optional
-- proximity mode: when a center point is given, claim the N closest leads
-- (by their currently-stored coordinate) to that point instead of pulling
-- from the batch/FIELD_ENTRY backlog queue. Fully backward compatible --
-- omitting the new parameters preserves the exact existing behavior used by
-- the routine backlog-clearing admin workflow.
--
-- Deliberately does not filter by prior geocode_verification_status in
-- proximity mode: this is a one-off re-evaluation pass under the new,
-- stricter street/city/gross-relocation checks, meant to also re-check
-- leads already marked verified under the old, looser logic -- turn 2 of
-- this analysis found "verified" pins still measured 30-70m off against real
-- door-visit GPS, so re-checking only unverified leads would miss exactly
-- the leads this pass is meant to catch.
-- CREATE OR REPLACE with an added parameter creates a new overload rather
-- than truly replacing the original signature, which produced a real
-- "not unique" ambiguous-call error when tested with the original 3-argument
-- call. Drop that signature explicitly so exactly one version exists.
drop function if exists public.claim_leads_for_google_verification(uuid[], integer, uuid);

create or replace function public.claim_leads_for_google_verification(
  p_batch_ids uuid[],
  p_limit integer,
  p_actor_user_id uuid,
  p_center_lat double precision default null,
  p_center_lng double precision default null
)
returns setof leads
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
begin
  if current_user not in ('postgres','service_role','supabase_admin') then
    raise exception 'service_role_required' using errcode='42501';
  end if;

  if p_center_lat is not null and p_center_lng is not null then
    if p_center_lat < -90 or p_center_lat > 90 or p_center_lng < -180 or p_center_lng > 180 then
      raise exception 'valid_center_point_required' using errcode='22023';
    end if;
    return query
    with candidates as (
      select l.id
      from public.leads l
      where l.deleted_at is null
        and upper(coalesce(l.source_system,'')) not like '%DEMO%'
        and l.latitude is not null and l.longitude is not null
        and (
          l.geocode_verification_status is distinct from 'google_in_progress'
          or l.geocode_verification_claimed_at < clock_timestamp() - interval '15 minutes'
        )
      order by
        2 * 6371000 * asin(least(1, sqrt(
          power(sin(radians(l.latitude - p_center_lat) / 2), 2)
          + cos(radians(p_center_lat)) * cos(radians(l.latitude)) * power(sin(radians(l.longitude - p_center_lng) / 2), 2)
        ))),
        l.id
      for update skip locked
      limit least(greatest(coalesce(p_limit,25),1),25)
    )
    update public.leads l
    set geocode_verification_status='google_in_progress',
        geocode_verification_claimed_at=clock_timestamp(),
        geocode_verification_claimed_by=p_actor_user_id
    from candidates c
    where l.id=c.id
    returning l.*;
    return;
  end if;

  return query
  with candidates as (
    select l.id
    from public.leads l
    where l.deleted_at is null
      and (
        (coalesce(cardinality(p_batch_ids),0)>0 and l.import_batch_id=any(p_batch_ids))
        or upper(coalesce(l.source_system,''))='FIELD_ENTRY'
      )
      and (
        l.geocode_verification_status is null
        or l.geocode_verification_status in (
          'pending_google','trusted_pending_google_comparison','google_api_error','google_in_progress'
        )
      )
      and (
        l.geocode_verification_status<>'google_in_progress'
        or l.geocode_verification_claimed_at<clock_timestamp()-interval '15 minutes'
      )
    order by
      case lower(coalesce(l.geocode_status,''))
        when 'approx_city' then 0 when 'approx_zip' then 0 when 'approx_street' then 0
        when 'unmatched' then 1 when 'pending_google' then 1 when 'matched' then 2
        when 'google_mymaps' then 3 else 4 end,
      l.id
    for update skip locked
    limit least(greatest(coalesce(p_limit,25),1),25)
  )
  update public.leads l
  set geocode_verification_status='google_in_progress',
      geocode_verification_claimed_at=clock_timestamp(),
      geocode_verification_claimed_by=p_actor_user_id
  from candidates c
  where l.id=c.id
  returning l.*;
end;
$function$;
