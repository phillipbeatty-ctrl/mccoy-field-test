-- Live Feed comments preview canary with fail-closed Admin moderation.
-- Run only against an isolated Supabase preview branch after applying both
-- Live Feed migrations. Every test row is rolled back.

begin;

create temporary table live_feed_canary_ids (
  organization_a uuid not null,
  organization_b uuid not null,
  rep_a uuid not null,
  rep_c uuid not null,
  admin_a uuid not null,
  rep_b uuid not null,
  sale_id uuid not null,
  request_a uuid not null,
  comment_a uuid,
  comment_c uuid,
  comment_rejected uuid,
  comment_b uuid,
  feed_rep_a_pending jsonb,
  feed_rep_c_before jsonb,
  feed_admin_pending jsonb,
  feed_rep_c_after jsonb
) on commit drop;

insert into live_feed_canary_ids(
  organization_a,organization_b,rep_a,rep_c,admin_a,rep_b,sale_id,request_a
) values (
  gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),
  gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid()
);

insert into public.organizations(id,slug,legal_name,display_name,billing_status,active)
select organization_a,'live-feed-preview-a-'||left(organization_a::text,8),'Live Feed Preview A LLC','Live Feed Preview A','internal_unlimited',true
from live_feed_canary_ids
union all
select organization_b,'live-feed-preview-b-'||left(organization_b::text,8),'Live Feed Preview B LLC','Live Feed Preview B','internal_unlimited',true
from live_feed_canary_ids;

insert into auth.users(
  id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
)
select rep_a,'authenticated','authenticated','live-feed-rep-a@preview.invalid','',now(),'{}'::jsonb,'{}'::jsonb,now(),now() from live_feed_canary_ids
union all
select rep_c,'authenticated','authenticated','live-feed-rep-c@preview.invalid','',now(),'{}'::jsonb,'{}'::jsonb,now(),now() from live_feed_canary_ids
union all
select admin_a,'authenticated','authenticated','live-feed-admin-a@preview.invalid','',now(),'{}'::jsonb,'{}'::jsonb,now(),now() from live_feed_canary_ids
union all
select rep_b,'authenticated','authenticated','live-feed-rep-b@preview.invalid','',now(),'{}'::jsonb,'{}'::jsonb,now(),now() from live_feed_canary_ids;

insert into public.app_user_access(email,role,active,display_name,organization_id)
select 'live-feed-rep-a@preview.invalid','rep',true,'Preview Rep A',organization_a from live_feed_canary_ids
union all
select 'live-feed-rep-c@preview.invalid','rep',true,'Preview Rep C',organization_a from live_feed_canary_ids
union all
select 'live-feed-admin-a@preview.invalid','admin',true,'Preview Admin A',organization_a from live_feed_canary_ids
union all
select 'live-feed-rep-b@preview.invalid','rep',true,'Preview Rep B',organization_b from live_feed_canary_ids
on conflict (email) do update
set role=excluded.role,active=true,display_name=excluded.display_name,organization_id=excluded.organization_id;

insert into public.organization_memberships(
  organization_id,auth_user_id,email,role,active,is_default
)
select organization_a,rep_a,'live-feed-rep-a@preview.invalid','rep',true,true from live_feed_canary_ids
union all
select organization_a,rep_c,'live-feed-rep-c@preview.invalid','rep',true,true from live_feed_canary_ids
union all
select organization_a,admin_a,'live-feed-admin-a@preview.invalid','admin',true,true from live_feed_canary_ids
union all
select organization_b,rep_b,'live-feed-rep-b@preview.invalid','rep',true,true from live_feed_canary_ids
on conflict (organization_id,auth_user_id) do update
set email=excluded.email,role=excluded.role,active=true,is_default=true,updated_at=now();

insert into public.sales_records(
  id,organization_id,rep_user_id,rep_email,rep_name,isp,sale_status,
  verification_status,ranking_eligible,compensation_snapshot
)
select sale_id,organization_a,rep_a,'live-feed-rep-a@preview.invalid','Preview Rep A','Quantum',
       'reported','pending_verification',false,'{}'::jsonb
from live_feed_canary_ids;

