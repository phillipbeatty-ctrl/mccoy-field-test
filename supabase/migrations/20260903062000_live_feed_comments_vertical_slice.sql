-- Preview-only Live Feed comments vertical slice with server-enforced COMPANY and TEAM scopes.
-- Verified sales remain authoritative in public.sales_feed. User comments remain separate and
-- never participate in rankings, compensation, provider reconciliation, Customer List, Sales Bank,
-- or sale verification. This migration is intentionally fail-closed on its own: every free-form
-- comment starts pending and cannot be broadcast until an organization Admin approves it.

create unique index if not exists teams_id_organization_live_feed_unique
  on public.teams(id, organization_id);

create table public.live_feed_comments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  author_user_id uuid not null,
  author_display_name text not null,
  author_role text not null,
  scope text not null,
  scope_id uuid,
  body text not null,
  client_request_id uuid not null,
  moderation_status text not null default 'pending',
  published_at timestamptz,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint live_feed_comments_body_length
    check (char_length(btrim(body)) between 1 and 280),
  constraint live_feed_comments_scope_v2
    check (
      (scope = 'company' and scope_id is null)
      or
      (scope = 'team' and scope_id is not null)
    ),
  constraint live_feed_comments_moderation_status
    check (moderation_status in ('pending', 'approved', 'rejected')),
  constraint live_feed_comments_moderation_timestamps
    check (
      (moderation_status = 'pending' and published_at is null)
      or
      (moderation_status = 'approved' and published_at is not null)
      or
      (moderation_status = 'rejected' and published_at is null)
    ),
  constraint live_feed_comments_author_role_present
    check (char_length(btrim(author_role)) between 1 and 40),
  constraint live_feed_comments_team_organization_fkey
    foreign key (scope_id, organization_id)
    references public.teams(id, organization_id)
    on delete restrict
);

comment on table public.live_feed_comments is
  'Preview-only company/team Live Feed comments. Every free-form comment is quarantined pending Admin approval and is separate from all sale, ranking, compensation, provider, and accounting authority.';
comment on column public.live_feed_comments.scope is
  'Server-enforced visibility and posting scope: company or team.';
comment on column public.live_feed_comments.scope_id is
  'Null for company scope; exact public.teams.id for team scope. Composite FK enforces same organization.';
comment on column public.live_feed_comments.client_request_id is
  'Caller-generated idempotency key. One immutable request identity per organization and author.';
comment on column public.live_feed_comments.moderation_status is
  'Pending comments are author/Admin-only. Approved comments are visible to the authorized company or team scope. Rejected comments remain author/Admin-only audit state.';

create unique index live_feed_comments_author_request_unique
  on public.live_feed_comments(organization_id, author_user_id, client_request_id);
create index live_feed_comments_scope_feed_idx
  on public.live_feed_comments(
    organization_id,
    scope,
    scope_id,
    moderation_status,
    (coalesce(published_at, created_at)) desc,
    id desc
  )
  where deleted_at is null;
create index live_feed_comments_author_rate_idx
  on public.live_feed_comments(organization_id, author_user_id, created_at desc);

alter table public.live_feed_comments enable row level security;
alter table public.live_feed_comments replica identity full;

revoke all on table public.live_feed_comments from public, anon, authenticated;
grant select on table public.live_feed_comments to authenticated;
grant select, insert, update, delete on table public.live_feed_comments to service_role;

create table private.live_feed_comment_moderation_events (
  id bigint generated always as identity primary key,
  comment_id uuid not null,
  organization_id uuid not null,
  original_body text not null,
  decision text not null check (decision in ('approve', 'reject')),
  moderator_user_id uuid not null,
  moderator_email text not null,
  reason text not null,
  created_at timestamptz not null default now()
);

comment on table private.live_feed_comment_moderation_events is
  'Private immutable Live Feed moderation evidence. Reasons and moderator identity never appear on the Realtime-readable comment row.';
