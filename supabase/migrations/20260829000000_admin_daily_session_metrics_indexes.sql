create index if not exists test_sessions_org_started_at_idx
  on public.test_sessions (organization_id, started_at desc);

create index if not exists test_sessions_org_ended_at_idx
  on public.test_sessions (organization_id, ended_at desc)
  where ended_at is not null;

create index if not exists test_events_session_termination_idx
  on public.test_events (session_id, event_time desc)
  where event_type in ('session_end', 'auto_stop');
