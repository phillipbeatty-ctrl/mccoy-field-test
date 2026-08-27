create or replace function public.admin_edit_customer_list_sale(
  p_sale_id uuid,
  p_changes jsonb default '{}'::jsonb,
  p_rep_email text default null
)
returns public.sales_records
language plpgsql
security definer
set search_path = pg_catalog, public, auth, private
as $$
declare
  v_after public.sales_records%rowtype;
  v_target_email text := nullif(lower(trim(coalesce(p_rep_email, ''))), '');
begin
  -- The existing edit function enforces organization-scoped Admin access,
  -- locks the sale, allow-lists fields, and writes before/after audit history.
  v_after := public.admin_edit_any_sale(
    p_sale_id,
    coalesce(p_changes, '{}'::jsonb)
  );

  -- Keep credited-user reassignment in the same database transaction.
  -- A failed reassignment rolls back the customer corrections as well.
  if v_target_email is not null
     and v_target_email is distinct from lower(coalesce(v_after.rep_email, '')) then
    v_after := public.admin_assign_any_sale_user(p_sale_id, v_target_email);
  end if;

  return v_after;
end;
$$;

revoke all on function public.admin_edit_customer_list_sale(uuid, jsonb, text) from public;
grant execute on function public.admin_edit_customer_list_sale(uuid, jsonb, text) to authenticated;

comment on function public.admin_edit_customer_list_sale(uuid, jsonb, text)
is 'Atomically lets an authenticated organization Admin correct an existing Customer List sale and optionally reassign its credited user without changing Admin approval or removing it from Customer List.';