revoke all on table private.live_feed_comment_moderation_events from public, anon, authenticated;
grant select, insert on table private.live_feed_comment_moderation_events to service_role;

create table private.live_feed_comment_deletions (
  comment_id uuid primary key,
  organization_id uuid not null,
  original_body text not null,
  original_author_user_id uuid not null,
  original_author_display_name text not null,
  deleted_at timestamptz not null,
  deleted_by_user_id uuid not null,
  deleted_by_email text not null,
  deletion_reason text not null
);

comment on table private.live_feed_comment_deletions is
  'Private immutable recovery evidence for soft-deleted Live Feed comments.';
revoke all on table private.live_feed_comment_deletions from public, anon, authenticated;
grant select, insert on table private.live_feed_comment_deletions to service_role;

create or replace function private.live_feed_actor_context()
returns table (
  organization_id uuid,
  auth_user_id uuid,
  email text,
  display_name text,
  role text,
  profile_user_id uuid,
  primary_team_id uuid,
  readable_team_ids uuid[],
  postable_team_ids uuid[]
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private, auth
as $$
declare
  v_user_id uuid := auth.uid();
  v_organization_id uuid;
  v_email text := lower(btrim(coalesce(auth.jwt()->>'email', '')));
  v_display_name text;
  v_role text;
  v_profile_user_id uuid;
  v_primary_team_id uuid;
  v_readable_team_ids uuid[] := array[]::uuid[];
  v_postable_team_ids uuid[] := array[]::uuid[];
begin
  if v_user_id is null or v_email = '' then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  v_organization_id := private.current_organization_id();
  if v_organization_id is null then
    raise exception 'organization_membership_required' using errcode = '42501';
  end if;

  select
    coalesce(nullif(btrim(access.display_name), ''), nullif(btrim(membership.email), ''), v_email),
    lower(btrim(access.role)),
    profile.id,
    profile.team_id
  into
    v_display_name,
    v_role,
    v_profile_user_id,
    v_primary_team_id
  from public.organization_memberships membership
  join public.app_user_access access
    on access.organization_id = membership.organization_id
   and lower(access.email) = lower(membership.email)
  join public.users profile
    on profile.organization_id = membership.organization_id
   and profile.auth_user_id = membership.auth_user_id
  where membership.organization_id = v_organization_id
    and membership.auth_user_id = v_user_id
    and membership.active
    and access.active
    and profile.active
    and lower(access.email) = v_email
    and lower(membership.email) = v_email
    and (profile.email is null or lower(profile.email) = v_email)
    and lower(membership.role) = lower(access.role)
    and lower(profile.role) = lower(access.role)
  limit 1;

  if v_display_name is null or v_role is null or v_profile_user_id is null then
    raise exception 'active_organization_profile_required' using errcode = '42501';
  end if;

  if v_role not in ('admin', 'manager', 'trainer', 'rep') then
    raise exception 'live_feed_role_not_supported' using errcode = '42501';
  end if;

  if not private.organization_access_allowed(v_organization_id, 'field_coach_access') then
    raise exception 'field_coach_access_required' using errcode = '42501';
  end if;

  select coalesce(array_agg(team.id order by team.name, team.id), array[]::uuid[])
  into v_readable_team_ids
  from public.teams team
  where team.organization_id = v_organization_id
    and (
      v_role = 'admin'
      or (
        team.active
        and (
          team.id = v_primary_team_id
          or (
            v_role in ('manager', 'trainer')
            and team.manager_user_id = v_profile_user_id
          )
        )
      )
    );

  select coalesce(array_agg(team.id order by team.name, team.id), array[]::uuid[])
  into v_postable_team_ids
  from public.teams team
  where team.organization_id = v_organization_id
    and team.active
    and (
      v_role = 'admin'
      or team.id = v_primary_team_id
      or (
        v_role in ('manager', 'trainer')
        and team.manager_user_id = v_profile_user_id
      )
    );

  return query
  select
    v_organization_id,
    v_user_id,
    v_email,
    v_display_name,
    v_role,
    v_profile_user_id,
    v_primary_team_id,
    v_readable_team_ids,
    v_postable_team_ids;
end;
$$;

revoke all on function private.live_feed_actor_context() from public, anon, authenticated;

create or replace function private.live_feed_comment_visible_to_current_user(
  p_organization_id uuid,
  p_scope text,
  p_scope_id uuid,
  p_author_user_id uuid,
  p_moderation_status text,
  p_deleted_at timestamptz
)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private, auth
as $$
declare
  v_actor record;
begin
  if p_deleted_at is not null then
    return false;
  end if;

  begin
    select * into v_actor from private.live_feed_actor_context();
  exception when others then
    return false;
  end;

  if p_organization_id is distinct from v_actor.organization_id then
    return false;
  end if;

  if p_moderation_status <> 'approved'
     and p_author_user_id is distinct from v_actor.auth_user_id
     and v_actor.role <> 'admin' then
    return false;
  end if;

  if p_scope = 'company' and p_scope_id is null then
    return true;
  end if;

  if p_scope = 'team'
     and p_scope_id is not null
     and p_scope_id = any(v_actor.readable_team_ids) then
    return true;
  end if;

  return false;
end;
$$;

revoke all on function private.live_feed_comment_visible_to_current_user(uuid,text,uuid,uuid,text,timestamptz)
  from public, anon;
grant execute on function private.live_feed_comment_visible_to_current_user(uuid,text,uuid,uuid,text,timestamptz)
  to authenticated;

create policy "authorized company and team members read visible live feed comments"
on public.live_feed_comments
for select
to authenticated
using (
  private.live_feed_comment_visible_to_current_user(
    organization_id,
    scope,
    scope_id,
    author_user_id,
    moderation_status,
    deleted_at
  )
);

create or replace function private.live_feed_comment_prohibited_reason(p_body text)
returns text
language plpgsql
immutable
set search_path = pg_catalog
as $$
begin
  if p_body ~* '[[:alnum:]_.%+\-]+@[[:alnum:].\-]+\.[[:alpha:]]{2,}' then
    return 'email_address';
  end if;
  if p_body ~* '(\+?1[^0-9]*)?(\(?[0-9]{3}\)?[^0-9]*)[0-9]{3}[^0-9]*[0-9]{4}' then
    return 'phone_number';
  end if;
  if p_body ~ '[0-9]{7,}' then
    return 'long_numeric_identifier';
  end if;
  if p_body ~* '(order|account|acct)[[:space:]]*(number|no\.?|#)?[[:space:]:#\-]*[[:alnum:]\-]{4,}' then
    return 'order_or_account_identifier';
  end if;
  if p_body ~* '[0-9]{1,6}[[:space:]]+[[:alnum:].''\-]+([[:space:]]+[[:alnum:].''\-]+){0,3}[[:space:]]+(street|st|avenue|ave|road|rd|drive|dr|lane|ln|boulevard|blvd|court|ct|way|place|pl)([[:space:]]|$)' then
    return 'street_address';
  end if;
  if p_body ~* '(customer|subscriber|client)[[:space:]:#\-]+[[:alpha:]][[:alpha:]''\-]+[[:space:]]+[[:alpha:]][[:alpha:]''\-]+' then
    return 'customer_name_context';
  end if;
  return null;
end;
$$;

revoke all on function private.live_feed_comment_prohibited_reason(text) from public, anon, authenticated;

create or replace function private.live_feed_assert_scope(
  p_organization_id uuid,
  p_role text,
  p_readable_team_ids uuid[],
  p_postable_team_ids uuid[],
  p_scope text,
  p_scope_id uuid,
  p_for_post boolean
)
returns text
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_scope text := lower(btrim(coalesce(p_scope, '')));
  v_team_name text;
  v_allowed_team_ids uuid[] := case
    when p_for_post then coalesce(p_postable_team_ids, array[]::uuid[])
    else coalesce(p_readable_team_ids, array[]::uuid[])
  end;
begin
  if v_scope = 'company' then
    if p_scope_id is not null then
      raise exception 'company_scope_id_must_be_null' using errcode = '22023';
    end if;
    if p_for_post and p_role <> 'admin' then
      raise exception 'company_post_admin_required' using errcode = '42501';
    end if;
    return 'Company';
  end if;

  if v_scope <> 'team' then
    raise exception 'invalid_live_feed_scope' using errcode = '22023';
  end if;
  if p_scope_id is null then
    raise exception 'team_scope_id_required' using errcode = '22023';
  end if;
  if not (p_scope_id = any(v_allowed_team_ids)) then
    raise exception 'team_scope_forbidden' using errcode = '42501';
  end if;

  select team.name into v_team_name
  from public.teams team
  where team.id = p_scope_id
    and team.organization_id = p_organization_id
    and (not p_for_post or team.active);

  if v_team_name is null then
    raise exception 'team_scope_not_found' using errcode = 'P0002';
  end if;

  return v_team_name;
end;
$$;

revoke all on function private.live_feed_assert_scope(uuid,text,uuid[],uuid[],text,uuid,boolean) from public, anon, authenticated;

create or replace function public.post_live_feed_comment_v2(
  p_scope text,
  p_scope_id uuid,
  p_body text,
  p_client_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, auth
as $$
declare
  v_actor record;
  v_scope text := lower(btrim(coalesce(p_scope, '')));
  v_scope_name text;
  v_body text;
  v_block_reason text;
  v_existing public.live_feed_comments%rowtype;
  v_comment public.live_feed_comments%rowtype;
  v_now timestamptz := statement_timestamp();
begin
  select * into v_actor from private.live_feed_actor_context();
  v_scope_name := private.live_feed_assert_scope(v_actor.organization_id, v_actor.role, v_actor.readable_team_ids, v_actor.postable_team_ids, v_scope, p_scope_id, true);

  if p_client_request_id is null then
    raise exception 'client_request_id_required' using errcode = '22023';
  end if;

  v_body := replace(replace(btrim(coalesce(p_body, '')), E'\r\n', E'\n'), E'\r', E'\n');
  v_body := regexp_replace(v_body, '[[:blank:]]+', ' ', 'g');
  v_body := regexp_replace(v_body, E'\n{3,}', E'\n\n', 'g');
  if char_length(v_body) < 1 then
    raise exception 'comment_required' using errcode = '22023';
  end if;
  if char_length(v_body) > 280 then
    raise exception 'comment_too_long' using errcode = '22023';
  end if;

  v_block_reason := private.live_feed_comment_prohibited_reason(v_body);
  if v_block_reason is not null then
    raise exception 'customer_information_not_allowed:%', v_block_reason using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_actor.auth_user_id::text, 20260903));

  select * into v_existing
  from public.live_feed_comments
  where author_user_id = v_actor.auth_user_id
    and organization_id = v_actor.organization_id
    and client_request_id = p_client_request_id;

  if found then
    if v_existing.deleted_at is not null or v_existing.moderation_status = 'rejected' then
      raise exception 'comment_request_closed' using errcode = '23505';
    end if;
    if v_existing.body is distinct from v_body
       or v_existing.scope is distinct from v_scope
       or v_existing.scope_id is distinct from p_scope_id then
      raise exception 'client_request_id_reused' using errcode = '23505';
    end if;
    return jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'event', jsonb_build_object(
        'event_id', 'comment:' || v_existing.id::text,
        'event_type', 'comment',
        'comment_id', v_existing.id,
        'created_at', v_existing.created_at,
        'submitted_at', v_existing.created_at,
        'published_at', v_existing.published_at,
        'actor_user_id', v_existing.author_user_id,
        'actor_name', v_existing.author_display_name,
        'actor_role', v_existing.author_role,
        'message', v_existing.body,
        'secondary_messages', '[]'::jsonb,
        'scope', v_existing.scope,
        'scope_id', v_existing.scope_id,
        'scope_name', v_scope_name,
        'moderation_status', v_existing.moderation_status,
        'is_own', true,
        'can_delete', v_actor.role = 'admin' or v_existing.created_at >= v_now - interval '5 minutes',
        'can_moderate', v_actor.role = 'admin' and v_existing.moderation_status = 'pending',
        'delete_deadline', v_existing.created_at + interval '5 minutes'
      )
    );
  end if;

  if exists (
    select 1 from public.live_feed_comments
    where organization_id = v_actor.organization_id
      and author_user_id = v_actor.auth_user_id
      and created_at > v_now - interval '3 seconds'
  ) then
    raise exception 'comment_rate_limited_3_seconds' using errcode = 'P0001';
  end if;

  if (
    select count(*) from public.live_feed_comments
    where organization_id = v_actor.organization_id
      and author_user_id = v_actor.auth_user_id
      and created_at > v_now - interval '1 minute'
  ) >= 5 then
    raise exception 'comment_rate_limited_5_per_minute' using errcode = 'P0001';
  end if;

  if (
    select count(*) from public.live_feed_comments
    where organization_id = v_actor.organization_id
      and author_user_id = v_actor.auth_user_id
      and created_at > v_now - interval '1 hour'
  ) >= 30 then
    raise exception 'comment_rate_limited_30_per_hour' using errcode = 'P0001';
  end if;

  insert into public.live_feed_comments (
    organization_id,
    author_user_id,
    author_display_name,
    author_role,
    scope,
    scope_id,
    body,
    client_request_id,
    moderation_status,
    published_at,
    created_at
  ) values (
    v_actor.organization_id,
    v_actor.auth_user_id,
    v_actor.display_name,
    v_actor.role,
    v_scope,
    p_scope_id,
    v_body,
    p_client_request_id,
    'pending',
    null,
    v_now
  )
  returning * into v_comment;

  return jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'event', jsonb_build_object(
      'event_id', 'comment:' || v_comment.id::text,
      'event_type', 'comment',
      'comment_id', v_comment.id,
      'created_at', v_comment.created_at,
      'submitted_at', v_comment.created_at,
      'published_at', null,
      'actor_user_id', v_comment.author_user_id,
      'actor_name', v_comment.author_display_name,
      'actor_role', v_comment.author_role,
      'message', v_comment.body,
      'secondary_messages', '[]'::jsonb,
      'scope', v_comment.scope,
      'scope_id', v_comment.scope_id,
      'scope_name', v_scope_name,
      'moderation_status', 'pending',
      'is_own', true,
      'can_delete', true,
      'can_moderate', v_actor.role = 'admin',
      'delete_deadline', v_comment.created_at + interval '5 minutes'
    )
  );
