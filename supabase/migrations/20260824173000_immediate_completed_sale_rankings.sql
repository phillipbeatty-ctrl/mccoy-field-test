-- Completed McCoy sale submissions enter rankings at commit time. Provider
-- verification remains available for accounting, competition evidence, and
-- review; it no longer delays the live ranking.

create or replace function private.enforce_immediate_completed_sale_ranking()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public,private
as $$
declare
  v_origin text:=lower(coalesce(new.compensation_snapshot->>'sale_origin',''));
  v_outside_decision text:=lower(coalesce(new.compensation_snapshot#>>'{admin_approval,status}',''));
begin
  if new.rep_reported_outcome='completed'
     and new.required_metrics_complete is true
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
before insert or update of rep_reported_outcome,required_metrics_complete,sale_status,admin_review_disposition,ranking_credit_excluded,compensation_snapshot,ranking_eligible,ranking_verified_at
on public.sales_records
for each row execute function private.enforce_immediate_completed_sale_ranking();

do $migration$
declare
  v_def text:=pg_get_functiondef('private.get_verified_sales_rankings_unredacted()'::regprocedure);
  v_old text;
begin
  v_old:=$text$      and sr.verification_status = 'verified_processed'
$text$;
  if (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 then
    raise exception 'ranking definition verification filter changed; refusing unsafe patch';
  end if;
  v_def:=replace(v_def,v_old,'');

  v_old:=$text$      and (
        coalesce(sr.compensation_snapshot->>'sale_origin', '') <> 'outside_system'
        or lower(coalesce(sr.compensation_snapshot#>>'{admin_approval,status}', '')) = 'approved'
      )
      and (
        coalesce(sr.compensation_snapshot->>'sale_context', '') <> 'out_of_area_phone'
        or lower(coalesce(sr.compensation_snapshot#>>'{admin_approval,status}', '')) = 'approved'
      )
$text$;
  if (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 then
    raise exception 'ranking definition outside-system filter changed; refusing unsafe patch';
  end if;
  v_def:=replace(v_def,v_old,'');

  v_old:=$text$      and not (sr.competition_eligible is true and sr.verification_status = 'verified_processed')$text$;
  if (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 then
    raise exception 'ranking definition pending filter changed; refusing unsafe patch';
  end if;
  v_def:=replace(v_def,v_old,'      and sr.ranking_eligible is not true');
  v_def:=replace(v_def,'provider_verified_ranking_credit_cancellations_accounting_only','completed_mccoy_sales_immediate_provider_verification_accounting_only');
  v_def:=replace(v_def,'verified_week_sales_divided_by_capped_tracked_field_session_hours','completed_week_sales_divided_by_capped_tracked_field_session_hours');
  execute v_def;
end;
$migration$;

do $migration$
declare
  v_def text:=pg_get_functiondef('private.get_authoritative_sph_metrics()'::regprocedure);
  v_old text:=$text$  where sr.ranking_eligible is true and sr.verification_status='verified_processed'$text$;
  v_outside text:=$text$    and (coalesce(sr.compensation_snapshot->>'sale_origin','')<>'outside_system'
      or lower(coalesce(sr.compensation_snapshot#>>'{admin_approval,status}',''))='approved')
    and (coalesce(sr.compensation_snapshot->>'sale_context','')<>'out_of_area_phone'
      or lower(coalesce(sr.compensation_snapshot#>>'{admin_approval,status}',''))='approved')
$text$;
begin
  if (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 then
    raise exception 'SPH definition verification filter changed; refusing unsafe patch';
  end if;
  if (length(v_def)-length(replace(v_def,v_outside,'')))/length(v_outside)<>1 then
    raise exception 'SPH definition outside-system filter changed; refusing unsafe patch';
  end if;
  v_def:=replace(v_def,v_old,'  where sr.ranking_eligible is true');
  v_def:=replace(v_def,v_outside,'');
  execute v_def;
end;
$migration$;

do $migration$
declare
  v_def text:=pg_get_functiondef('private.publish_verified_sale_live_win()'::regprocedure);
  v_old text;
begin
  v_old:=$text$  if new.ranking_eligible is not true or new.verification_status <> 'verified_processed' then$text$;
  if (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 then
    raise exception 'live-win eligibility guard changed; refusing unsafe patch';
  end if;
  v_def:=replace(v_def,v_old,'  if new.ranking_eligible is not true then');

  v_old:=$text$    where s.ranking_eligible is true and s.verification_status = 'verified_processed'$text$;
  if (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 then
    raise exception 'live-win record filter changed; refusing unsafe patch';
  end if;
  v_def:=replace(v_def,v_old,'    where s.ranking_eligible is true');

  v_old:=$text$      and s.verification_status = 'verified_processed'
$text$;
  if (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 then
    raise exception 'live-win milestone filter changed; refusing unsafe patch';
  end if;
  v_def:=replace(v_def,v_old,'');
  v_def:=replace(v_def,' verified ',' completed ');
  execute v_def;
end;
$migration$;

comment on function private.enforce_immediate_completed_sale_ranking() is
  'Makes a complete, non-rejected McCoy sale ranking-eligible immediately; provider evidence remains an accounting/review concern.';
comment on column public.sales_records.ranking_eligible is
  'True immediately for complete McCoy sales unless abandoned, incomplete, rejected, marked not-a-sale, or explicitly excluded.';
