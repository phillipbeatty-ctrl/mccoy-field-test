-- COMPANY/TEAM Live Feed preview canary.
-- Run only on an isolated Supabase preview branch after applying the consolidated migration.
-- Every synthetic organization, identity, comment, and sale is rolled back.

begin;

create temporary table live_feed_canary_ids (
  organization_a uuid not null,
  organization_b uuid not null,
  admin_a_auth uuid not null,
  manager_a_auth uuid not null,
  trainer_a_auth uuid not null,
  rep_a1_auth uuid not null,
  rep_a2_auth uuid not null,
  rep_b_auth uuid not null,
  admin_a_profile uuid not null,
  manager_a_profile uuid not null,
  trainer_a_profile uuid not null,
  rep_a1_profile uuid not null,
  rep_a2_profile uuid not null,
  rep_b_profile uuid not null,
  team_a1 uuid not null,
  team_a2 uuid not null,
  team_b uuid not null,
  sale_id uuid not null,
  rep_a1_comment uuid,
  manager_comment uuid,
  trainer_comment uuid,
  company_comment uuid,
  team_a2_comment uuid
) on commit drop;

insert into live_feed_canary_ids values (
  gen_random_uuid(),gen_random_uuid(),
  gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),
  gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),
  gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),
  null,null,null,null,null
);

create or replace function pg_temp.live_feed_login(p_user_id uuid,p_email text)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claim.sub',p_user_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object(
    'sub',p_user_id::text,
    'email',lower(p_email),
    'role','authenticated'
  )::text,true);
end;
$$;

insert into public.organizations(id,slug,legal_name,display_name,billing_status,active)
select organization_a,'live-feed-scope-a-'||left(organization_a::text,8),'Live Feed Scope A LLC','Live Feed Scope A','internal_unlimited',true from live_feed_canary_ids
union all
select organization_b,'live-feed-scope-b-'||left(organization_b::text,8),'Live Feed Scope B LLC','Live Feed Scope B','internal_unlimited',true from live_feed_canary_ids;

insert into auth.users(
  id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
)
select admin_a_auth,'authenticated','authenticated','live-feed-admin-a@preview.invalid','',now(),'{}'::jsonb,'{}'::jsonb,now(),now() from live_feed_canary_ids
union all select manager_a_auth,'authenticated','authenticated','live-feed-manager-a@preview.invalid','',now(),'{}'::jsonb,'{}'::jsonb,now(),now() from live_feed_canary_ids
union all select trainer_a_auth,'authenticated','authenticated','live-feed-trainer-a@preview.invalid','',now(),'{}'::jsonb,'{}'::jsonb,now(),now() from live_feed_canary_ids
union all select rep_a1_auth,'authenticated','authenticated','live-feed-rep-a1@preview.invalid','',now(),'{}'::jsonb,'{}'::jsonb,now(),now() from live_feed_canary_ids
union all select rep_a2_auth,'authenticated','authenticated','live-feed-rep-a2@preview.invalid','',now(),'{}'::jsonb,'{}'::jsonb,now(),now() from live_feed_canary_ids
union all select rep_b_auth,'authenticated','authenticated','live-feed-rep-b@preview.invalid','',now(),'{}'::jsonb,'{}'::jsonb,now(),now() from live_feed_canary_ids;

insert into public.app_user_access(email,role,active,display_name,organization_id)
select 'live-feed-admin-a@preview.invalid','admin',true,'Preview Admin A',organization_a from live_feed_canary_ids
union all select 'live-feed-manager-a@preview.invalid','manager',true,'Preview Manager A',organization_a from live_feed_canary_ids
union all select 'live-feed-trainer-a@preview.invalid','trainer',true,'Preview Trainer A',organization_a from live_feed_canary_ids
union all select 'live-feed-rep-a1@preview.invalid','rep',true,'Preview Rep A1',organization_a from live_feed_canary_ids
union all select 'live-feed-rep-a2@preview.invalid','rep',true,'Preview Rep A2',organization_a from live_feed_canary_ids
union all select 'live-feed-rep-b@preview.invalid','rep',true,'Preview Rep B',organization_b from live_feed_canary_ids
on conflict (email) do update set role=excluded.role,active=true,display_name=excluded.display_name,organization_id=excluded.organization_id;