end;
$$;

revoke all on function public.post_live_feed_comment_v2(text,uuid,text,uuid) from public, anon;
grant execute on function public.post_live_feed_comment_v2(text,uuid,text,uuid) to authenticated;

create or replace function public.moderate_live_feed_comment_v2(
  p_comment_id uuid,
  p_decision text,
  p_reason text,
  p_certify_no_customer_data boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, auth
as $$
declare
  v_actor record;
  v_comment public.live_feed_comments%rowtype;
  v_decision text := lower(btrim(coalesce(p_decision, '')));
  v_reason text := btrim(coalesce(p_reason, ''));
  v_scope_name text;
  v_now timestamptz := statement_timestamp();
begin
  select * into v_actor from private.live_feed_actor_context();
  if v_actor.role <> 'admin' then
    raise exception 'admin_required' using errcode = '42501';
  end if;
  if v_decision not in ('approve', 'reject') then
    raise exception 'invalid_moderation_decision' using errcode = '22023';
  end if;
  if char_length(v_reason) < 3 then
    raise exception 'moderation_reason_required' using errcode = '22023';
  end if;
  if v_decision = 'approve' and not coalesce(p_certify_no_customer_data, false) then
    raise exception 'customer_data_review_certification_required' using errcode = '22023';
  end if;

  select * into v_comment
  from public.live_feed_comments
  where id = p_comment_id
    and organization_id = v_actor.organization_id
    and deleted_at is null
  for update;

  if not found then
    raise exception 'comment_not_found' using errcode = 'P0002';
  end if;
  if v_comment.moderation_status <> 'pending' then
    raise exception 'comment_already_moderated' using errcode = '23505';
  end if;
  if v_decision = 'approve' and v_comment.created_at < v_now - interval '30 days' then
    raise exception 'comment_approval_window_expired' using errcode = '22023';
  end if;

  v_scope_name := private.live_feed_assert_scope(v_actor.organization_id, v_actor.role, v_actor.readable_team_ids, v_actor.postable_team_ids, v_comment.scope, v_comment.scope_id, false);

  insert into private.live_feed_comment_moderation_events (
    comment_id,
    organization_id,
    original_body,
    decision,
    moderator_user_id,
    moderator_email,
    reason,
    created_at
  ) values (
    v_comment.id,
    v_comment.organization_id,
    v_comment.body,
    v_decision,
    v_actor.auth_user_id,
    v_actor.email,
    v_reason,
    v_now
  );

  update public.live_feed_comments
  set moderation_status = case when v_decision = 'approve' then 'approved' else 'rejected' end,
      published_at = case when v_decision = 'approve' then v_now else null end
  where id = v_comment.id
  returning * into v_comment;

  return jsonb_build_object(
    'ok', true,
    'decision', v_decision,
    'event', jsonb_build_object(
      'event_id', 'comment:' || v_comment.id::text,
      'event_type', 'comment',
      'comment_id', v_comment.id,
      'created_at', coalesce(v_comment.published_at, v_comment.created_at),
      'submitted_at', v_comment.created_at,
      'published_at', v_comment.published_at,
      'actor_user_id', v_comment.author_user_id,
      'actor_name', v_comment.author_display_name,
      'actor_role', v_comment.author_role,
      'message', v_comment.body,
      'secondary_messages', '[]'::jsonb,
      'scope', v_comment.scope,
      'scope_id', v_comment.scope_id,
      'scope_name', v_scope_name,
      'moderation_status', v_comment.moderation_status,
      'is_own', v_comment.author_user_id = v_actor.auth_user_id,
      'can_delete', true,
      'can_moderate', false,
      'delete_deadline', v_comment.created_at + interval '5 minutes'
    )
  );
end;
$$;

revoke all on function public.moderate_live_feed_comment_v2(uuid,text,text,boolean) from public, anon;
grant execute on function public.moderate_live_feed_comment_v2(uuid,text,text,boolean) to authenticated;

create or replace function public.delete_live_feed_comment_v2(
  p_comment_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, auth
as $$
declare
  v_actor record;
  v_comment public.live_feed_comments%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_now timestamptz := statement_timestamp();
  v_is_author boolean;
begin
  select * into v_actor from private.live_feed_actor_context();

  select * into v_comment
  from public.live_feed_comments
  where id = p_comment_id
    and organization_id = v_actor.organization_id
    and deleted_at is null
  for update;

  if not found then
    raise exception 'comment_not_found' using errcode = 'P0002';
  end if;

  v_is_author := v_comment.author_user_id = v_actor.auth_user_id;
  if v_actor.role <> 'admin' then
    if not v_is_author then
      raise exception 'comment_delete_forbidden' using errcode = '42501';
    end if;
    if v_comment.created_at < v_now - interval '5 minutes' then
      raise exception 'comment_delete_window_expired' using errcode = '42501';
    end if;
  elsif not v_is_author and char_length(v_reason) < 3 then
    raise exception 'admin_deletion_reason_required' using errcode = '22023';
  end if;

  if v_reason = '' then
    v_reason := case when v_is_author then 'author_removed' else 'admin_removed' end;
  end if;

  insert into private.live_feed_comment_deletions (
    comment_id,
    organization_id,
    original_body,
    original_author_user_id,
    original_author_display_name,
    deleted_at,
    deleted_by_user_id,
    deleted_by_email,
    deletion_reason
  ) values (
    v_comment.id,
    v_comment.organization_id,
    v_comment.body,
    v_comment.author_user_id,
    v_comment.author_display_name,
    v_now,
    v_actor.auth_user_id,
    v_actor.email,
    v_reason
  );

  update public.live_feed_comments
  set deleted_at = v_now
  where id = v_comment.id;

  return jsonb_build_object('ok', true, 'comment_id', v_comment.id);
end;
$$;

revoke all on function public.delete_live_feed_comment_v2(uuid,text) from public, anon;
grant execute on function public.delete_live_feed_comment_v2(uuid,text) to authenticated;

create or replace function public.get_live_feed_v2(
  p_scope text default 'company',
  p_scope_id uuid default null,
  p_limit integer default 100,
  p_before timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private, auth
as $$
declare
  v_actor record;
  v_scope text := lower(btrim(coalesce(p_scope, 'company')));
  v_scope_name text;
  v_limit integer := greatest(1, least(coalesce(p_limit, 100), 100));
  v_now timestamptz := statement_timestamp();
  v_cutoff timestamptz := statement_timestamp() - interval '30 days';
  v_events jsonb;
  v_teams jsonb;
  v_can_post boolean;
begin
  select * into v_actor from private.live_feed_actor_context();
  v_scope_name := private.live_feed_assert_scope(v_actor.organization_id, v_actor.role, v_actor.readable_team_ids, v_actor.postable_team_ids, v_scope, p_scope_id, false);
  v_can_post := case
    when v_scope = 'company' then v_actor.role = 'admin'
    else p_scope_id = any(v_actor.postable_team_ids)
  end;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'scope', 'team',
      'scope_id', team.id,
      'name', team.name,
      'active', team.active,
      'can_post', team.id = any(v_actor.postable_team_ids)
    ) order by team.active desc, team.name, team.id
  ), '[]'::jsonb)
  into v_teams
  from public.teams team
  where team.organization_id = v_actor.organization_id
    and team.id = any(v_actor.readable_team_ids);

  with sale_events as (
    select
      feed.created_at as sort_at,
      'sale:' || feed.id::text as event_id,
      jsonb_build_object(
        'event_id', 'sale:' || feed.id::text,
        'event_type', 'sale',
        'created_at', feed.created_at,
        'submitted_at', feed.created_at,
        'published_at', feed.created_at,
        'actor_user_id', feed.rep_user_id,
        'actor_name', feed.rep_name,
        'actor_role', null,
        'message', feed.message,
        'secondary_messages', coalesce((
          select jsonb_agg(message.value order by message.ordinality)
          from jsonb_array_elements_text(
            case
              when jsonb_typeof(feed.celebration_messages) = 'array' then feed.celebration_messages
              else '[]'::jsonb
            end
          ) with ordinality as message(value, ordinality)
          where btrim(message.value) <> ''
            and btrim(message.value) <> btrim(feed.message)
        ), '[]'::jsonb),
        'related_sale_id', feed.sale_id,
        'celebration_types', to_jsonb(feed.celebration_types),
        'scope', 'company',
        'scope_id', null,
        'scope_name', 'Company',
        'moderation_status', 'approved',
        'is_own', false,
        'can_delete', false,
        'can_moderate', false,
        'delete_deadline', null
      ) as event
    from public.sales_feed feed
    where v_scope = 'company'
      and feed.organization_id = v_actor.organization_id
      and feed.ranking_eligible_at_event
      and feed.created_at >= v_cutoff
      and feed.created_at < coalesce(p_before, 'infinity'::timestamptz)
  ), comment_events as (
    select
      case
        when comment.moderation_status = 'approved' then comment.published_at
        else comment.created_at
      end as sort_at,
      'comment:' || comment.id::text as event_id,
      jsonb_build_object(
        'event_id', 'comment:' || comment.id::text,
        'event_type', 'comment',
        'comment_id', comment.id,
        'created_at', case
          when comment.moderation_status = 'approved' then comment.published_at
          else comment.created_at
        end,
        'submitted_at', comment.created_at,
        'published_at', comment.published_at,
        'actor_user_id', comment.author_user_id,
        'actor_name', comment.author_display_name,
        'actor_role', comment.author_role,
        'message', comment.body,
        'secondary_messages', '[]'::jsonb,
        'related_sale_id', null,
        'scope', comment.scope,
        'scope_id', comment.scope_id,
        'scope_name', case when comment.scope = 'company' then 'Company' else v_scope_name end,
        'moderation_status', comment.moderation_status,
        'is_own', comment.author_user_id = v_actor.auth_user_id,
        'can_delete',
          v_actor.role = 'admin'
          or (
            comment.author_user_id = v_actor.auth_user_id
            and comment.created_at >= v_now - interval '5 minutes'
          ),
        'can_moderate', v_actor.role = 'admin' and comment.moderation_status = 'pending',
        'delete_deadline', comment.created_at + interval '5 minutes'
      ) as event
    from public.live_feed_comments comment
    where comment.organization_id = v_actor.organization_id
      and comment.deleted_at is null
      and comment.scope = v_scope
      and comment.scope_id is not distinct from p_scope_id
      and (
        comment.moderation_status = 'approved'
        or comment.author_user_id = v_actor.auth_user_id
        or v_actor.role = 'admin'
      )
      and case
        when comment.moderation_status = 'approved' then comment.published_at
        else comment.created_at
      end >= v_cutoff
      and case
        when comment.moderation_status = 'approved' then comment.published_at
        else comment.created_at
      end < coalesce(p_before, 'infinity'::timestamptz)
  ), combined as (
    select * from sale_events
    union all
    select * from comment_events
  ), limited as (
    select sort_at, event_id, event
    from combined
    order by sort_at desc, event_id desc
    limit v_limit
  )
  select coalesce(jsonb_agg(event order by sort_at desc, event_id desc), '[]'::jsonb)
  into v_events
  from limited;

  return jsonb_build_object(
    'ok', true,
    'events', v_events,
    'context', jsonb_build_object(
      'organization_id', v_actor.organization_id,
      'user_id', v_actor.auth_user_id,
      'email', v_actor.email,
      'role', v_actor.role,
      'selected_scope', v_scope,
      'selected_scope_id', p_scope_id,
      'selected_scope_name', v_scope_name,
      'can_post', v_can_post,
      'can_post_company', v_actor.role = 'admin',
      'can_moderate', v_actor.role = 'admin',
      'teams', v_teams
    )
  );
end;
$$;

revoke all on function public.get_live_feed_v2(text,uuid,integer,timestamptz) from public, anon;
grant execute on function public.get_live_feed_v2(text,uuid,integer,timestamptz) to authenticated;

-- The v1 preview contract is intentionally unavailable after COMPANY/TEAM scope support.
-- This prevents an older organization-wide client from bypassing the explicit scope selector.
drop function if exists public.post_live_feed_comment_v1(text,uuid);
drop function if exists public.get_live_feed_v1(integer,timestamptz);
drop function if exists public.moderate_live_feed_comment_v1(uuid,text,text);
drop function if exists public.delete_live_feed_comment_v1(uuid,text);

-- Realtime uses the same RLS policy. Pending/rejected rows remain author/Admin-only;
-- approved TEAM rows remain server-filtered to current team authority.
do $$
begin
  alter publication supabase_realtime add table public.live_feed_comments;
exception
  when duplicate_object then null;
end;
$$;
