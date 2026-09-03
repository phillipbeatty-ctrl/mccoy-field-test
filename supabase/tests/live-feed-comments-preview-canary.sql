-- Live Feed comments preview canary.
-- Run only against an isolated Supabase preview branch after applying the
-- Live Feed migration. Every test row is rolled back.

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
  comment_b uuid,
  feed_a jsonb
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
select 'live-feed-rep-b@preview.invalid','rep',true,'Preview Rep B',organization_b from live_feed_canary_ids;

insert into public.organization_memberships(
  organization_id,auth_user_id,email,role,active,is_default
)
select organization_a,rep_a,'live-feed-rep-a@preview.invalid','rep',true,true from live_feed_canary_ids
on conflict (organization_id,auth_user_id) do update
set email=excluded.email,role=excluded.role,active=true,is_default=true,updated_at=now();
insert into public.organization_memberships(organization_id,auth_user_id,email,role,active,is_default)
select organization_a,rep_c,'live-feed-rep-c@preview.invalid','rep',true,true from live_feed_canary_ids
on conflict (organization_id,auth_user_id) do update
set email=excluded.email,role=excluded.role,active=true,is_default=true,updated_at=now();
insert into public.organization_memberships(organization_id,auth_user_id,email,role,active,is_default)
select organization_a,admin_a,'live-feed-admin-a@preview.invalid','admin',true,true from live_feed_canary_ids
on conflict (organization_id,auth_user_id) do update
set email=excluded.email,role=excluded.role,active=true,is_default=true,updated_at=now();
insert into public.organization_memberships(organization_id,auth_user_id,email,role,active,is_default)
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
declare
  result jsonb;
begin
  select public.post_live_feed_comment_v1(
    'Great work, team!',
    (select request_a from live_feed_canary_ids)
  ) into result;
  if coalesce((result->>'idempotent')::boolean,false) is not true then
    raise exception 'idempotent retry did not return the existing comment';
  end if;
  if (result->'event'->>'comment_id')::uuid <> (select comment_a from live_feed_canary_ids) then
    raise exception 'idempotent retry returned a different comment';
  end if;
end;
$$;

do $$
begin
  begin
    perform public.post_live_feed_comment_v1(
      'Call the customer at 503-555-0199',
      gen_random_uuid()
    );
    raise exception 'customer information was accepted';
  exception
    when sqlstate '22023' then
      if sqlerrm not like 'customer_information_not_allowed:%' then
        raise;
      end if;
  end;
end;
$$;

do $$
begin
  begin
    perform public.post_live_feed_comment_v1('Second rapid comment',gen_random_uuid());
    raise exception 'rate limit did not run';
  exception
    when sqlstate 'P0001' then
      if sqlerrm <> 'comment_rate_limited_3_seconds' then
        raise;
      end if;
  end;
end;
$$;

-- A second member in organization A creates a comment old enough that only
-- an Admin may remove it.
with inserted as (
  insert into public.live_feed_comments(
    organization_id,author_user_id,author_display_name,author_role,body,client_request_id,created_at
  )
  select organization_a,rep_c,'Preview Rep C','rep','Admin-removal canary',gen_random_uuid(),now()-interval '10 minutes'
  from live_feed_canary_ids
  returning id
)
update live_feed_canary_ids set comment_c=(select id from inserted);

-- Organization B posts independently.
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

-- Rep A cannot see organization B and cannot remove Rep C's old comment.
select set_config('request.jwt.claim.sub',(select rep_a::text from live_feed_canary_ids),true);
select set_config('request.jwt.claims',jsonb_build_object(
  'sub',(select rep_a::text from live_feed_canary_ids),
  'email','live-feed-rep-a@preview.invalid',
  'role','authenticated'
)::text,true);

update live_feed_canary_ids set feed_a=public.get_live_feed_v1(100,null);

do $$
begin
  if exists (
    select 1
    from jsonb_array_elements((select feed_a->'events' from live_feed_canary_ids)) event
    where event->>'message'='Organization B only'
  ) then
    raise exception 'cross-organization comment leaked into organization A';
  end if;
  if not exists (
    select 1
    from jsonb_array_elements((select feed_a->'events' from live_feed_canary_ids)) event
    where event->>'event_type'='sale'
      and event->>'message'='Preview Rep A closed a verified Quantum sale.'
  ) then
    raise exception 'verified sale was missing from mixed feed';
  end if;
  if not exists (
    select 1
    from jsonb_array_elements((select feed_a->'events' from live_feed_canary_ids)) event
    where event->>'event_type'='comment'
      and event->>'message'='Great work, team!'
  ) then
    raise exception 'organization A comment was missing from mixed feed';
  end if;
end;
$$;

do $$
begin
  begin
    perform public.delete_live_feed_comment_v1((select comment_c from live_feed_canary_ids),null);
    raise exception 'non-author non-admin deletion was accepted';
  exception
    when sqlstate '42501' then
      if sqlerrm <> 'comment_delete_forbidden' then
        raise;
      end if;
  end;
end;
$$;

-- The author can remove their own fresh comment.
select public.delete_live_feed_comment_v1((select comment_a from live_feed_canary_ids),null);

-- An Admin can remove any organization comment with a reason.
select set_config('request.jwt.claim.sub',(select admin_a::text from live_feed_canary_ids),true);
select set_config('request.jwt.claims',jsonb_build_object(
  'sub',(select admin_a::text from live_feed_canary_ids),
  'email','live-feed-admin-a@preview.invalid',
  'role','authenticated'
)::text,true);
select public.delete_live_feed_comment_v1(
  (select comment_c from live_feed_canary_ids),
  'Preview moderation canary'
);

do $$
begin
  if has_table_privilege('authenticated','public.live_feed_comments','INSERT')
     or has_table_privilege('authenticated','public.live_feed_comments','UPDATE')
     or has_table_privilege('authenticated','public.live_feed_comments','DELETE') then
    raise exception 'authenticated role received a direct comment write privilege';
  end if;
  if not has_table_privilege('authenticated','public.live_feed_comments','SELECT') then
    raise exception 'authenticated role cannot receive organization-scoped Realtime rows';
  end if;
  if has_function_privilege('anon','public.post_live_feed_comment_v1(text,uuid)','EXECUTE') then
    raise exception 'anon can execute the comment post RPC';
  end if;
  if not has_function_privilege('authenticated','public.post_live_feed_comment_v1(text,uuid)','EXECUTE') then
    raise exception 'authenticated cannot execute the comment post RPC';
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
end;
$$;

select jsonb_build_object(
  'post_idempotency',true,
  'customer_data_rejected',true,
  'rate_limit_enforced',true,
  'organization_isolation',true,
  'mixed_sale_and_comment_feed',true,
  'author_delete_window',true,
  'admin_delete',true,
  'direct_writes_revoked',true,
  'sale_and_ranking_boundary_preserved',true,
  'rolled_back',true
) as live_feed_preview_canary;

rollback;