insert into public.organization_memberships(organization_id,auth_user_id,email,role,active,is_default)
select organization_a,admin_a_auth,'live-feed-admin-a@preview.invalid','admin',true,true from live_feed_canary_ids
union all select organization_a,manager_a_auth,'live-feed-manager-a@preview.invalid','manager',true,true from live_feed_canary_ids
union all select organization_a,trainer_a_auth,'live-feed-trainer-a@preview.invalid','trainer',true,true from live_feed_canary_ids
union all select organization_a,rep_a1_auth,'live-feed-rep-a1@preview.invalid','rep',true,true from live_feed_canary_ids
union all select organization_a,rep_a2_auth,'live-feed-rep-a2@preview.invalid','rep',true,true from live_feed_canary_ids
union all select organization_b,rep_b_auth,'live-feed-rep-b@preview.invalid','rep',true,true from live_feed_canary_ids
on conflict (organization_id,auth_user_id) do update set email=excluded.email,role=excluded.role,active=true,is_default=true,updated_at=now();

insert into public.users(id,auth_user_id,email,role,active,organization_id)
select admin_a_profile,admin_a_auth,'live-feed-admin-a@preview.invalid','admin',true,organization_a from live_feed_canary_ids
union all select manager_a_profile,manager_a_auth,'live-feed-manager-a@preview.invalid','manager',true,organization_a from live_feed_canary_ids
union all select trainer_a_profile,trainer_a_auth,'live-feed-trainer-a@preview.invalid','trainer',true,organization_a from live_feed_canary_ids
union all select rep_a1_profile,rep_a1_auth,'live-feed-rep-a1@preview.invalid','rep',true,organization_a from live_feed_canary_ids
union all select rep_a2_profile,rep_a2_auth,'live-feed-rep-a2@preview.invalid','rep',true,organization_a from live_feed_canary_ids
union all select rep_b_profile,rep_b_auth,'live-feed-rep-b@preview.invalid','rep',true,organization_b from live_feed_canary_ids;

insert into public.teams(id,name,active,manager_user_id,organization_id)
select team_a1,'Preview Team A1',true,manager_a_profile,organization_a from live_feed_canary_ids
union all select team_a2,'Preview Team A2',true,admin_a_profile,organization_a from live_feed_canary_ids
union all select team_b,'Preview Team B',true,rep_b_profile,organization_b from live_feed_canary_ids;

update public.users profile
set team_id=case
  when profile.id in ((select manager_a_profile from live_feed_canary_ids),(select trainer_a_profile from live_feed_canary_ids),(select rep_a1_profile from live_feed_canary_ids)) then (select team_a1 from live_feed_canary_ids)
  when profile.id=(select rep_a2_profile from live_feed_canary_ids) then (select team_a2 from live_feed_canary_ids)
  when profile.id=(select rep_b_profile from live_feed_canary_ids) then (select team_b from live_feed_canary_ids)
  else null
end
where profile.id in (
  (select manager_a_profile from live_feed_canary_ids),
  (select trainer_a_profile from live_feed_canary_ids),
  (select rep_a1_profile from live_feed_canary_ids),
  (select rep_a2_profile from live_feed_canary_ids),
  (select rep_b_profile from live_feed_canary_ids)
);

insert into public.sales_records(
  id,organization_id,rep_user_id,rep_email,rep_name,isp,sale_status,
  verification_status,ranking_eligible,compensation_snapshot
)
select sale_id,organization_a,rep_a1_profile,'live-feed-rep-a1@preview.invalid','Preview Rep A1','Quantum',
       'reported','pending_verification',false,'{}'::jsonb
from live_feed_canary_ids;

insert into public.sales_feed(
  sale_id,organization_id,rep_user_id,rep_name,isp,message,
  celebration_types,celebration_messages,celebration_version,
  animation_enabled,ranking_eligible_at_event
)
select sale_id,organization_a,rep_a1_profile,'Preview Rep A1','Quantum',
       'Preview Rep A1 closed a verified Quantum sale.',
       array['sale']::text[],jsonb_build_array('Preview Rep A1 closed a verified Quantum sale.'),
       1,false,true
from live_feed_canary_ids;

-- Rep: TEAM only, and only the assigned team.
select pg_temp.live_feed_login((select rep_a1_auth from live_feed_canary_ids),'live-feed-rep-a1@preview.invalid');
with posted as (
  select public.post_live_feed_comment_v2('team',(select team_a1 from live_feed_canary_ids),'Rep A1 team update',gen_random_uuid()) as result
)
update live_feed_canary_ids set rep_a1_comment=(select (result->'event'->>'comment_id')::uuid from posted);

do $$
begin
  begin
    perform public.post_live_feed_comment_v2('company',null,'Rep company attempt',gen_random_uuid());
    raise exception 'rep company post was accepted';
  exception when sqlstate '42501' then
    if sqlerrm <> 'company_post_admin_required' then raise; end if;
  end;
  begin
    perform public.post_live_feed_comment_v2('team',(select team_a2 from live_feed_canary_ids),'Wrong team attempt',gen_random_uuid());
    raise exception 'rep cross-team post was accepted';
  exception when sqlstate '42501' then
    if sqlerrm <> 'team_scope_forbidden' then raise; end if;
  end;
