-- Adds genuinely new information from this round of uploaded rate cards.
-- AT_T_Internet_Comm_2.pdf is confirmed byte-for-byte identical (md5 match)
-- to AT_T_Internet_Comm.pdf, already processed and already explicitly
-- superseded by owner decision in favor of the 6/16/26 ATT SBS guide -- no
-- base-rate change from it. Its "Migrations from Copper to Fiber" table is
-- new, though: no att_migration entry existed before this.
--
-- Quantum_Fiber_D2D_Comm.pdf fills the single most urgent gap from the last
-- audit (70 of 77 real Quantum sales showing $0.00). Its structure is
-- volume-tiered (accounts/month: 1-49/50-199/200+), not speed-tiered like
-- every other provider here -- a genuinely different axis this trigger has
-- no concept of tracking. The document itself describes a two-stage
-- payment process: weekly activations fund at the Tier 1 rate, with
-- upward adjustment to higher tiers happening later via monthly
-- reconciliation once actual volume is known. Implementing only the
-- guaranteed Tier 1 rate ($400) matches what's actually paid by default and
-- avoids overstating gross commission on a monthly volume this system does
-- not yet track -- explicitly not the same as full support for this rate
-- card, which would need a running monthly-volume count per dealer.
--
-- Lumen_D2D_Econ.pdf's Fiber rates are confirmed identical to Quantum's
-- current card (same $400/$425/$450), consistent with Lumen being the
-- parent brand of Quantum/CenturyLink Fiber -- the newer Quantum card
-- supersedes it. But Lumen's non-fiber broadband (1-9mbps, 10+mbps) and
-- phone-only rates have no equivalent in the Quantum card at all, and the
-- Lumen document is dated 9/12/2024, over a year older than everything else
-- in this table -- not confirmed current. Recorded as-is with that caveat
-- in source_documents rather than silently treated as verified.
--
-- AT&T Mobility (AT_T_Mobility_Comm.pdf) is entirely new terrain for this
-- table -- dealer_payout_rules had zero mobile-line rates before this; the
-- trigger's dealer-gross side only ever looked at internet speed or DIRECTV
-- package. Extending it to also total mobile-line dealer commission when a
-- sale carries mobile lines, additively with whatever internet commission
-- already applies (matching how AT&T mobile already works additively on
-- the separate rep-pay side).

update public.dealer_payout_rules
set rule = rule
  || jsonb_build_object(
    'att_migration', jsonb_build_array(
      jsonb_build_object('rate', 150, 'min_speed', 1000),
      jsonb_build_object('rate', 100, 'min_speed', 500),
      jsonb_build_object('rate', 75, 'min_speed', 0)
    ),
    'quantum_tier1_only', jsonb_build_object('rate', 400),
    'lumen_broadband_unconfirmed_2024', jsonb_build_object(
      '1_to_9_mbps_tier1', 115, '10_plus_mbps_tier1', 135,
      'phone_only_voice_package_tier1', 70
    ),
    'att_mobility', jsonb_build_object(
      'new_voice_gross_add_per_line', 150,
      'next_up_installment_bonus', 25,
      'unlimited_extra_bonus', 25,
      'unlimited_premium_bonus', 35,
      'auto_bill_pay_bonus', 10,
      'voice_line_upgrade', 45,
      'wearable_tablet_per_line', 40,
      'oof_vga_incentive', 50
    )
  )
  || jsonb_build_object(
    'source_documents', (rule->'source_documents') || jsonb_build_object(
      'att_migration', 'AT_T_Internet_Comm_2.pdf (base new-subscriber rates confirmed identical, md5-verified, to already-superseded AT_T_Internet_Comm.pdf; migration table is new)',
      'quantum_tier1_only', 'Quantum_Fiber_D2D_Comm.pdf, updated 1/30/2026 -- Tier 1 of 3 volume tiers only; Tiers 2 ($425) and 3 ($450) require monthly per-dealer volume tracking not yet implemented',
      'lumen_broadband_unconfirmed_2024', 'Lumen_D2D_Econ.pdf, dated 9/12/2024 -- fiber rates confirmed identical to and superseded by the current Quantum card; non-fiber rates have no newer source and are not confirmed still current',
      'att_mobility', 'AT_T_Mobility_Comm.pdf, updated 1/1/2026'
    ),
    'not_yet_computable', (
      select coalesce(jsonb_agg(elem), '[]'::jsonb)
      from jsonb_array_elements(rule->'not_yet_computable') elem
      where elem <> '"quantum_any"'
    ) || jsonb_build_array(
      'quantum_volume_tier_2_and_3',
      'att_mobility_smf_2_percent_recurring',
      'lumen_non_fiber_rates_unconfirmed_current'
    )
  )
