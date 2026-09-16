-- Removes the Trainee minimum-protection floor specifically for below-1-Gig
-- internet sales, per explicit direction: below-1-Gig sales are unprofitable
-- enough that the company-funded trainee floor should not apply to them,
-- and 1 Gig itself remains the intended minimum sellable tier except where
-- a faster service isn't available. This does not touch the 1 Gig or 2 Gig
-- trainee rates, which remain at $150 -- only the below-1-Gig tier changes,
-- for both AT&T Fiber and Brightspeed (AT&T Fiber below 1 Gig explicitly
-- uses "the Brightspeed-style below-1-Gig reduction" per the source
-- agreement, so both move together).
--
-- This is a deliberate departure from the printed McCoy Platform LLC
-- Independent Sales Representative Agreement (2026-08-13), Section 7.1,
-- which currently states the Trainee base is protected at $150 "regardless
-- of approved ISP or service speed." That contract language itself is not
-- updated by this migration -- only the system's applied rate -- so the
-- written agreement and what the system actually pays will diverge here
-- until the agreement text is separately revised.
--
-- No trigger logic needed changing: recompute_sale_base_commission() does a
-- pure dynamic JSONB lookup against this table with no hardcoded trainee
-- floor of its own, so updating the stored rate is sufficient on its own.
update public.compensation_rules
set rule = jsonb_set(
  jsonb_set(rule, '{att,fiber_below_1_gig,trainee}', '100'),
  '{brightspeed,below_1_gig,trainee}', '100'
)
where active is true;