end;
$$;

-- Manager: TEAM only for an assigned/managed team; no moderation authority.
select pg_temp.live_feed_login((select manager_a_auth from live_feed_canary_ids),'live-feed-manager-a@preview.invalid');
with posted as (
  select public.post_live_feed_comment_v2('team',(select team_a1 from live_feed_canary_ids),'Manager team update',gen_random_uuid()) as result
)
update live_feed_canary_ids set manager_comment=(select (result->'event'->>'comment_id')::uuid from posted);

do $$
begin
  begin
    perform public.post_live_feed_comment_v2('company',null,'Manager company attempt',gen_random_uuid());
    raise exception 'manager company post was accepted';
  exception when sqlstate '42501' then
    if sqlerrm <> 'company_post_admin_required' then raise; end if;
  end;
  begin
    perform public.moderate_live_feed_comment_v2((select rep_a1_comment from live_feed_canary_ids),'approve','Manager moderation attempt',true);
    raise exception 'manager moderation was accepted';
  exception when sqlstate '42501' then
    if sqlerrm <> 'admin_required' then raise; end if;
  end;
end;
$$;

-- Trainer: TEAM only for the assigned team; no moderation authority.
select pg_temp.live_feed_login((select trainer_a_auth from live_feed_canary_ids),'live-feed-trainer-a@preview.invalid');
with posted as (
  select public.post_live_feed_comment_v2('team',(select team_a1 from live_feed_canary_ids),'Trainer team update',gen_random_uuid()) as result
)
update live_feed_canary_ids set trainer_comment=(select (result->'event'->>'comment_id')::uuid from posted);

do $$
begin
  begin
    perform public.moderate_live_feed_comment_v2((select rep_a1_comment from live_feed_canary_ids),'approve','Trainer moderation attempt',true);
    raise exception 'trainer moderation was accepted';
  exception when sqlstate '42501' then
    if sqlerrm <> 'admin_required' then raise; end if;
  end;
end;
$$;

-- Admin: COMPANY or any team in the organization; never another organization.
select pg_temp.live_feed_login((select admin_a_auth from live_feed_canary_ids),'live-feed-admin-a@preview.invalid');
with posted as (
  select public.post_live_feed_comment_v2('company',null,'Company announcement',gen_random_uuid()) as result
)
update live_feed_canary_ids set company_comment=(select (result->'event'->>'comment_id')::uuid from posted);
update public.live_feed_comments set created_at=created_at-interval '10 seconds' where id=(select company_comment from live_feed_canary_ids);
with posted as (
  select public.post_live_feed_comment_v2('team',(select team_a2 from live_feed_canary_ids),'Team A2 Admin update',gen_random_uuid()) as result
)
update live_feed_canary_ids set team_a2_comment=(select (result->'event'->>'comment_id')::uuid from posted);

do $$
begin
  begin
    perform public.post_live_feed_comment_v2('team',(select team_b from live_feed_canary_ids),'Cross-org Admin attempt',gen_random_uuid());
    raise exception 'Admin cross-organization team post was accepted';
  exception when sqlstate '42501' then
    if sqlerrm <> 'team_scope_forbidden' then raise; end if;
  end;
end;
$$;

-- Pending TEAM text is visible to its author and Admin, but not another member in that team.
select pg_temp.live_feed_login((select trainer_a_auth from live_feed_canary_ids),'live-feed-trainer-a@preview.invalid');
do $$
begin
  if exists (
    select 1 from jsonb_array_elements(public.get_live_feed_v2('team',(select team_a1 from live_feed_canary_ids),100,null)->'events') event
    where event->>'comment_id'=(select rep_a1_comment::text from live_feed_canary_ids)
  ) then
    raise exception 'pending team comment leaked to another team member';
  end if;
end;
$$;

select pg_temp.live_feed_login((select admin_a_auth from live_feed_canary_ids),'live-feed-admin-a@preview.invalid');
do $$
declare feed jsonb;
begin
  feed:=public.get_live_feed_v2('team',(select team_a1 from live_feed_canary_ids),100,null);
  if not exists (
    select 1 from jsonb_array_elements(feed->'events') event
    where event->>'comment_id'=(select rep_a1_comment::text from live_feed_canary_ids)
      and event->>'moderation_status'='pending'
      and (event->>'can_moderate')::boolean
  ) then
    raise exception 'Admin could not read/moderate a pending team comment';
  end if;
end;
$$;

