-- Corporate/dealer provider evidence is sufficient for ranking credit when the
-- seller maps uniquely to an active McCoy user. A missing McCoy capture still
-- blocks accounting eligibility and payment until Admin review.

create or replace function private.materialize_authoritative_provider_ranking()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, auth, private
as $$
declare
  v_status text := lower(trim(coalesce(new.provider_status,'')));
  v_seller public.provider_seller_links%rowtype;
  v_seller_count integer;
  v_existing public.sales_records%rowtype;
  v_rep_email text;
  v_rep_name text;
  v_customer_first text;
  v_customer_last text;
  v_capture_id uuid;
  v_capture_count integer;
  v_sale_id uuid;
  v_cancelled boolean := false;
begin
  if new.evidence_scope <> 'dealer_account' or new.materialized_sale_id is not null then return new; end if;
  if v_status like '%abandon%' then return new; end if;
  v_cancelled := v_status like '%cancel%';
  if not v_cancelled and not (v_status like '%completed%' or v_status like '%fulfilled%' or v_status like '%active%' or v_status like '%submitted%') then return new; end if;

  select count(distinct l.rep_user_id), (array_agg(l.id order by
      case when private.provider_identity_key(l.seller_identifier)=private.provider_identity_key(coalesce(new.seller_identifier,'')) then 0 else 1 end,
      l.updated_at desc))[1]
    into v_seller_count, v_capture_id
  from public.provider_seller_links l
  where l.provider=new.provider and l.active=true
    and (
      private.provider_identity_key(l.seller_identifier) in (
        private.provider_identity_key(coalesce(new.seller_identifier,'')),
        private.provider_identity_key(coalesce(new.seller_name,'')),
        private.provider_identity_key(coalesce(new.seller_email,''))
      )
      or private.provider_identity_key(coalesce(l.seller_name,'')) in (
        private.provider_identity_key(coalesce(new.seller_identifier,'')),
        private.provider_identity_key(coalesce(new.seller_name,''))
      )
    );
  if v_seller_count <> 1 then return new; end if;
  select * into v_seller from public.provider_seller_links where id=v_capture_id;

  select s.* into v_existing from public.sales_records s
  where s.isp=new.provider and (
    (new.order_number is not null and private.provider_identity_key(s.provider_order_number)=private.provider_identity_key(new.order_number)) or
    (new.account_number is not null and private.provider_identity_key(s.provider_account_number)=private.provider_identity_key(new.account_number))
  ) order by s.created_at desc limit 1;

  if v_existing.id is not null then
    if v_existing.rep_user_id=v_seller.rep_user_id then
      update public.sales_records set
        provider_sale_row_id=new.id,
        provider_reported_rep_user_id=v_seller.rep_user_id,
        provider_reported_rep_email=v_seller.rep_email,
        provider_reported_rep_name=coalesce(v_seller.seller_name,v_seller.rep_email),
        verification_status='verified_processed',
        verification_reason='authoritative_provider_report_seller_match',
        verified_at=coalesce(verified_at,now()),
        ranking_eligible=true,
        ranking_verified_at=coalesce(ranking_verified_at,new.sale_date,now()),
        sale_status=case when v_cancelled then 'cancelled' else sale_status end,
        competition_eligible=case when v_cancelled then false else competition_eligible end
      where id=v_existing.id;
      update public.provider_sales_rows set
        materialization_status=case when v_cancelled then 'linked_cancelled_ranking_retained' else 'linked_existing_ranking_verified' end,
        materialized_sale_id=v_existing.id,
        materialization_reason='Corporate provider evidence and seller identity verified ranking credit; cancellation affects accounting only.',
        materialized_at=now()
      where id=new.id;
    end if;
    return new;
  end if;

  select lower(au.email),coalesce(a.display_name,lower(au.email)) into v_rep_email,v_rep_name
  from auth.users au left join public.app_user_access a on lower(a.email)=lower(au.email)
  where au.id=v_seller.rep_user_id and coalesce(a.active,false)=true;
  if v_rep_email is null then return new; end if;

  select count(*),(array_agg(c.id order by c.created_at desc))[1] into v_capture_count,v_capture_id
  from public.provider_sale_captures c
  where c.rep_user_id=v_seller.rep_user_id and c.provider=new.provider
    and c.status in ('dashboard_opened','details_required')
    and private.provider_identity_key(split_part(coalesce(c.service_address,''),',',1))=private.provider_identity_key(split_part(coalesce(new.service_address,''),',',1))
    and c.created_at between coalesce(new.sale_date,new.created_at)-interval '14 days' and coalesce(new.sale_date,new.created_at)+interval '14 days';
  if v_capture_count<>1 then v_capture_id:=null; end if;

  v_customer_first:=split_part(trim(coalesce(new.customer_name,'Unknown')),' ',1);
  v_customer_last:=trim(substr(trim(coalesce(new.customer_name,'Unknown')),length(v_customer_first)+1));
  if v_customer_last='' then v_customer_last:='Unknown'; end if;

  insert into public.sales_records(
    rep_user_id,rep_email,rep_name,lead_label,customer_first_name,customer_last_name,
    service_address,isp,internet_product,provider_order_number,provider_account_number,
    sale_status,verification_status,verification_reason,verified_at,provider_sale_row_id,
    provider_capture_id,competition_eligible,ranking_eligible,ranking_verified_at,
    provider_reported_rep_user_id,provider_reported_rep_email,provider_reported_rep_name,
    compensation_snapshot,notes
  ) values (
    v_seller.rep_user_id,v_rep_email,v_rep_name,new.service_address,v_customer_first,v_customer_last,
    new.service_address,new.provider,coalesce(new.raw_payload->>'Internet Product Name','Fiber'),new.order_number,new.account_number,
    case when v_cancelled then 'cancelled' else 'reported' end,'verified_processed','authoritative_provider_report_seller_match',coalesce(new.sale_date,now()),new.id,
    v_capture_id,false,true,coalesce(new.sale_date,now()),
    v_seller.rep_user_id,v_rep_email,coalesce(v_seller.seller_name,v_rep_name),
    jsonb_build_object('sale_origin','authoritative_provider_ranking_materialization','accounting_review_required',true,'provider_evidence_scope','dealer_account'),
    'Created from authoritative corporate provider evidence for rankings. Accounting remains blocked pending McCoy capture/Admin review.'
  ) returning id into v_sale_id;

  update public.provider_sales_rows set
    materialization_status=case when v_cancelled then 'created_cancelled_ranking_retained' when v_capture_id is null then 'created_ranking_only_unmatched_capture' else 'created_ranking_verified_accounting_review' end,
    materialized_sale_id=v_sale_id,
    materialization_reason='Corporate provider evidence and unique seller verified ranking credit; accounting remains separate.',
    materialized_at=now()
  where id=new.id;
  return new;
end;
$$;

drop trigger if exists provider_sales_rows_authoritative_ranking on public.provider_sales_rows;
create trigger provider_sales_rows_authoritative_ranking
after insert or update on public.provider_sales_rows
for each row execute function private.materialize_authoritative_provider_ranking();

alter table public.provider_sales_rows drop constraint if exists provider_sales_rows_materialization_status_check;
alter table public.provider_sales_rows add constraint provider_sales_rows_materialization_status_check check (
  materialization_status in (
    'pending','linked_existing_sale','created_pending_review','unmatched_seller','unmatched_capture',
    'ambiguous_capture','provider_cancelled','provider_abandoned','not_completed',
    'seller_mismatch_review','ambiguous_seller_review','linked_cancelled_ranking_retained',
    'linked_existing_ranking_verified','created_cancelled_ranking_retained',
    'created_ranking_only_unmatched_capture','created_ranking_verified_accounting_review'
  )
);

-- Reprocess existing authoritative rows through the new ranking-only path.
update public.provider_sales_rows
set materialization_reason=materialization_reason
where evidence_scope='dealer_account' and materialized_sale_id is null;
