-- One-click Admin approval: preserve an automatic audit reason and complete the review queue item.
drop function if exists public.admin_approve_sale_credit(uuid,text,text);

create or replace function public.admin_approve_sale_credit(
  p_sale_id uuid,
  p_rep_email text
)
returns public.sales_records
language plpgsql
security definer
set search_path = pg_catalog,public,auth,private
as $$
declare
  v_sale public.sales_records%rowtype;
begin
  -- admin_apply_sale_credit performs the Admin authorization, required-data checks,
  -- NOT A SALE lock, rep assignment, verification, ranking/pay update, and audit writes.
  select * into v_sale
  from public.admin_apply_sale_credit(
    p_sale_id,
    p_rep_email,
    'One-click APPROVED confirmation'
  );

  if v_sale.sale_credit_review_queued is true then
    perform public.admin_set_sale_credit_review_queue(
      p_sale_id,
      false,
      'Completed by one-click APPROVED confirmation'
    );
    select * into v_sale from public.sales_records where id=p_sale_id;
  end if;

  return v_sale;
end;
$$;
revoke all on function public.admin_approve_sale_credit(uuid,text) from public,anon;
grant execute on function public.admin_approve_sale_credit(uuid,text) to authenticated;
