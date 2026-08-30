begin;

-- Keep the post-disposition inactivity auto-stop aligned with the existing
-- 30-minute stale-session and outside-area grace policies.
alter table public.session_control_rules
  alter column post_disposition_idle_ms set default 1800000,
  alter column post_sale_idle_ms set default 1800000;

update public.session_control_rules
set
  post_disposition_idle_ms = 1800000,
  post_sale_idle_ms = 1800000,
  updated_at = clock_timestamp()
where active is true
  and (
    post_disposition_idle_ms is distinct from 1800000
    or post_sale_idle_ms is distinct from 1800000
  );

do $$
declare
  v_active_rules integer;
  v_invalid_rules integer;
begin
  select count(*) into v_active_rules
  from public.session_control_rules
  where active is true;

  if v_active_rules = 0 then
    raise exception 'session_inactivity_rule_update_failed: no active session-control rule';
  end if;

  select count(*) into v_invalid_rules
  from public.session_control_rules
  where active is true
    and (
      post_disposition_idle_ms <> 1800000
      or post_sale_idle_ms <> 1800000
    );

  if v_invalid_rules > 0 then
    raise exception
      'session_inactivity_rule_update_failed: % active rule(s) are not configured for 30 minutes',
      v_invalid_rules;
  end if;
end;
$$;

commit;
