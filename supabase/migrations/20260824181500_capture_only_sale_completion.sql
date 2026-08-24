-- Reps only report whether the provider attempt completed or was abandoned.
-- Customer/order evidence remains nullable until provider reconciliation or Admin review.
alter table public.sales_records
  alter column customer_first_name drop not null,
  alter column customer_last_name drop not null,
  alter column service_address drop not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname='sales_records_capture_only_completion_check'
      and conrelid='public.sales_records'::regclass
  ) then
    alter table public.sales_records
      add constraint sales_records_capture_only_completion_check
      check (
        coalesce(compensation_snapshot#>>'{capture_only_completion,enabled}','false')<>'true'
        or (provider_capture_id is not null and rep_reported_outcome='completed')
      ) not valid;
  end if;
end;
$$;

alter table public.sales_records
  validate constraint sales_records_capture_only_completion_check;

create or replace function private.enforce_immediate_completed_sale_ranking()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public,private
as $$
declare
  v_origin text:=lower(coalesce(new.compensation_snapshot->>'sale_origin',''));
  v_outside_decision text:=lower(coalesce(new.compensation_snapshot#>>'{admin_approval,status}',''));
  v_capture_only boolean:=new.provider_capture_id is not null
    and coalesce(new.compensation_snapshot#>>'{capture_only_completion,enabled}','false')='true';
begin
  if new.rep_reported_outcome='completed'
     and (new.required_metrics_complete is true or v_capture_only)
     and lower(coalesce(new.sale_status,''))<>'not_a_sale'
     and lower(coalesce(new.admin_review_disposition,''))<>'not_a_sale'
     and new.ranking_credit_excluded is not true
     and not (v_origin='outside_system' and v_outside_decision='rejected') then
    new.ranking_eligible:=true;
    new.ranking_verified_at:=coalesce(new.ranking_verified_at,clock_timestamp());
  else
    new.ranking_eligible:=false;
    new.ranking_verified_at:=null;
  end if;
  return new;
end;
$$;

revoke all on function private.enforce_immediate_completed_sale_ranking() from public,anon,authenticated;

drop trigger if exists sales_records_zz_processed_ranking_policy on public.sales_records;
create trigger sales_records_zz_processed_ranking_policy
before insert or update of rep_reported_outcome,required_metrics_complete,sale_status,
  admin_review_disposition,ranking_credit_excluded,compensation_snapshot,
  provider_capture_id,ranking_eligible,ranking_verified_at
on public.sales_records
for each row execute function private.enforce_immediate_completed_sale_ranking();

comment on function private.enforce_immediate_completed_sale_ranking() is
  'Ranks an owned capture-backed completed outcome immediately without requiring customer/order data; disqualified and abandoned attempts never rank.';
comment on column public.sales_records.customer_first_name is
  'Nullable because McCoy no longer asks the rep to re-enter customer information after returning from an ISP dashboard.';
comment on column public.sales_records.customer_last_name is
  'Nullable because McCoy no longer asks the rep to re-enter customer information after returning from an ISP dashboard.';
comment on column public.sales_records.service_address is
  'Optional lead context captured before provider routing; it is not required after the provider sale attempt.';
comment on column public.sales_records.ranking_eligible is
  'True immediately for an owned capture-backed completed outcome or a metrics-complete sale unless rejected, marked not-a-sale, or explicitly excluded.';
