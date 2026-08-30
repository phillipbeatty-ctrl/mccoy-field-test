-- Give field users 30 continuous minutes outside their assigned working area
-- before the server-controlled field session is automatically stopped.

alter table public.session_control_rules
  alter column outside_area_grace_ms set default 1800000;

update public.session_control_rules
set outside_area_grace_ms = 1800000,
    updated_at = clock_timestamp()
where active is true;

do $$
begin
  if not exists (
    select 1
    from public.session_control_rules
    where active is true
      and outside_area_grace_ms = 1800000
  ) then
    raise exception 'active_session_control_rule_not_updated_to_30_minutes';
  end if;
end
$$;

comment on column public.session_control_rules.outside_area_grace_ms is
  'Continuous milliseconds outside the assigned working area before session-control auto-stops the field session. Production default: 1,800,000 ms (30 minutes).';