insert into public.sales_feed(
  sale_id,organization_id,rep_user_id,rep_name,isp,message,
  celebration_types,celebration_messages,celebration_version,
  animation_enabled,ranking_eligible_at_event
)
select sale_id,organization_a,rep_a,'Preview Rep A','Quantum',
       'Preview Rep A closed a verified Quantum sale.',
       array['sale']::text[],
       jsonb_build_array('Preview Rep A closed a verified Quantum sale.','First sale of the preview day.'),
       1,false,true
from live_feed_canary_ids;

-- Rep A submits one free-form comment. It must remain pending and visible only
-- to Rep A plus organization Admins until approval.
select set_config('request.jwt.claim.sub',(select rep_a::text from live_feed_canary_ids),true);
select set_config('request.jwt.claims',jsonb_build_object(
  'sub',(select rep_a::text from live_feed_canary_ids),
  'email','live-feed-rep-a@preview.invalid',
  'role','authenticated'
)::text,true);

with posted as (
  select public.post_live_feed_comment_v1(
    'Great work, team!',
    (select request_a from live_feed_canary_ids)
  ) as result
)
update live_feed_canary_ids
set comment_a=(select (result->'event'->>'comment_id')::uuid from posted);

do $$
declare result jsonb;
begin
  select public.post_live_feed_comment_v1(
    'Great work, team!',
    (select request_a from live_feed_canary_ids)
  ) into result;
  if coalesce((result->>'idempotent')::boolean,false) is not true then
    raise exception 'idempotent retry did not return the existing comment';
  end if;
  if result->'event'->>'moderation_status' <> 'pending' then
    raise exception 'idempotent retry did not preserve pending moderation';
  end if;
  if (result->'event'->>'comment_id')::uuid <> (select comment_a from live_feed_canary_ids) then
    raise exception 'idempotent retry returned a different comment';
  end if;
end;
$$;

update live_feed_canary_ids set feed_rep_a_pending=public.get_live_feed_v1(100,null);

do $$
begin
  if not exists (
    select 1 from jsonb_array_elements((select feed_rep_a_pending->'events' from live_feed_canary_ids)) event
    where event->>'comment_id'=(select comment_a::text from live_feed_canary_ids)
      and event->>'moderation_status'='pending'
      and (event->>'is_own')::boolean
  ) then
    raise exception 'author could not see their pending comment';
  end if;
end;
$$;

-- Explicit customer-name context and phone data are rejected even before
-- quarantine. Other free-form text remains pending until human review.
do $$
begin
  begin
    perform public.post_live_feed_comment_v1('Customer Jane Doe',gen_random_uuid());
    raise exception 'explicit customer name context was accepted';
  exception
    when sqlstate '22023' then
      if sqlerrm <> 'customer_information_not_allowed:customer_name_context' then raise; end if;
  end;
  begin
    perform public.post_live_feed_comment_v1('Call 503-555-0199',gen_random_uuid());
    raise exception 'customer phone was accepted';
  exception
    when sqlstate '22023' then
      if sqlerrm not like 'customer_information_not_allowed:%' then raise; end if;
  end;
end;
$$;

-- Rep C belongs to the same organization but must not see Rep A's pending text.
select set_config('request.jwt.claim.sub',(select rep_c::text from live_feed_canary_ids),true);
select set_config('request.jwt.claims',jsonb_build_object(
  'sub',(select rep_c::text from live_feed_canary_ids),
  'email','live-feed-rep-c@preview.invalid',
  'role','authenticated'
)::text,true);
update live_feed_canary_ids set feed_rep_c_before=public.get_live_feed_v1(100,null);

do $$
begin
  if exists (
    select 1 from jsonb_array_elements((select feed_rep_c_before->'events' from live_feed_canary_ids)) event
    where event->>'comment_id'=(select comment_a::text from live_feed_canary_ids)
  ) then
    raise exception 'pending comment leaked to an ordinary organization member';
  end if;
end;
$$;

-- The Admin sees the pending item, certifies the review, and publishes it.
select set_config('request.jwt.claim.sub',(select admin_a::text from live_feed_canary_ids),true);
select set_config('request.jwt.claims',jsonb_build_object(
  'sub',(select admin_a::text from live_feed_canary_ids),
  'email','live-feed-admin-a@preview.invalid',
  'role','authenticated'
)::text,true);
update live_feed_canary_ids set feed_admin_pending=public.get_live_feed_v1(100,null);

