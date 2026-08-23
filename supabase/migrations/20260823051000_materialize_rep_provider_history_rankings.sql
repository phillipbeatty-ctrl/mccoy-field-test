-- A rep-account report can grant ranking credit when its authenticated source
-- user and provider seller identity both resolve to the same active McCoy user.
create or replace function private.materialize_rep_provider_ranking()
returns trigger language plpgsql security definer set search_path=pg_catalog,public,auth,private as $$
declare
 v_status text:=lower(trim(coalesce(new.provider_status,''))); v_link public.provider_seller_links%rowtype;
 v_link_count int; v_sale public.sales_records%rowtype; v_name text; v_email text; v_id uuid; v_cancelled boolean;
 v_first text; v_last text;
begin
 if new.evidence_scope<>'rep_account' or new.materialized_sale_id is not null then return new; end if;
 if new.source_rep_user_id is null or new.source_rep_email is null or v_status like '%abandon%' then return new; end if;
 v_cancelled:=v_status like '%cancel%';
 if not v_cancelled and not(v_status like '%completed%' or v_status like '%fulfilled%' or v_status like '%active%' or v_status like '%submitted%') then return new; end if;
 select count(*),(array_agg(l.id order by case when private.provider_identity_key(l.seller_identifier)=private.provider_identity_key(coalesce(new.seller_identifier,'')) then 0 else 1 end,l.updated_at desc))[1]
 into v_link_count,v_id from public.provider_seller_links l
 where l.provider=new.provider and l.active=true and l.rep_user_id=new.source_rep_user_id
 and (private.provider_identity_key(l.seller_identifier) in (
   private.provider_identity_key(coalesce(new.seller_identifier,'')),private.provider_identity_key(coalesce(new.seller_name,'')),private.provider_identity_key(coalesce(new.seller_email,''))
 ) or private.provider_identity_key(coalesce(l.seller_name,''))=private.provider_identity_key(coalesce(new.seller_name,'')));
 if v_link_count=0 then return new; end if;
 select * into v_link from public.provider_seller_links where id=v_id;
 if lower(v_link.rep_email)<>lower(new.source_rep_email) then return new; end if;
 select lower(au.email),coalesce(a.display_name,lower(au.email)) into v_email,v_name
 from auth.users au join public.app_user_access a on lower(a.email)=lower(au.email)
 where au.id=new.source_rep_user_id and a.active=true;
 if v_email is null or v_email<>lower(new.source_rep_email) then return new; end if;
 select s.* into v_sale from public.sales_records s where s.isp=new.provider and (
  (new.order_number is not null and private.provider_identity_key(s.provider_order_number)=private.provider_identity_key(new.order_number)) or
  (new.account_number is not null and private.provider_identity_key(s.provider_account_number)=private.provider_identity_key(new.account_number))
 ) order by s.created_at desc limit 1;
 if v_sale.id is not null then
  if v_sale.rep_user_id=new.source_rep_user_id then
   update public.sales_records set provider_sale_row_id=new.id,provider_reported_rep_user_id=new.source_rep_user_id,
    provider_reported_rep_email=v_email,provider_reported_rep_name=coalesce(v_link.seller_name,v_name),
    verification_status='verified_processed',verification_reason='rep_provider_report_owner_and_seller_match',
    verified_at=coalesce(verified_at,new.sale_date,now()),ranking_eligible=true,
    ranking_verified_at=coalesce(ranking_verified_at,new.sale_date,now()),
    sale_status=case when v_cancelled then 'cancelled' else sale_status end,
    competition_eligible=case when v_cancelled then false else competition_eligible end where id=v_sale.id;
   update public.provider_sales_rows set materialized_sale_id=v_sale.id,
    materialization_status=case when v_cancelled then 'created_rep_cancelled_ranking_retained' else 'linked_rep_ranking_verified' end,
    materialization_reason='Rep provider report owner and seller identity match.',materialized_at=now() where id=new.id;
  end if;
  return new;
 end if;
 v_first:=split_part(trim(coalesce(new.customer_name,'Unknown')),' ',1);
 v_last:=trim(substr(trim(coalesce(new.customer_name,'Unknown')),length(v_first)+1));if v_last='' then v_last:='Unknown';end if;
 insert into public.sales_records(rep_user_id,rep_email,rep_name,lead_label,customer_first_name,customer_last_name,
  service_address,isp,internet_product,provider_order_number,provider_account_number,sale_status,
  verification_status,verification_reason,verified_at,provider_sale_row_id,competition_eligible,ranking_eligible,
  ranking_verified_at,provider_reported_rep_user_id,provider_reported_rep_email,provider_reported_rep_name,
  compensation_snapshot,notes)
 values(new.source_rep_user_id,v_email,v_name,new.service_address,v_first,v_last,new.service_address,new.provider,
  coalesce(new.raw_payload->>'Internet Product Name','Fiber'),new.order_number,new.account_number,
  case when v_cancelled then 'cancelled' else 'reported' end,'verified_processed','rep_provider_report_owner_and_seller_match',
  coalesce(new.sale_date,now()),new.id,false,true,coalesce(new.sale_date,now()),new.source_rep_user_id,v_email,
  coalesce(v_link.seller_name,v_name),jsonb_build_object('sale_origin','rep_provider_history_ranking','accounting_review_required',true),
  'Created from rep provider history for ranking; accounting remains separately reviewed.') returning id into v_id;
 update public.provider_sales_rows set materialized_sale_id=v_id,
  materialization_status=case when v_cancelled then 'created_rep_cancelled_ranking_retained' else 'created_rep_ranking_only' end,
  materialization_reason='Rep provider report owner and seller identity match.',materialized_at=now() where id=new.id;
 return new;
end $$;

drop trigger if exists provider_sales_rows_rep_ranking on public.provider_sales_rows;
create trigger provider_sales_rows_rep_ranking after insert or update on public.provider_sales_rows
for each row execute function private.materialize_rep_provider_ranking();

alter table public.provider_sales_rows drop constraint if exists provider_sales_rows_materialization_status_check;
alter table public.provider_sales_rows add constraint provider_sales_rows_materialization_status_check check(materialization_status in(
 'pending','linked_existing_sale','created_pending_review','unmatched_seller','unmatched_capture','ambiguous_capture',
 'provider_cancelled','provider_abandoned','not_completed','seller_mismatch_review','ambiguous_seller_review',
 'linked_cancelled_ranking_retained','linked_existing_ranking_verified','created_cancelled_ranking_retained',
 'created_ranking_only_unmatched_capture','created_ranking_verified_accounting_review',
 'linked_rep_ranking_verified','created_rep_ranking_only','created_rep_cancelled_ranking_retained'));

update public.provider_sales_rows set materialization_reason=materialization_reason
where evidence_scope='rep_account' and materialized_sale_id is null;