where active is true;

create or replace function private.recompute_sale_base_commission()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private'
as $function$
declare
  v_rule jsonb;
  v_level text;
  v_speed integer;
  v_tier text;
  v_base numeric;
  v_lines integer;
  v_mobile numeric;
  v_dealer_rule jsonb;
  v_dealer_tiers jsonb;
  v_dealer_rate numeric;
  v_dealer_total numeric;
  v_directv_package text;
  v_dealer_lines integer;
  v_dealer_mobile numeric;
begin
  if TG_OP = 'UPDATE'
    and NEW.isp is not distinct from OLD.isp
    and NEW.internet_product is not distinct from OLD.internet_product
    and NEW.internet_speed_mbps is not distinct from OLD.internet_speed_mbps
    and NEW.mobile_phone_lines is not distinct from OLD.mobile_phone_lines
    and NEW.att_mobile_lines is not distinct from OLD.att_mobile_lines
    and NEW.account_type is not distinct from OLD.account_type
    and NEW.is_migration is not distinct from OLD.is_migration
    and NEW.directv_service is not distinct from OLD.directv_service
  then
    return NEW;
  end if;

  v_speed := greatest(0, round(coalesce(NEW.internet_speed_mbps, 0))::integer);

  select rule into v_rule from public.compensation_rules where active limit 1;
  if v_rule is not null then
    v_level := NEW.compensation_snapshot->>'pay_level';
    if v_level is not null and NEW.isp is not null then
      if NEW.isp = 'Quantum' then
        v_base := nullif(v_rule->'quantum'->>v_level, '')::numeric;
      elsif NEW.isp = 'Brightspeed' then
        v_tier := case when v_speed >= 2000 then '2_gig' when v_speed >= 1000 then '1_gig' else 'below_1_gig' end;
        v_base := nullif(v_rule->'brightspeed'->v_tier->>v_level, '')::numeric;
      elsif NEW.isp = 'AT&T' and NEW.internet_product = 'Internet Air' then
        v_base := nullif(v_rule->'att'->>'internet_air', '')::numeric;
      elsif NEW.isp = 'AT&T' and NEW.internet_product = 'Fiber' then
        v_tier := case when v_speed >= 1000 then 'fiber_1_gig' else 'fiber_below_1_gig' end;
        v_base := nullif(v_rule->'att'->v_tier->>v_level, '')::numeric;
      else
        v_base := null;
      end if;

      v_lines := greatest(0, least(20, round(coalesce(NEW.mobile_phone_lines, NEW.att_mobile_lines, 0))::integer));
      if v_lines > 0 then
        v_mobile := coalesce(nullif(v_rule->'att'->>'mobile_first_line','')::numeric, 0)
          + greatest(0, v_lines - 1) * coalesce(nullif(v_rule->'att'->>'mobile_additional_line','')::numeric, 0);
      else
        v_mobile := 0;
      end if;

      NEW.compensation_snapshot := coalesce(NEW.compensation_snapshot, '{}'::jsonb) || jsonb_build_object(
        'base_commission', v_base,
        'att_mobile_originating_commission', v_mobile,
        'mobile_phone_lines', v_lines,
        'commission_last_computed_at', now()
      );
    end if;
  end if;

  select rule into v_dealer_rule from public.dealer_payout_rules where active limit 1;
  if v_dealer_rule is not null then
    v_dealer_total := null;

    if NEW.directv is true and NEW.directv_service is not null and coalesce(NEW.account_type,'') = 'business' then
      v_directv_package := upper(trim(NEW.directv_service));
      v_dealer_rate := nullif(v_dealer_rule->'directv_business_by_package'->>v_directv_package, '')::numeric;
      if v_dealer_rate is not null then
        v_dealer_total := coalesce(v_dealer_total, 0) + v_dealer_rate;
      end if;
    end if;

    if NEW.isp is not null and (NEW.internet_product is not null or NEW.internet_speed_mbps is not null) then
      v_dealer_tiers := case
        when NEW.isp = 'Brightspeed' and NEW.is_migration is true and coalesce(NEW.account_type,'residential') = 'residential' then v_dealer_rule->'brightspeed_migration'
        when NEW.isp = 'Brightspeed' and coalesce(NEW.account_type,'residential') = 'residential' then v_dealer_rule->'brightspeed_new_subscriber'
        when NEW.isp = 'T-Mobile / T-Fiber' and coalesce(NEW.account_type,'residential') = 'residential' then v_dealer_rule->'t_fiber'
        when NEW.isp = 'AT&T' and NEW.is_migration is true and coalesce(NEW.account_type,'residential') = 'residential' then v_dealer_rule->'att_migration'
        when NEW.isp = 'AT&T' and coalesce(NEW.account_type,'residential') = 'residential' then v_dealer_rule->'att_consumer'
        when NEW.isp = 'AT&T' and NEW.account_type = 'business' then v_dealer_rule->'att_business'
        else null
      end;
      if v_dealer_tiers is not null then
        select (tier->>'rate')::numeric into v_dealer_rate
        from jsonb_array_elements(v_dealer_tiers) as tier
        where (tier->>'min_speed')::integer <= v_speed
        order by (tier->>'min_speed')::integer desc
        limit 1;
        if v_dealer_rate is not null then
          v_dealer_total := coalesce(v_dealer_total, 0) + v_dealer_rate;
        end if;
      end if;

      -- Quantum: conservative Tier 1 rate only, applied per fiber sale
      -- regardless of the dealer's actual monthly volume, since that
      -- higher-tier eligibility isn't tracked yet -- see migration comment.
      if NEW.isp = 'Quantum' and coalesce(NEW.account_type,'residential') = 'residential' then
        v_dealer_rate := nullif(v_dealer_rule->'quantum_tier1_only'->>'rate','')::numeric;
        if v_dealer_rate is not null then
          v_dealer_total := coalesce(v_dealer_total, 0) + v_dealer_rate;
        end if;
      end if;
    end if;

    -- AT&T Mobility: additive on top of any internet commission on the same
    -- row, matching how mobile lines already work additively on the
    -- separate rep-pay side of this same trigger above.
    if NEW.isp = 'AT&T' then
      v_dealer_lines := greatest(0, least(20, round(coalesce(NEW.mobile_phone_lines, NEW.att_mobile_lines, 0))::integer));
      if v_dealer_lines > 0 then
        v_dealer_mobile := v_dealer_lines * coalesce(nullif(v_dealer_rule->'att_mobility'->>'new_voice_gross_add_per_line','')::numeric, 0);
        if v_dealer_mobile > 0 then
          v_dealer_total := coalesce(v_dealer_total, 0) + v_dealer_mobile;
        end if;
      end if;
    end if;

    if v_dealer_total is not null then
      NEW.commission_gross_amount := v_dealer_total;
    end if;
  end if;

  return NEW;
end;
$function$;