do $$
begin
  if not exists (
    select 1 from jsonb_array_elements((select feed_admin_pending->'events' from live_feed_canary_ids)) event
    where event->>'comment_id'=(select comment_a::text from live_feed_canary_ids)
      and event->>'moderation_status'='pending'
      and (event->>'can_moderate')::boolean
  ) then
    raise exception 'Admin could not see and moderate the pending comment';
  end if;
end;
$$;

select public.moderate_live_feed_comment_v1(
  (select comment_a from live_feed_canary_ids),
  'approve',
  'Reviewed: no customer data observed'
);

-- Rep C now sees the approved comment and the existing verified sale.
select set_config('request.jwt.claim.sub',(select rep_c::text from live_feed_canary_ids),true);
select set_config('request.jwt.claims',jsonb_build_object(
  'sub',(select rep_c::text from live_feed_canary_ids),
  'email','live-feed-rep-c@preview.invalid',
  'role','authenticated'
)::text,true);
update live_feed_canary_ids set feed_rep_c_after=public.get_live_feed_v1(100,null);

do $$
begin
  if not exists (
    select 1 from jsonb_array_elements((select feed_rep_c_after->'events' from live_feed_canary_ids)) event
    where event->>'comment_id'=(select comment_a::text from live_feed_canary_ids)
      and event->>'moderation_status'='approved'
      and event->>'message'='Great work, team!'
  ) then
    raise exception 'approved comment was not published to the organization';
  end if;
  if not exists (
    select 1 from jsonb_array_elements((select feed_rep_c_after->'events' from live_feed_canary_ids)) event
    where event->>'event_type'='sale'
      and event->>'message'='Preview Rep A closed a verified Quantum sale.'
  ) then
    raise exception 'verified sale was missing from mixed feed';
  end if;
end;
$$;

-- Rep C creates a second pending item; Admin rejects it and preserves a private
-- immutable moderation record without broadcasting it.
with posted as (
  select public.post_live_feed_comment_v1('Please review this message',gen_random_uuid()) as result
)
update live_feed_canary_ids
set comment_rejected=(select (result->'event'->>'comment_id')::uuid from posted);

select set_config('request.jwt.claim.sub',(select admin_a::text from live_feed_canary_ids),true);
select set_config('request.jwt.claims',jsonb_build_object(
  'sub',(select admin_a::text from live_feed_canary_ids),
  'email','live-feed-admin-a@preview.invalid',
  'role','authenticated'
)::text,true);
select public.moderate_live_feed_comment_v1(
  (select comment_rejected from live_feed_canary_ids),
  'reject',
  'Preview moderation rejection'
);

-- Organization B posts independently. The pending body and any future approved
-- body remain isolated from organization A.
select set_config('request.jwt.claim.sub',(select rep_b::text from live_feed_canary_ids),true);
select set_config('request.jwt.claims',jsonb_build_object(
  'sub',(select rep_b::text from live_feed_canary_ids),
  'email','live-feed-rep-b@preview.invalid',
  'role','authenticated'
)::text,true);
with posted as (
  select public.post_live_feed_comment_v1('Organization B only',gen_random_uuid()) as result
)
update live_feed_canary_ids
set comment_b=(select (result->'event'->>'comment_id')::uuid from posted);

-- Add one already-approved old comment for deletion-authority tests.
with inserted as (
  insert into public.live_feed_comments(
    organization_id,author_user_id,author_display_name,author_role,body,
    client_request_id,created_at,moderation_status,published_at,moderated_at,
    moderated_by_user_id,moderation_reason
  )
  select organization_a,rep_c,'Preview Rep C','rep','Admin-removal canary',
         gen_random_uuid(),now()-interval '10 minutes','approved',now()-interval '9 minutes',
         now()-interval '9 minutes',admin_a,'Preview setup approval'
  from live_feed_canary_ids
  returning id
)
update live_feed_canary_ids set comment_c=(select id from inserted);

-- Rep A cannot see organization B, cannot moderate, and cannot delete Rep C's
-- old comment. Rep A can remove their own approved comment within five minutes.
select set_config('request.jwt.claim.sub',(select rep_a::text from live_feed_canary_ids),true);
select set_config('request.jwt.claims',jsonb_build_object(
  'sub',(select rep_a::text from live_feed_canary_ids),
  'email','live-feed-rep-a@preview.invalid',
  'role','authenticated'
)::text,true);

