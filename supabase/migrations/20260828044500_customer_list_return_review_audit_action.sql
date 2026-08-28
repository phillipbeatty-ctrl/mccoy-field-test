do $$
declare
  v_constraint_definition text;
  v_function_definition text;
  v_allowed text[] := array[]::text[];
  v_match text[];
  v_action text;
begin
  select pg_get_constraintdef(con.oid)
    into v_constraint_definition
  from pg_constraint con
  where con.conrelid = 'public.sale_admin_edit_history'::regclass
    and con.conname = 'sale_admin_edit_history_action_check';

  if v_constraint_definition is not null then
    for v_match in
      select regexp_matches(v_constraint_definition, '''([^'']+)''', 'g')
    loop
      v_allowed := array_append(v_allowed, v_match[1]);
    end loop;
  end if;

  select pg_get_functiondef(proc.oid)
    into v_function_definition
  from pg_proc proc
  join pg_namespace namespace on namespace.oid = proc.pronamespace
  where namespace.nspname = 'public'
    and proc.proname = 'admin_return_sale_to_review'
  order by proc.oid desc
  limit 1;

  if v_function_definition is not null then
    for v_match in
      select regexp_matches(v_function_definition, '''([^'']*review[^'']*)''', 'gi')
    loop
      v_allowed := array_append(v_allowed, v_match[1]);
    end loop;
  end if;

  foreach v_action in array array[
    'return_to_review',
    'returned_to_review',
    'customer_list_return_to_review',
    'customer_list_returned_to_review'
  ]
  loop
    v_allowed := array_append(v_allowed, v_action);
  end loop;

  select array_agg(distinct value order by value)
    into v_allowed
  from unnest(v_allowed) as values_list(value)
  where nullif(trim(value), '') is not null;

  if coalesce(array_length(v_allowed, 1), 0) = 0 then
    raise exception 'sale_admin_edit_history_action_values_not_found';
  end if;

  alter table public.sale_admin_edit_history
    drop constraint if exists sale_admin_edit_history_action_check;

  execute format(
    'alter table public.sale_admin_edit_history add constraint sale_admin_edit_history_action_check check (action = any (%L::text[]))',
    v_allowed
  );
end;
$$;

comment on constraint sale_admin_edit_history_action_check on public.sale_admin_edit_history
is 'Allows the established Admin sale-edit audit actions plus Customer List return-to-review actions used by NOT A SALE.';
