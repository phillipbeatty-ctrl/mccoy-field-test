-- Keep the two-button outcome rule for McCoy captures while also honoring an
-- explicit Admin credit applied to complete, verified provider evidence.
-- The previous trigger required rep_reported_outcome='completed' for every
-- source, so it silently reversed ranking_eligible=true inside
-- admin_apply_sale_credit for provider-imported rows.

create or replace function private.enforce_immediate_completed_sale_ranking()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public,private
as $$
declare
  v_origin text:=lower(coalesce(new.compensation_snapshot->>'sale_origin',''));
  v_admin_decision text:=lower(coalesce(new.compensation_snapshot#>>'{admin_approval,status}',''));
  v_capture_only boolean:=new.provider_capture_id is not null
    and coalesce(new.compensation_snapshot#>>'{capture_only_completion,enabled}','false')='true';
  v_completed_outcome boolean:=new.rep_reported_outcome='completed'
    and (new.required_metrics_complete is true or v_capture_only);
  v_admin_approved_provider_credit boolean:=new.provider_sale_row_id is not null
    and new.required_metrics_complete is true
    and lower(coalesce(new.verification_status,''))='verified_processed'
    and v_admin_decision='approved'
    and new.credit_assigned_by is not null
    and new.credit_assigned_at is not null;
begin
  if (v_completed_outcome or v_admin_approved_provider_credit)
     and lower(coalesce(new.sale_status,''))<>'not_a_sale'
     and lower(coalesce(new.admin_review_disposition,''))<>'not_a_sale'
     and new.ranking_credit_excluded is not true
     and not (v_origin='outside_system' and v_admin_decision='rejected') then
    new.ranking_eligible:=true;
    new.ranking_verified_at:=coalesce(new.ranking_verified_at,new.verified_at,clock_timestamp());
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
  provider_capture_id,provider_sale_row_id,verification_status,
  credit_assigned_by,credit_assigned_at,ranking_eligible,ranking_verified_at
on public.sales_records
for each row execute function private.enforce_immediate_completed_sale_ranking();

-- Restore only the exact provider-materialized credits that an Admin already
-- approved, verified, completed for required evidence, and did not exclude.
-- Do not invent a rep outcome for historical imports. The Live Wins trigger
-- already suppresses replay for this historical provider origin.
with restored as (
  update public.sales_records s
  set ranking_eligible=true,
      ranking_verified_at=coalesce(s.ranking_verified_at,s.verified_at,s.credit_assigned_at,clock_timestamp())
  where s.ranking_eligible is false
    and s.provider_sale_row_id is not null
    and s.required_metrics_complete is true
    and lower(coalesce(s.verification_status,''))='verified_processed'
    and lower(coalesce(s.compensation_snapshot#>>'{admin_approval,status}',''))='approved'
    and coalesce(s.compensation_snapshot->>'sale_origin','')='authoritative_provider_ranking_materialization'
    and s.credit_assigned_by is not null
    and s.credit_assigned_at is not null
    and s.ranking_credit_excluded is not true
    and lower(coalesce(s.sale_status,''))<>'not_a_sale'
    and lower(coalesce(s.admin_review_disposition,''))<>'not_a_sale'
  returning s.*
)
insert into public.sale_ranking_credit_history(
  sale_id,changed_by,changed_by_email,action,
  previous_ranked_rep_user_id,previous_ranked_rep_email,previous_ranked_rep_name,
  new_ranked_rep_user_id,new_ranked_rep_email,new_ranked_rep_name,
  previous_ranking_eligible,new_ranking_eligible,reason
)
select
  r.id,r.credit_assigned_by,
  coalesce(nullif(lower(r.compensation_snapshot#>>'{admin_approval,approved_by}'),''),lower(u.email)),
  'restore',
  r.rep_user_id,r.rep_email,r.rep_name,
  r.rep_user_id,r.rep_email,r.rep_name,
  false,true,
  'Restored Admin-approved provider credit after two-button ranking trigger correction'
from restored r
join auth.users u on u.id=r.credit_assigned_by
where r.ranking_eligible is true;

do $$
begin
  if exists (
    select 1
    from public.sales_records s
    where s.provider_sale_row_id is not null
      and s.required_metrics_complete is true
      and lower(coalesce(s.verification_status,''))='verified_processed'
      and lower(coalesce(s.compensation_snapshot#>>'{admin_approval,status}',''))='approved'
      and coalesce(s.compensation_snapshot->>'sale_origin','')='authoritative_provider_ranking_materialization'
      and s.credit_assigned_by is not null
      and s.credit_assigned_at is not null
      and s.ranking_credit_excluded is not true
      and lower(coalesce(s.sale_status,''))<>'not_a_sale'
      and lower(coalesce(s.admin_review_disposition,''))<>'not_a_sale'
      and s.ranking_eligible is not true
  ) then
    raise exception 'Admin-approved provider credit backfill did not produce ranking eligibility';
  end if;
end;
$$;

comment on function private.enforce_immediate_completed_sale_ranking() is
  'Ranks either a completed McCoy two-button outcome or an explicit Admin-approved, complete, verified provider credit; shared rejection, not-a-sale, and No Rep controls remain authoritative.';
comment on column public.sales_records.ranking_eligible is
  'True for completed McCoy outcomes and Admin-approved verified provider credits unless rejected, marked not-a-sale, or explicitly excluded.';
