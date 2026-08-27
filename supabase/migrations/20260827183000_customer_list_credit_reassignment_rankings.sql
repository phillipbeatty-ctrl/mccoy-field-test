-- Customer List is the approved-sale destination. When Admin changes the credited
-- user there, the selected user must become the authoritative ranking owner.

create or replace function private.enforce_immediate_completed_sale_ranking()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
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
  v_admin_approved_customer_list_credit boolean:=v_admin_decision='approved'
    and new.credit_assigned_by is not null
    and new.credit_assigned_at is not null
    and new.removed_to_bank_at is null;
begin
  if (v_completed_outcome
      or v_admin_approved_provider_credit
      or v_admin_approved_customer_list_credit)
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

create or replace function public.admin_assign_any_sale_user(
  p_sale_id uuid,
  p_rep_email text
)
returns public.sales_records
language plpgsql
security definer
set search_path = pg_catalog, public, auth, private
as $$
declare
  v_actor uuid:=auth.uid();
  v_actor_email text;
  v_org uuid;
  v_target_id uuid;
  v_target_email text;
  v_target_name text;
  v_before public.sales_records%rowtype;
  v_after public.sales_records%rowtype;
  v_customer_list_approved boolean:=false;
  v_reason text;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;

  select lower(u.email),a.organization_id
    into v_actor_email,v_org
  from auth.users u
  join public.app_user_access a on lower(a.email)=lower(u.email)
  where u.id=v_actor and a.active=true and lower(a.role)='admin';
  if v_org is null then raise exception 'Admin access required'; end if;

  select u.id,lower(u.email),coalesce(nullif(trim(a.display_name),''),split_part(u.email,'@',1))
    into v_target_id,v_target_email,v_target_name
  from auth.users u
  join public.app_user_access a on lower(a.email)=lower(u.email)
  where lower(u.email)=lower(trim(coalesce(p_rep_email,'')))
    and a.active=true
    and a.organization_id=v_org
  limit 1;
  if v_target_id is null then raise exception 'Active user not found in Admin organization'; end if;

  select * into v_before
  from public.sales_records
  where id=p_sale_id and organization_id=v_org
  for update;
  if not found then raise exception 'Sale not found in Admin organization'; end if;

  v_customer_list_approved:=
    lower(coalesce(v_before.compensation_snapshot#>>'{admin_approval,status}',''))='approved'
    and v_before.removed_to_bank_at is null;
  v_reason:=case when v_customer_list_approved
    then 'Admin reassigned in CUSTOMER LIST'
    else 'Admin reassigned in SALE REVIEW'
  end;

  update public.sales_records s set
    provider_reported_rep_user_id=coalesce(s.provider_reported_rep_user_id,v_before.rep_user_id),
    provider_reported_rep_email=coalesce(s.provider_reported_rep_email,v_before.rep_email),
    provider_reported_rep_name=coalesce(s.provider_reported_rep_name,v_before.rep_name),
    rep_user_id=v_target_id,
    rep_email=v_target_email,
    rep_name=v_target_name,
    credit_assigned_by=v_actor,
    credit_assigned_at=clock_timestamp(),
    credit_assignment_reason=v_reason,
    sale_status=case
      when v_customer_list_approved and lower(coalesce(s.sale_status,''))='not_a_sale' then 'qualified'
      when v_customer_list_approved and nullif(trim(coalesce(s.sale_status,'')),'') is null then 'qualified'
      else s.sale_status
    end,
    verification_status=case when v_customer_list_approved then 'verified_processed' else s.verification_status end,
    verification_reason=case when v_customer_list_approved then 'admin_sale_review_verified: customer_list_credit_reassignment' else s.verification_reason end,
    verified_at=case when v_customer_list_approved then coalesce(s.verified_at,clock_timestamp()) else s.verified_at end,
    admin_review_disposition=case when v_customer_list_approved then null else s.admin_review_disposition end,
    admin_review_reason=case when v_customer_list_approved then 'Customer List credited user reassigned' else s.admin_review_reason end,
    admin_reviewed_by=case when v_customer_list_approved then v_actor else s.admin_reviewed_by end,
    admin_reviewed_at=case when v_customer_list_approved then clock_timestamp() else s.admin_reviewed_at end,
    ranking_credit_excluded=case when v_customer_list_approved then false else s.ranking_credit_excluded end,
    ranking_eligible=case when v_customer_list_approved then true else s.ranking_eligible end,
    competition_eligible=case when v_customer_list_approved then true else s.competition_eligible end,
    ranking_verified_at=case when v_customer_list_approved then coalesce(s.ranking_verified_at,s.verified_at,clock_timestamp()) else s.ranking_verified_at end
  where s.id=p_sale_id
  returning * into v_after;

  if v_before.rep_user_id is distinct from v_after.rep_user_id then
    insert into public.sale_credit_assignment_history(
      sale_id,previous_rep_user_id,previous_rep_email,previous_rep_name,
      new_rep_user_id,new_rep_email,new_rep_name,
      changed_by_user_id,changed_by_email,reason
    ) values (
      p_sale_id,v_before.rep_user_id,v_before.rep_email,v_before.rep_name,
      v_after.rep_user_id,v_after.rep_email,v_after.rep_name,
      v_actor,v_actor_email,v_reason
    );
  end if;

  if v_before.ranking_eligible is distinct from v_after.ranking_eligible then
    insert into public.sale_ranking_credit_history(
      sale_id,changed_by,changed_by_email,action,
      previous_ranked_rep_user_id,previous_ranked_rep_email,previous_ranked_rep_name,
      new_ranked_rep_user_id,new_ranked_rep_email,new_ranked_rep_name,
      previous_ranking_eligible,new_ranking_eligible,reason
    ) values (
      p_sale_id,v_actor,v_actor_email,
      case when v_after.ranking_eligible then 'restore' else 'exclude' end,
      v_before.rep_user_id,v_before.rep_email,v_before.rep_name,
      v_after.rep_user_id,v_after.rep_email,v_after.rep_name,
      v_before.ranking_eligible,v_after.ranking_eligible,
      v_reason
    );
  end if;

  insert into public.sale_admin_edit_history(
    sale_id,organization_id,changed_by,changed_by_email,action,before_sale,after_sale
  ) values (
    p_sale_id,v_org,v_actor,v_actor_email,'edit',to_jsonb(v_before),to_jsonb(v_after)
  );

  -- The ranking query reads sales_records directly. Keep the historical Live Wins
  -- row consistent as well, without replaying a celebration animation.
  if v_after.ranking_eligible is true then
    update public.sales_feed set
      rep_user_id=v_after.rep_user_id,
      rep_name=v_after.rep_name,
      isp=v_after.isp,
      internet_product=v_after.internet_product,
      directv=coalesce(v_after.directv,false),
      mobile_phone_lines=greatest(coalesce(v_after.mobile_phone_lines,0),coalesce(v_after.att_mobile_lines,0)),
      mobile_device_count=coalesce(v_after.mobile_device_count,0),
      att_mobile_lines=greatest(coalesce(v_after.att_mobile_lines,0),coalesce(v_after.mobile_phone_lines,0)),
      vivint=coalesce(v_after.vivint,false),
      message=format('🎉 %s has completed %s sale credit in the live rankings.',v_after.rep_name,v_after.isp),
      celebration_types=array['sale_credit_updated']::text[],
      celebration_messages=jsonb_build_array(format('🎉 %s has completed %s sale credit in the live rankings.',v_after.rep_name,v_after.isp)),
      celebration_payload=jsonb_build_object('sale_id',v_after.id,'credit_updated',true,'credited_rep_email',v_after.rep_email),
      ranking_eligible_at_event=true,
      animation_enabled=false
    where sale_id=v_after.id;
  end if;

  return v_after;
end;
$$;

revoke all on function public.admin_assign_any_sale_user(uuid,text) from public;
grant execute on function public.admin_assign_any_sale_user(uuid,text) to authenticated;

comment on function public.admin_assign_any_sale_user(uuid,text)
is 'Organization-scoped Admin reassignment. For an approved Customer List sale, the selected user becomes the authoritative ranking owner and the sale is restored to approved ranking state.';

-- Repair only Customer List credit changes made after the Customer List editor
-- was deployed. This predicate currently identifies one reassigned sale.
do $$
declare
  v_before public.sales_records%rowtype;
  v_after public.sales_records%rowtype;
  v_actor_email text;
begin
  for v_before in
    select s.*
    from public.sales_records s
    where s.removed_to_bank_at is null
      and lower(coalesce(s.compensation_snapshot#>>'{admin_approval,status}',''))='approved'
      and s.credit_assignment_reason='Admin reassigned in SALE REVIEW'
      and s.credit_assigned_at>=timestamptz '2026-08-27 17:25:00+00'
      and s.ranking_eligible is not true
    for update
  loop
    update public.sales_records s set
      sale_status=case when lower(coalesce(s.sale_status,''))='not_a_sale' then 'qualified' else coalesce(s.sale_status,'qualified') end,
      verification_status='verified_processed',
      verification_reason='admin_sale_review_verified: customer_list_credit_reassignment_repair',
      verified_at=coalesce(s.verified_at,clock_timestamp()),
      admin_review_disposition=null,
      admin_review_reason='Repaired Customer List credit reassignment',
      admin_reviewed_by=coalesce(s.credit_assigned_by,s.admin_reviewed_by),
      admin_reviewed_at=clock_timestamp(),
      ranking_credit_excluded=false,
      ranking_eligible=true,
      competition_eligible=true,
      ranking_verified_at=coalesce(s.ranking_verified_at,s.verified_at,clock_timestamp()),
      credit_assignment_reason='Admin reassigned in CUSTOMER LIST'
    where s.id=v_before.id
    returning * into v_after;

    select lower(u.email) into v_actor_email
    from auth.users u
    where u.id=coalesce(v_after.credit_assigned_by,v_after.admin_reviewed_by);
    v_actor_email:=coalesce(v_actor_email,v_after.compensation_snapshot#>>'{admin_approval,approved_by}','system');

    if coalesce(v_after.credit_assigned_by,v_after.admin_reviewed_by) is not null then
      insert into public.sale_ranking_credit_history(
        sale_id,changed_by,changed_by_email,action,
        previous_ranked_rep_user_id,previous_ranked_rep_email,previous_ranked_rep_name,
        new_ranked_rep_user_id,new_ranked_rep_email,new_ranked_rep_name,
        previous_ranking_eligible,new_ranking_eligible,reason
      ) values (
        v_after.id,coalesce(v_after.credit_assigned_by,v_after.admin_reviewed_by),v_actor_email,'restore',
        v_before.rep_user_id,v_before.rep_email,v_before.rep_name,
        v_after.rep_user_id,v_after.rep_email,v_after.rep_name,
        v_before.ranking_eligible,v_after.ranking_eligible,
        'Repair Customer List credited-user ranking transfer'
      );

      insert into public.sale_admin_edit_history(
        sale_id,organization_id,changed_by,changed_by_email,action,before_sale,after_sale
      ) values (
        v_after.id,v_after.organization_id,coalesce(v_after.credit_assigned_by,v_after.admin_reviewed_by),v_actor_email,
        'edit',to_jsonb(v_before),to_jsonb(v_after)
      );
    end if;

    if v_after.ranking_eligible is true then
      update public.sales_feed set
        rep_user_id=v_after.rep_user_id,
        rep_name=v_after.rep_name,
        message=format('🎉 %s has completed %s sale credit in the live rankings.',v_after.rep_name,v_after.isp),
        celebration_types=array['sale_credit_updated']::text[],
        celebration_messages=jsonb_build_array(format('🎉 %s has completed %s sale credit in the live rankings.',v_after.rep_name,v_after.isp)),
        celebration_payload=jsonb_build_object('sale_id',v_after.id,'credit_updated',true,'credited_rep_email',v_after.rep_email),
        ranking_eligible_at_event=true,
        animation_enabled=false
      where sale_id=v_after.id;
    end if;
  end loop;
end;
$$;
