-- A Tracking Gap is insufficient evidence of work or idle and must never add
-- time to the Sales/Hour denominator. Enforce this at the table boundary so a
-- future derivation change cannot accidentally count it.

create or replace function private.enforce_field_workday_segment_accounting()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, private
as $function$
begin
  if new.segment_type = 'tracking_gap' then
    new.break_seconds_applied := 0;
    new.excessive_idle_seconds := 0;
    new.sph_counted_seconds := 0;
  elsif new.segment_type = 'working' then
    new.break_seconds_applied := 0;
    new.excessive_idle_seconds := 0;
    new.sph_counted_seconds := new.duration_seconds;
  end if;
  return new;
end;
$function$;

revoke all on function private.enforce_field_workday_segment_accounting()
  from public, anon, authenticated;

drop trigger if exists enforce_field_workday_segment_accounting
  on private.field_workday_segments;
create trigger enforce_field_workday_segment_accounting
before insert or update on private.field_workday_segments
for each row execute function private.enforce_field_workday_segment_accounting();

update private.field_workday_segments
set break_seconds_applied = 0,
    excessive_idle_seconds = 0,
    sph_counted_seconds = 0
where segment_type = 'tracking_gap'
  and (break_seconds_applied <> 0 or excessive_idle_seconds <> 0 or sph_counted_seconds <> 0);

select private.refresh_automatic_field_workdays(null, clock_timestamp());
