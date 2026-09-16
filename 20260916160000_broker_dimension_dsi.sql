-- New structural fact: sales can now go through two different brokers --
-- RS&I (existing: AT&T, Quantum, Brightspeed) and DSI (Vivint, DIRECTV,
-- Ziply Fiber, Ripple, Fidium, EarthLink, HawaiianTelecom, and soon some
-- reps selling Brightspeed at a DIFFERENT rate than the RS&I one already
-- on file: $600/2Gig via DSI vs $550 via RS&I). Commission rate is
-- therefore a function of (broker, provider), not provider alone -- this
-- was not previously true anywhere in this schema.
--
-- All existing sales predate this concept and were made through RS&I, so
-- they are explicitly backfilled to 'RS&I' rather than left null/ambiguous.

alter table public.sales_records
  add column broker text not null default 'RS&I';

update public.sales_records set broker = 'RS&I';

alter table public.sales_records
  add constraint sales_records_broker_check
  check (broker = any (array['RS&I'::text, 'DSI'::text]));

alter table public.sales_records drop constraint sales_records_isp_check;
alter table public.sales_records add constraint sales_records_isp_check
  check (isp = any (array[
    'Quantum'::text, 'Brightspeed'::text, 'AT&T'::text, 'T-Mobile / T-Fiber'::text,
    'Kinetic'::text, 'Fidium'::text, 'Ziply'::text, 'Ascend Fiber'::text,
    'Lightcurve'::text, 'Ripple Fiber'::text, 'Starlink'::text, 'DIRECTV'::text,
    'Vivint'::text, 'EarthLink'::text, 'HawaiianTelecom'::text, 'Other'::text
  ]));

-- Only one DSI rate is actually confirmed right now (Brightspeed 2 Gig,
-- $600). Every other DSI provider -- Vivint, DIRECTV, Ziply, Ripple,
-- Fidium, EarthLink, HawaiianTelecom -- has no rate card at all yet, so
-- nothing is invented for them; they're named explicitly in
-- not_yet_computable so this gap stays visible rather than silently
-- defaulting to $0 or, worse, incorrectly inheriting the RS&I table.
update public.dealer_payout_rules
set rule = rule
  || jsonb_build_object(
    'dsi_brightspeed_new_subscriber', jsonb_build_array(
      jsonb_build_object('rate', 600, 'min_speed', 2000)
    )
  )
  || jsonb_build_object(
    'source_documents', (rule->'source_documents') || jsonb_build_object(
      'dsi_brightspeed_new_subscriber', 'User-confirmed 2026-09-16: $600 for 2 Gig via DSI, vs $550 via RS&I. Only this one tier confirmed -- 1 Gig, below-1-Gig and migration rates via DSI are unknown.'
    ),
    'not_yet_computable', (rule->'not_yet_computable') || jsonb_build_array(
      'dsi_brightspeed_tiers_other_than_2gig',
      'dsi_vivint_all_rates', 'dsi_directv_all_rates', 'dsi_ziply_all_rates',
      'dsi_ripple_fiber_all_rates', 'dsi_fidium_all_rates',
      'dsi_earthlink_all_rates', 'dsi_hawaiiantelecom_all_rates'
    )
  )
where active is true;
