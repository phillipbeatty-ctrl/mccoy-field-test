-- Field Coach sale-completion production canary.
-- Runs entirely inside a transaction and rolls back every row it creates.
-- It validates the database half of the browser COMPLETE SALE contract using
-- the authorized Ghost test account and the McCoy Admin account.

begin;

create temporary table sale_completion_canary_ids(
  organization_id uuid,
  rep_user_id uuid,
  rep_email text,
  rep_name text,
  admin_user_id uuid,
  capture_id uuid,
  photo_id uuid,
  sale_id uuid
) on commit drop;

insert into sale_completion_canary_ids(organization_id,rep_user_id,rep_email,rep_name,admin_user_id)
select rep_access.organization_id,rep_auth.id,rep_auth.email,rep_access.display_name,admin_auth.id
from auth.users rep_auth
join public.app_user_access rep_access on lower(rep_access.email)=lower(rep_auth.email)
cross join auth.users admin_auth
join public.app_user_access admin_access on lower(admin_access.email)=lower(admin_auth.email)
where lower(rep_auth.email)='phillipkbeatty@gmail.com'
  and rep_access.active=true
  and lower(admin_auth.email)='phillip.beatty@gmail.com'
  and admin_access.active=true
  and lower(admin_access.role)='admin'
  and admin_access.organization_id=rep_access.organization_id;

with inserted as (
  insert into public.provider_sale_captures(
    organization_id,client_request_id,rep_user_id,rep_email,rep_name,provider,sale_context,
    service_address,lead_label,portal_opened,status,metadata
  )
  select organization_id,gen_random_uuid(),rep_user_id,rep_email,rep_name,'Quantum','field',
         'CANARY 100 TEST AVE','CANARY 100 TEST AVE',true,'details_required',
         jsonb_build_object('capture_version',2,'source','sale_completion_canary','preserve_active_visit',false)
  from sale_completion_canary_ids
  returning id
)
update sale_completion_canary_ids set capture_id=(select id from inserted);

with inserted as (
  insert into public.provider_sale_capture_photos(
    provider_capture_id,organization_id,uploaded_by,uploaded_by_email,original_file_name,
    storage_path,mime_type,file_size_bytes,status
  )
  select capture_id,organization_id,rep_user_id,rep_email,'canary-order.png',
         organization_id::text||'/'||capture_id::text||'/'||gen_random_uuid()::text||'.png',
         'image/png',128,'staged'
  from sale_completion_canary_ids
  returning id
)
update sale_completion_canary_ids set photo_id=(select id from inserted);

with inserted as (
  insert into public.sales_records(
    organization_id,rep_user_id,rep_email,rep_name,provider_capture_id,service_address,lead_label,
    isp,compensation_snapshot,verification_status,verification_reason,rep_reported_outcome,
    rep_reported_outcome_at,competition_eligible,ranking_eligible,ranking_verified_at
  )
  select organization_id,rep_user_id,rep_email,rep_name,capture_id,'CANARY 100 TEST AVE','CANARY 100 TEST AVE',
         'Quantum',
         jsonb_build_object(
           'sale_origin','mccoy_app',
           'sale_context','field',
           'capture_only_completion',jsonb_build_object('enabled',true,'source','sale_completion_canary'),
           'admin_approval',jsonb_build_object('required',false,'status','not_required')
         ),
         'pending_verification','capture_only_completed_outcome','completed',clock_timestamp(),false,true,clock_timestamp()
  from sale_completion_canary_ids
  returning id
)
update sale_completion_canary_ids set sale_id=(select id from inserted);

update public.provider_sale_captures c
set status='recorded',rep_outcome='completed',rep_outcome_at=clock_timestamp(),updated_at=clock_timestamp()
from sale_completion_canary_ids x
where c.id=x.capture_id;

select set_config('request.jwt.claim.sub',(select admin_user_id::text from sale_completion_canary_ids),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',(select admin_user_id::text from sale_completion_canary_ids),'role','authenticated')::text,true);

select jsonb_build_object(
  'sale_created',exists(select 1 from public.sales_records s join sale_completion_canary_ids x on x.sale_id=s.id),
  'capture_recorded',exists(select 1 from public.provider_sale_captures c join sale_completion_canary_ids x on x.capture_id=c.id where c.status='recorded' and c.rep_outcome='completed'),
  'photo_staged',exists(select 1 from public.provider_sale_capture_photos p join sale_completion_canary_ids x on x.photo_id=p.id where p.status='staged'),
  'admin_review_visible',exists(
    select 1
    from jsonb_array_elements((public.admin_all_sales_feed()->'rows')) row
    join sale_completion_canary_ids x on row->>'id'=x.sale_id::text
  ),
  'ranking_eligible',exists(select 1 from public.sales_records s join sale_completion_canary_ids x on x.sale_id=s.id where s.ranking_eligible=true),
  'live_win_created',exists(select 1 from public.sales_feed f join sale_completion_canary_ids x on x.sale_id=f.sale_id where f.ranking_eligible_at_event=true),
  'required_metrics_complete',(select s.required_metrics_complete from public.sales_records s join sale_completion_canary_ids x on x.sale_id=s.id),
  'required_metrics_missing',(select to_jsonb(s.required_metrics_missing) from public.sales_records s join sale_completion_canary_ids x on x.sale_id=s.id)
) as canary;

rollback;
