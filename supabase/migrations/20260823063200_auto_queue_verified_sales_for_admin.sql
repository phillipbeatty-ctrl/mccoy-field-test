-- The Sale Credit REVIEW QUEUE is the Admin's operational verification inbox.
-- A complete provider-verified sale enters automatically until the explicit
-- one-click APPROVED transaction records its durable Admin approval.
create or replace function private.queue_verified_sale_for_admin_review()
returns trigger
language plpgsql
set search_path=pg_catalog,public
as $$
declare
  v_explicitly_approved boolean:=
    lower(coalesce(new.compensation_snapshot#>>'{admin_approval,status}',''))='approved';
begin
  if new.verification_status='verified_processed'
     and new.required_metrics_complete is true
     and new.sale_status<>'not_a_sale'
     and new.admin_review_disposition is distinct from 'not_a_sale'
     and new.ranking_credit_excluded is not true
     and not v_explicitly_approved
     and new.sale_credit_review_queued is not true then
    new.sale_credit_review_queued:=true;
    new.sale_credit_review_queued_at:=now();
    new.sale_credit_review_queued_by:=null;
    new.sale_credit_review_queue_reason:='Automatic Admin verification required';
  end if;
  return new;
end;
$$;
revoke all on function private.queue_verified_sale_for_admin_review() from public,anon,authenticated;

drop trigger if exists sales_records_auto_admin_review_queue on public.sales_records;
create trigger sales_records_auto_admin_review_queue
before insert or update of verification_status,verification_reason,required_metrics_complete,
  sale_status,admin_review_disposition,ranking_credit_excluded,compensation_snapshot
on public.sales_records
for each row execute function private.queue_verified_sale_for_admin_review();

update public.sales_records set
  sale_credit_review_queued=true,
  sale_credit_review_queued_at=coalesce(sale_credit_review_queued_at,now()),
  sale_credit_review_queued_by=null,
  sale_credit_review_queue_reason=coalesce(sale_credit_review_queue_reason,'Automatic Admin verification required')
where verification_status='verified_processed'
  and required_metrics_complete is true
  and sale_status<>'not_a_sale'
  and admin_review_disposition is distinct from 'not_a_sale'
  and ranking_credit_excluded is not true
  and lower(coalesce(compensation_snapshot#>>'{admin_approval,status}',''))<>'approved'
  and sale_credit_review_queued is not true;

comment on function private.queue_verified_sale_for_admin_review() is
  'Automatically queues complete verified sales for one-click Admin verification. Durable Admin approval prevents re-queue on provider resync.';