do $$
begin
  if exists (
    select 1 from jsonb_array_elements(public.get_live_feed_v1(100,null)->'events') event
    where event->>'message'='Organization B only'
  ) then
    raise exception 'cross-organization comment leaked into organization A';
  end if;
  begin
    perform public.moderate_live_feed_comment_v1(
      (select comment_b from live_feed_canary_ids),'approve','Unauthorized attempt'
    );
    raise exception 'non-admin moderation was accepted';
  exception
    when sqlstate '42501' then
      if sqlerrm <> 'admin_required' then raise; end if;
  end;
  begin
    perform public.delete_live_feed_comment_v1((select comment_c from live_feed_canary_ids),null);
    raise exception 'non-author non-admin deletion was accepted';
  exception
    when sqlstate '42501' then
      if sqlerrm <> 'comment_delete_forbidden' then raise; end if;
  end;
end;
$$;

select public.delete_live_feed_comment_v1((select comment_a from live_feed_canary_ids),null);

-- Admin can remove any approved organization comment with a reason, but cannot
-- find or moderate a comment belonging to organization B.
select set_config('request.jwt.claim.sub',(select admin_a::text from live_feed_canary_ids),true);
select set_config('request.jwt.claims',jsonb_build_object(
  'sub',(select admin_a::text from live_feed_canary_ids),
  'email','live-feed-admin-a@preview.invalid',
  'role','authenticated'
)::text,true);
select public.delete_live_feed_comment_v1(
  (select comment_c from live_feed_canary_ids),
  'Preview removal canary'
);

do $$
begin
  begin
    perform public.moderate_live_feed_comment_v1(
      (select comment_b from live_feed_canary_ids),'approve','Cross organization attempt'
    );
    raise exception 'Admin moderated another organization comment';
  exception
    when sqlstate 'P0002' then
      if sqlerrm <> 'comment_not_found' then raise; end if;
  end;

  if has_table_privilege('authenticated','public.live_feed_comments','INSERT')
     or has_table_privilege('authenticated','public.live_feed_comments','UPDATE')
     or has_table_privilege('authenticated','public.live_feed_comments','DELETE') then
    raise exception 'authenticated role received a direct comment write privilege';
  end if;
  if not has_table_privilege('authenticated','public.live_feed_comments','SELECT') then
    raise exception 'authenticated role cannot receive RLS-scoped Realtime rows';
  end if;
  if has_function_privilege('anon','public.post_live_feed_comment_v1(text,uuid)','EXECUTE')
     or has_function_privilege('anon','public.moderate_live_feed_comment_v1(uuid,text,text)','EXECUTE') then
    raise exception 'anon can execute a Live Feed write RPC';
  end if;
  if not has_function_privilege('authenticated','public.post_live_feed_comment_v1(text,uuid)','EXECUTE')
     or not has_function_privilege('authenticated','public.moderate_live_feed_comment_v1(uuid,text,text)','EXECUTE') then
    raise exception 'authenticated role is missing required RPC execution';
  end if;
  if (select count(*) from public.sales_records where id=(select sale_id from live_feed_canary_ids)) <> 1 then
    raise exception 'comment activity changed the sale record';
  end if;
  if (select count(*) from public.sales_feed where sale_id=(select sale_id from live_feed_canary_ids)) <> 1 then
    raise exception 'comment activity changed the verified sale event';
  end if;
  if (select count(*) from private.live_feed_comment_deletions where comment_id in (
    (select comment_a from live_feed_canary_ids),(select comment_c from live_feed_canary_ids)
  )) <> 2 then
    raise exception 'comment deletion audit was incomplete';
  end if;
  if (select count(*) from private.live_feed_comment_moderation_events where comment_id in (
    (select comment_a from live_feed_canary_ids),(select comment_rejected from live_feed_canary_ids)
  )) <> 2 then
    raise exception 'comment moderation audit was incomplete';
  end if;
end;
$$;

select jsonb_build_object(
  'post_idempotency',true,
  'explicit_customer_data_rejected',true,
  'pending_body_quarantined',true,
  'admin_approval_required_before_broadcast',true,
  'admin_rejection_audited',true,
  'organization_isolation',true,
  'mixed_sale_and_approved_comment_feed',true,
  'author_delete_window',true,
  'admin_delete',true,
  'direct_writes_revoked',true,
  'sale_and_ranking_boundary_preserved',true,
  'rolled_back',true
) as live_feed_preview_canary;

rollback;
