do $$
declare
  v_current_target regclass;
begin
  select constraint_row.confrelid::regclass
    into v_current_target
  from pg_catalog.pg_constraint constraint_row
  where constraint_row.conrelid = 'public.door_visits'::regclass
    and constraint_row.conname = 'door_visits_session_id_fkey'
    and constraint_row.contype = 'f';

  if v_current_target is null then
    raise exception 'door_visits_session_foreign_key_missing';
  end if;

  if v_current_target not in ('public.field_sessions'::regclass, 'public.test_sessions'::regclass) then
    raise exception 'unexpected_door_visits_session_foreign_key_target: %', v_current_target;
  end if;

  if exists (
    select 1
    from public.door_visits visit
    left join public.test_sessions session_row on session_row.id = visit.session_id
    where session_row.id is null
  ) then
    raise exception 'door_visits_session_repair_requires_backfill';
  end if;
end;
$$;

alter table public.door_visits
  drop constraint door_visits_session_id_fkey;

alter table public.door_visits
  add constraint door_visits_session_id_fkey
  foreign key (session_id)
  references public.test_sessions(id)
  on delete cascade;

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.door_visits'::regclass
      and constraint_row.conname = 'door_visits_session_id_fkey'
      and constraint_row.contype = 'f'
      and constraint_row.confrelid = 'public.test_sessions'::regclass
      and constraint_row.confdeltype = 'c'
  ) then
    raise exception 'door_visits_session_foreign_key_repair_failed';
  end if;
end;
$$;

comment on table public.door_visits is
  'Authoritative door-visit audit. session_id uses the same authenticated test_sessions field-session lifecycle validated by the door workflow RPCs. Location verification remains coaching-only.';
