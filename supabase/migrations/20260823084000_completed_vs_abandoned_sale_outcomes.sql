-- Reps must explicitly report whether a provider attempt completed or was abandoned.
-- A completed, complete McCoy record gets one provisional Live Win while it waits
-- for authoritative provider/Admin verification. Abandoned attempts never become sales.

alter table public.provider_sale_captures
  add column if not exists rep_outcome text,
  add column if not exists rep_outcome_at timestamptz;

alter table public.provider_sale_captures
  drop constraint if exists provider_sale_captures_rep_outcome_check;
alter table public.provider_sale_captures
  add constraint provider_sale_captures_rep_outcome_check
  check (rep_outcome is null or rep_outcome in ('completed', 'abandoned'));

alter table public.sales_records
  add column if not exists rep_reported_outcome text,
  add column if not exists rep_reported_outcome_at timestamptz;

alter table public.sales_records
  drop constraint if exists sales_records_rep_reported_outcome_check;
alter table public.sales_records
  add constraint sales_records_rep_reported_outcome_check
  check (rep_reported_outcome is null or rep_reported_outcome = 'completed');

-- Keep the database provider allowlist aligned with every provider already exposed
-- by the existing McCoy sale-capture flow.
alter table public.sales_records drop constraint if exists sales_records_isp_check;
alter table public.sales_records
  add constraint sales_records_isp_check check (isp in (
    'Quantum', 'Brightspeed', 'AT&T', 'T-Mobile / T-Fiber', 'Kinetic',
    'Fidium', 'Ascend Fiber', 'Lightcurve', 'Ripple Fiber', 'Starlink',
    'DIRECTV', 'Vivint', 'Other'
  ));

comment on column public.provider_sale_captures.rep_outcome is
  'Explicit rep-reported provider attempt outcome. Abandoned captures never create a sales_records row.';
comment on column public.sales_records.rep_reported_outcome is
  'Explicit completed outcome reported in McCoy. This is preliminary and does not itself grant ranking or pay eligibility.';

create or replace function private.publish_completed_sale_pending_live_win()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_origin text := lower(coalesce(new.compensation_snapshot->>'sale_origin', ''));
  v_message text;
begin
  if new.rep_reported_outcome <> 'completed'
     or new.required_metrics_complete is not true
     or new.sale_status = 'not_a_sale'
     or new.ranking_eligible is true
     or new.verification_status = 'verified_processed'
     or v_origin not in ('mccoy_app', 'outside_system') then
    return new;
  end if;

  v_message := format(
    '🎉 %s completed a %s sale — pending Admin verification.',
    new.rep_name,
    new.isp
  );

  insert into public.sales_feed(
    sale_id, rep_user_id, rep_name, isp, internet_product, directv,
    mobile_phone_lines, mobile_device_count, att_mobile_lines, vivint, message,
    celebration_types, celebration_messages, celebration_payload,
    celebration_version, animation_enabled, ranking_eligible_at_event, created_at
  ) values (
    new.id, new.rep_user_id, new.rep_name, new.isp, new.internet_product, coalesce(new.directv, false),
    greatest(coalesce(new.mobile_phone_lines, 0), coalesce(new.att_mobile_lines, 0)),
    coalesce(new.mobile_device_count, 0),
    greatest(coalesce(new.att_mobile_lines, 0), coalesce(new.mobile_phone_lines, 0)),
    coalesce(new.vivint, false),
    v_message,
    array['sale_pending_verification']::text[],
    jsonb_build_array(v_message),
    jsonb_build_object(
      'sale_id', new.id,
      'stage', 'pending_verification',
      'rep_reported_outcome', 'completed'
    ),
    1,
    true,
    false,
    now()
  )
  on conflict (sale_id) do nothing;

  return new;
end;
$$;

revoke all on function private.publish_completed_sale_pending_live_win() from public, anon, authenticated;

drop trigger if exists sales_records_completed_pending_live_win on public.sales_records;
create trigger sales_records_completed_pending_live_win
after insert on public.sales_records
for each row execute function private.publish_completed_sale_pending_live_win();

-- If the existing verified-sale trigger upgrades a provisional feed item later,
-- update the script and ranking state without spraying the same completed sale twice.
create or replace function private.prevent_repeat_completed_sale_celebration()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if coalesce(old.celebration_payload->>'stage', '') = 'pending_verification'
     and new.ranking_eligible_at_event is true then
    new.animation_enabled := false;
    new.celebration_payload := coalesce(new.celebration_payload, '{}'::jsonb) ||
      jsonb_build_object(
        'stage', 'verified',
        'completed_self_report_previously_celebrated', true
      );
  end if;
  return new;
end;
$$;

revoke all on function private.prevent_repeat_completed_sale_celebration() from public, anon, authenticated;

drop trigger if exists sales_feed_prevent_repeat_completed_celebration on public.sales_feed;
create trigger sales_feed_prevent_repeat_completed_celebration
before update on public.sales_feed
for each row execute function private.prevent_repeat_completed_sale_celebration();

-- An Admin denial removes a never-ranked provisional win from the public feed.
create or replace function private.remove_unverified_live_win_if_not_sale()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if new.sale_status = 'not_a_sale'
     or new.admin_review_disposition = 'not_a_sale' then
    delete from public.sales_feed
    where sale_id = new.id
      and ranking_eligible_at_event is false;
  end if;
  return new;
end;
$$;

revoke all on function private.remove_unverified_live_win_if_not_sale() from public, anon, authenticated;

drop trigger if exists sales_records_remove_unverified_live_win_if_not_sale on public.sales_records;
create trigger sales_records_remove_unverified_live_win_if_not_sale
after update of sale_status, admin_review_disposition on public.sales_records
for each row execute function private.remove_unverified_live_win_if_not_sale();