select public.moderate_live_feed_comment_v2(
  (select rep_a1_comment from live_feed_canary_ids),'approve','Reviewed: no customer data observed',true
);
select public.moderate_live_feed_comment_v2(
  (select company_comment from live_feed_canary_ids),'approve','Reviewed: no customer data observed',true
);
select public.moderate_live_feed_comment_v2(
  (select team_a2_comment from live_feed_canary_ids),'approve','Reviewed: no customer data observed',true
);

-- Team A1 member sees approved Team A1 comments and not Team A2 comments.
select pg_temp.live_feed_login((select rep_a1_auth from live_feed_canary_ids),'live-feed-rep-a1@preview.invalid');
do $$
declare team_feed jsonb;company_feed jsonb;
begin
  team_feed:=public.get_live_feed_v2('team',(select team_a1 from live_feed_canary_ids),100,null);
  if not exists (
    select 1 from jsonb_array_elements(team_feed->'events') event
    where event->>'comment_id'=(select rep_a1_comment::text from live_feed_canary_ids)
      and event->>'scope'='team'
      and event->>'scope_id'=(select team_a1::text from live_feed_canary_ids)
      and event->>'moderation_status'='approved'
  ) then raise exception 'approved Team A1 comment missing for assigned rep'; end if;
  if exists (
    select 1 from jsonb_array_elements(team_feed->'events') event
    where event->>'comment_id'=(select team_a2_comment::text from live_feed_canary_ids)
  ) then raise exception 'Team A2 comment leaked into Team A1 feed'; end if;
  if exists (
    select 1 from jsonb_array_elements(team_feed->'events') event
    where event->>'event_type'='sale'
  ) then raise exception 'company sale event leaked into team-comment feed'; end if;

  company_feed:=public.get_live_feed_v2('company',null,100,null);
  if not exists (
    select 1 from jsonb_array_elements(company_feed->'events') event
    where event->>'comment_id'=(select company_comment::text from live_feed_canary_ids)
      and event->>'scope'='company'
  ) then raise exception 'approved Company comment missing for rep'; end if;
  if not exists (
    select 1 from jsonb_array_elements(company_feed->'events') event
    where event->>'event_type'='sale'
      and event->>'message'='Preview Rep A1 closed a verified Quantum sale.'
  ) then raise exception 'verified sale missing from Company feed'; end if;
  if (company_feed->'context'->>'can_post_company')::boolean then
    raise exception 'rep received Company posting authority';
  end if;
end;
$$;

-- Team A2 rep cannot read Team A1; Company remains readable.
select pg_temp.live_feed_login((select rep_a2_auth from live_feed_canary_ids),'live-feed-rep-a2@preview.invalid');
do $$
begin
  begin
    perform public.get_live_feed_v2('team',(select team_a1 from live_feed_canary_ids),100,null);
    raise exception 'cross-team read was accepted';
  exception when sqlstate '42501' then
    if sqlerrm <> 'team_scope_forbidden' then raise; end if;
  end;
  if not exists (
    select 1 from jsonb_array_elements(public.get_live_feed_v2('company',null,100,null)->'events') event
    where event->>'comment_id'=(select company_comment::text from live_feed_canary_ids)
  ) then raise exception 'Company feed was not readable by Team A2 rep'; end if;
end;
$$;

-- Cross-organization users receive neither Company nor Team A data.
select pg_temp.live_feed_login((select rep_b_auth from live_feed_canary_ids),'live-feed-rep-b@preview.invalid');
do $$
declare feed jsonb;
begin
  feed:=public.get_live_feed_v2('company',null,100,null);
  if exists (
    select 1 from jsonb_array_elements(feed->'events') event
    where event->>'message' in ('Company announcement','Rep A1 team update','Team A2 Admin update')
  ) then raise exception 'organization A data leaked to organization B'; end if;
end;
$$;

-- Current login email is part of the read boundary.
select pg_temp.live_feed_login((select rep_a1_auth from live_feed_canary_ids),'changed-email@preview.invalid');
do $$
begin
  begin
    perform public.get_live_feed_v2('company',null,100,null);
    raise exception 'mismatched login email retained Live Feed access';
  exception when sqlstate '42501' then
    if sqlerrm <> 'active_organization_profile_required' then raise; end if;
  end;
end;
$$;

-- Public Realtime rows contain no moderation/deletion reasons or moderator identities.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='live_feed_comments'
      and column_name in ('moderation_reason','moderated_by_user_id','deletion_reason','deleted_by_user_id')
  ) then raise exception 'private moderation metadata exists on Realtime-readable comment rows'; end if;

  if has_table_privilege('authenticated','public.live_feed_comments','INSERT')
     or has_table_privilege('authenticated','public.live_feed_comments','UPDATE')
     or has_table_privilege('authenticated','public.live_feed_comments','DELETE') then
    raise exception 'authenticated role received direct comment write privileges';
  end if;
end;
$$;

rollback;
