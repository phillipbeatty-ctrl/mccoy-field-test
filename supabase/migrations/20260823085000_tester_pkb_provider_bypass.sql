-- A narrowly scoped simulation exception for the dedicated Tester PKB account.
-- These records intentionally count in rankings and accounting so the complete
-- live-sale experience can be tested without placing an order in an ISP portal.

alter table public.sales_records
  drop constraint if exists sales_records_tester_pkb_simulation_identity_check;

alter table public.sales_records
  add constraint sales_records_tester_pkb_simulation_identity_check check (
    verification_reason <> 'tester_pkb_simulation_authorized'
    or (
      lower(trim(rep_email)) = 'phillipkbeatty@gmail.com'
      and lower(trim(rep_name)) = 'tester pkb'
      and provider_sale_row_id is null
      and compensation_snapshot#>>'{tester_simulation,enabled}' = 'true'
      and compensation_snapshot#>>'{tester_simulation,provider_dashboard_bypassed}' = 'true'
      and compensation_snapshot#>>'{tester_simulation,provider_evidence_claimed}' = 'false'
    )
  );

comment on constraint sales_records_tester_pkb_simulation_identity_check on public.sales_records is
  'Prevents the Tester PKB no-provider simulation authority from being attributed to another McCoy account or represented as ISP evidence.';

