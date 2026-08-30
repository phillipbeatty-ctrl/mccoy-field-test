-- Keep one authoritative PostgREST RPC signature for Lead Pool dispositions.
-- The legacy overload exposed the same named arguments in a different order,
-- so PostgREST could not choose a function for named JSON RPC requests.

do $$
begin
  if to_regprocedure(
    'public.record_lead_pool_pin_disposition(uuid,uuid,uuid,text,text,text,timestamptz,integer,double precision,double precision,double precision,timestamptz)'
  ) is null then
    raise exception 'canonical_record_lead_pool_pin_disposition_missing';
  end if;
end;
$$;

drop function if exists public.record_lead_pool_pin_disposition(
  uuid,
  uuid,
  text,
  text,
  text,
  timestamptz,
  integer,
  uuid,
  double precision,
  double precision,
  double precision,
  timestamptz
);

grant execute on function public.record_lead_pool_pin_disposition(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  timestamptz,
  integer,
  double precision,
  double precision,
  double precision,
  timestamptz
) to authenticated;

do $$
declare
  v_count integer;
begin
  select count(*)::integer
  into v_count
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname='record_lead_pool_pin_disposition';

  if v_count<>1 then
    raise exception 'expected_one_record_lead_pool_pin_disposition_overload_found_%',v_count;
  end if;
end;
$$;

notify pgrst, 'reload schema';
