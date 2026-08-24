-- One-row, count-guarded cleanup requested for:
-- 413 SW 6th Circle, Battle Ground, WA 98604.
-- This intentionally does not run the global duplicate cleanup function.

do $$
declare
  v_key text:=private.mccoy_normalized_lead_address('413 SW 6th Circle',null,'Battle Ground','WA','98604');
  v_count integer;
  v_canonical public.leads%rowtype;
  v_duplicate public.leads%rowtype;
  v_removed integer:=0;
  v_now timestamptz:=clock_timestamp();
begin
  select count(*)::integer into v_count
  from public.leads
  where deleted_at is null and normalized_address_key=v_key;

  if v_count=1 then
    raise notice 'Requested Battle Ground duplicate is already clean.';
    return;
  end if;
  if v_count<>2 then
    raise exception 'requested_address_expected_exactly_two_active_leads_found_%',v_count;
  end if;

  select l.* into v_canonical
  from public.leads l
  where l.deleted_at is null and l.normalized_address_key=v_key
  order by
    exists(select 1 from public.door_visits v where v.lead_id=l.id and v.status='active') desc,
    coalesce(l.attempt_count,0) desc,
    l.last_activity_at desc nulls last,
    (l.assigned_rep_id is not null) desc,
    (l.assigned_manager_id is not null) desc,
    l.created_at asc,
    l.id asc
  limit 1
  for update;

  select l.* into v_duplicate
  from public.leads l
  where l.deleted_at is null and l.normalized_address_key=v_key and l.id<>v_canonical.id
  limit 1
  for update;

  if exists(select 1 from public.door_visits where lead_id=v_duplicate.id and status='active') then
    raise exception 'requested_duplicate_has_active_visit';
  end if;

  update public.leads set
    deleted_at=v_now,
    deleted_by_user_id=null,
    deleted_by_email='system:requested-cleanup',
    deleted_by_role='system',
    deletion_reason='duplicate',
    duplicate_of_lead_id=v_canonical.id
  where id=v_duplicate.id and deleted_at is null;
  get diagnostics v_removed=row_count;
  if v_removed<>1 then raise exception 'requested_duplicate_cleanup_changed_%_rows',v_removed; end if;

  insert into public.lead_removal_audit(
    lead_id,canonical_lead_id,removed_at,removed_by_user_id,removed_by_email,removed_by_role,
    reason,normalized_address_key,lead_snapshot,metadata
  ) values (
    v_duplicate.id,v_canonical.id,v_now,null,'system:requested-cleanup','system','duplicate',v_key,to_jsonb(v_duplicate),
    jsonb_build_object('soft_delete',true,'verified_duplicate',true,'requested_address_cleanup',true,'maximum_rows',1)
  );
end;
$$;
