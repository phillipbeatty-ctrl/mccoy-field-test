-- Preview-only, atomic Live Feed comments vertical slice.
--
-- This migration introduces two explicit server-enforced scopes:
--   company: readable by every active authorized organization member;
--            only an Admin may post.
--   team:    readable by Admins and members/managers/trainers authorized for
--            the referenced active team; all non-Admin posts are team-only.
--
-- Verified sales remain in public.sales_feed. User-authored comments remain
-- separate and never participate in rankings, compensation, provider
-- reconciliation, Customer List, Sales Bank, or sale verification.
--
-- PREVIEW ONLY. Apply only to an isolated Supabase preview branch.

begin;

create table public.live_feed_comments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  author_user_id uuid not null,
  author_display_name text not null,
  author_role text not null,
  scope text not null,
  scope_id uuid references public.teams(id) on delete restrict,
  body text not null,
  client_request_id uuid not null,
  moderation_status text not null default 'pending',
  published_at timestamptz,
  moderated_at timestamptz,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint live_feed_comments_body_length
    check (char_length(btrim(body)) between 1 and 280),
  constraint live_feed_comments_scope
    check (
      (scope = 'company' and scope_id is null)
      or (scope = 'team' and scope_id is not null)
    ),
  constraint live_feed_comments_author_role_present
    check (char_length(btrim(author_role)) between 1 and 40),
  constraint live_feed_comments_moderation_status
    check (moderation_status in ('pending', 'approved', 'rejected')),
  constraint live_feed_comments_moderation_state
    check (
      (
        moderation_status = 'pending'
        and published_at is null
        and moderated_at is null
      )
      or (
        moderation_status = 'approved'
        and published_at is not null
        and moderated_at is not null
      )
      or (
        moderation_status = 'rejected'
        and published_at is null
        and moderated_at is not null
        and deleted_at is not null
      )
    )
);

comment on table public.live_feed_comments is
  'Preview-only COMPANY and TEAM Live Feed comments. Comments are isolated from sales, rankings, compensation, provider verification, Customer List, and Sales Bank.';
comment on column public.live_feed_comments.scope is
  'Server-enforced audience: company or team.';
comment on column public.live_feed_comments.scope_id is
  'NULL for company scope; active same-organization public.teams.id for team scope.';
comment on column public.live_feed_comments.client_request_id is
  'Caller-generated idempotency key. One immutable submission per organization, author, and request ID.';
comment on column public.live_feed_comments.moderation_status is
  'Fail-closed publication state. Free-form comments remain pending until an organization Admin approves or rejects them.';
comment on column public.live_feed_comments.published_at is
  'Audience publication timestamp. NULL until Admin approval.';

create unique index live_feed_comments_author_request_unique
  on public.live_feed_comments(organization_id, author_user_id, client_request_id);
create index live_feed_comments_org_scope_event_idx
  on public.live_feed_comments(
    organization_id,
    scope,
    scope_id,
    coalesce(published_at, created_at) desc,
    id desc
  )
  where deleted_at is null;
create index live_feed_comments_org_pending_created_idx
  on public.live_feed_comments(organization_id, created_at desc, id desc)
  where deleted_at is null and moderation_status = 'pending';
create index live_feed_comments_author_rate_idx
  on public.live_feed_comments(organization_id, author_user_id, created_at desc);

alter table public.live_feed_comments enable row level security;
alter table public.live_feed_comments replica identity full;

revoke all on table public.live_feed_comments from public, anon, authenticated;
grant select on table public.live_feed_comments to authenticated;
grant select, insert, update, delete on table public.live_feed_comments to service_role;

create table private.live_feed_comment_deletions (
  comment_id uuid primary key,
  organization_id uuid not null,
  scope text not null,
  scope_id uuid,
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

create table private.live_feed_comment_moderation_events (
  id bigint generated by default as identity primary key,
  comment_id uuid not null,
  organization_id uuid not null,
  scope text not null,
  scope_id uuid,
  decision text not null,
  original_body text not null,
  moderated_at timestamptz not null,
  moderated_by_user_id uuid not null,
  moderated_by_email text not null,
  reason text not null,
  constraint live_feed_comment_moderation_decision
    check (decision in ('approved', 'rejected')),
  constraint live_feed_comment_moderation_reason_present
    check (char_length(btrim(reason)) between 3 and 240)
);

create unique index live_feed_comment_moderation_once
  on private.live_feed_comment_moderation_events(comment_id);
revoke all on table private.live_feed_comment_moderation_events from public, anon, authenticated;
grant select, insert on table private.live_feed_comment_moderation_events to service_role;

create or replace function private.prevent_live_feed_audit_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  raise exception 'live_feed_comment_audit_is_immutable' using errcode = '42501';
end;
$$;

revoke all on function private.prevent_live_feed_audit_change() from public, anon, authenticated;

drop trigger if exists live_feed_comment_deletions_immutable on private.live_feed_comment_deletions;
create trigger live_feed_comment_deletions_immutable
before update or delete on private.live_feed_comment_deletions
for each row execute function private.prevent_live_feed_audit_change();

drop trigger if exists live_feed_comment_moderation_events_immutable on private.live_feed_comment_moderation_events;
create trigger live_feed_comment_moderation_events_immutable
before update or delete on private.live_feed_comment_moderation_events
for each row execute function private.prevent_live_feed_audit_change();

create or replace function private.live_feed_actor_context()
returns table (
  organization_id uuid,
  auth_user_id uuid,
  app_user_id uuid,
  email text,
  display_name text,
  role text,
  primary_team_id uuid,
  primary_team_name text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private, auth
as $$
declare
  v_auth_user_id uuid := auth.uid();
  v_organization_id uuid;
  v_email text := lower(btrim(coalesce(auth.jwt()->>'email', '')));
begin
  if v_auth_user_id is null or v_email = '' then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  v_organization_id := private.current_organization_id();
  if v_organization_id is null then
    raise exception 'organization_membership_required' using errcode = '42501';
  end if;

  if not private.organization_access_allowed(v_organization_id, 'field_coach_access') then
    raise exception 'field_coach_access_required' using errcode = '42501';
  end if;

  return query
  select
    v_organization_id,
    v_auth_user_id,
    profile.id,
    v_email,
    coalesce(
      nullif(btrim(access.display_name), ''),
      nullif(btrim(profile.first_name || ' ' || profile.last_name), ''),
      v_email
    ),
    case when lower(btrim(access.role)) = 'tester' then 'rep' else lower(btrim(access.role)) end,
    profile.team_id,
    team.name
  from public.organization_memberships membership
  join public.app_user_access access
    on access.organization_id = membership.organization_id
   and lower(access.email) = lower(membership.email)
  left join public.users profile
    on profile.auth_user_id = membership.auth_user_id
   and profile.organization_id = membership.organization_id
   and profile.active
  left join public.teams team
    on team.id = profile.team_id
   and team.organization_id = membership.organization_id
   and team.active
  where membership.organization_id = v_organization_id
    and membership.auth_user_id = v_auth_user_id
    and membership.active
    and access.active
    and lower(access.email) = v_email
  limit 1;

  if not found then
    raise exception 'active_organization_access_required' using errcode = '42501';
  end if;
end;
$$;

revoke all on function private.live_feed_actor_context() from public, anon, authenticated;

create or replace function private.live_feed_actor_teams(
  p_organization_id uuid,
  p_app_user_id uuid,
  p_role text,
  p_primary_team_id uuid
)
returns table(team_id uuid, team_name text)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select distinct team.id, team.name
  from public.teams team
  where team.organization_id = p_organization_id
    and team.active
    and (
      p_role = 'admin'
      or team.id = p_primary_team_id
      or (
        p_role in ('manager', 'trainer')
        and p_app_user_id is not null
        and team.manager_user_id = p_app_user_id
      )
    )
  order by team.name, team.id;
$$;

revoke all on function private.live_feed_actor_teams(uuid, uuid, text, uuid) from public, anon, authenticated;

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
  if p_body ~ E'\\m(Customer|Subscriber|Homeowner)\\M[[:space:]:#-]+[[:upper:]][[:alpha:]''-]+[[:space:]]+[[:upper:]][[:alpha:]''-]+' then
    return 'customer_name_context';
  end if;
  return null;
end;
$$;

revoke all on function private.live_feed_comment_prohibited_reason(text) from public, anon, authenticated;

-- RLS is fail-closed from the first statement that makes comments readable.
-- Pending text is visible only to its author and organization Admins.
-- Approved COMPANY comments are visible organization-wide.
-- Approved TEAM comments are visible to organization Admins and server-derived
-- members/managers/trainers of the referenced active team.
create policy "authorized members read scoped live feed comments"
on public.live_feed_comments
for select
to authenticated
using (
  organization_id = private.current_organization_id()
  and private.organization_access_allowed(organization_id, 'field_coach_access')
  and exists (
    select 1
    from public.organization_memberships membership
    join public.app_user_access access
      on access.organization_id = membership.organization_id
     and lower(access.email) = lower(membership.email)
    left join public.users profile
      on profile.auth_user_id = membership.auth_user_id
     and profile.organization_id = membership.organization_id
     and profile.active
    where membership.organization_id = live_feed_comments.organization_id
      and membership.auth_user_id = auth.uid()
      and membership.active
      and access.active
      and lower(access.email) = lower(coalesce(auth.jwt()->>'email', ''))
      and (
        lower(access.role) = 'admin'
        or live_feed_comments.author_user_id = auth.uid()
        or (
          live_feed_comments.moderation_status = 'approved'
          and (
            live_feed_comments.scope = 'company'
            or (
              live_feed_comments.scope = 'team'
              and exists (
                select 1
                from public.teams visible_team
                where visible_team.id = live_feed_comments.scope_id
                  and visible_team.organization_id = live_feed_comments.organization_id
                  and visible_team.active
                  and (
                    profile.team_id = visible_team.id
                    or (
                      lower(access.role) in ('manager', 'trainer')
                      and profile.id is not null
                      and visible_team.manager_user_id = profile.id
                    )
                  )
              )
            )
          )
        )
      )
  )
);

create or replace function public.post_live_feed_comment_v1(
  p_body text,
  p_client_request_id uuid,
  p_scope text default 'team',
  p_scope_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, auth
as $$
declare
  v_actor record;
  v_body text;
  v_block_reason text;
  v_scope text := lower(btrim(coalesce(p_scope, '')));
  v_scope_id uuid := p_scope_id;
  v_scope_label text;
  v_team_count integer;
  v_existing public.live_feed_comments%rowtype;
  v_comment public.live_feed_comments%rowtype;
  v_now timestamptz := statement_timestamp();
begin
  select * into v_actor from private.live_feed_actor_context();

  if p_client_request_id is null then
    raise exception 'client_request_id_required' using errcode = '22023';
  end if;

  if v_scope not in ('company', 'team') then
    raise exception 'comment_scope_invalid' using errcode = '22023';
  end if;

  if v_scope = 'company' then
    if v_actor.role <> 'admin' then
      raise exception 'company_comment_admin_required' using errcode = '42501';
    end if;
    if v_scope_id is not null then
      raise exception 'company_scope_id_must_be_null' using errcode = '22023';
    end if;
    v_scope_label := 'Company';
  else
    if v_scope_id is null then
      select count(*), min(team_id)
      into v_team_count, v_scope_id
      from private.live_feed_actor_teams(
        v_actor.organization_id,
        v_actor.app_user_id,
        v_actor.role,
        v_actor.primary_team_id
      );
      if v_team_count = 0 then
        raise exception 'team_assignment_required' using errcode = '42501';
      end if;
      if v_team_count > 1 then
        raise exception 'team_scope_id_required' using errcode = '22023';
      end if;
    end if;

    select team_name
    into v_scope_label
    from private.live_feed_actor_teams(
      v_actor.organization_id,
      v_actor.app_user_id,
      v_actor.role,
      v_actor.primary_team_id
    )
    where team_id = v_scope_id;

    if not found then
      raise exception 'team_scope_forbidden' using errcode = '42501';
    end if;
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
  where organization_id = v_actor.organization_id
    and author_user_id = v_actor.auth_user_id
    and client_request_id = p_client_request_id;

  if found then
    if v_existing.deleted_at is not null then
      raise exception 'comment_request_already_deleted' using errcode = '23505';
    end if;
    if v_existing.body is distinct from v_body
       or v_existing.scope is distinct from v_scope
       or v_existing.scope_id is distinct from v_scope_id then
      raise exception 'client_request_id_reused' using errcode = '23505';
    end if;
    return jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'requires_moderation', v_existing.moderation_status = 'pending',
      'event', jsonb_build_object(
        'event_id', 'comment:' || v_existing.id::text,
        'event_type', 'comment',
        'comment_id', v_existing.id,
        'created_at', coalesce(v_existing.published_at, v_existing.created_at),
        'submitted_at', v_existing.created_at,
        'published_at', v_existing.published_at,
        'moderation_status', v_existing.moderation_status,
        'actor_user_id', v_existing.author_user_id,
        'actor_name', v_existing.author_display_name,
        'actor_role', v_existing.author_role,
        'message', v_existing.body,
        'secondary_messages', '[]'::jsonb,
        'scope', v_existing.scope,
        'scope_id', v_existing.scope_id,
        'scope_label', case when v_existing.scope = 'company' then 'Company' else v_scope_label end,
        'is_own', true,
        'can_delete', v_actor.role = 'admin' or v_existing.created_at >= v_now - interval '5 minutes',
        'can_moderate', v_actor.role = 'admin' and v_existing.moderation_status = 'pending',
        'delete_deadline', v_existing.created_at + interval '5 minutes'
      )
    );
  end if;

  if exists (
    select 1
    from public.live_feed_comments
    where organization_id = v_actor.organization_id
      and author_user_id = v_actor.auth_user_id
      and created_at > v_now - interval '3 seconds'
  ) then
    raise exception 'comment_rate_limited_3_seconds' using errcode = 'P0001';
  end if;

  if (
    select count(*)
    from public.live_feed_comments
    where organization_id = v_actor.organization_id
      and author_user_id = v_actor.auth_user_id
      and created_at > v_now - interval '1 minute'
  ) >= 5 then
    raise exception 'comment_rate_limited_5_per_minute' using errcode = 'P0001';
  end if;

  if (
    select count(*)
    from public.live_feed_comments
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
    created_at
  ) values (
    v_actor.organization_id,
    v_actor.auth_user_id,
    v_actor.display_name,
    v_actor.role,
    v_scope,
    v_scope_id,
    v_body,
    p_client_request_id,
    'pending',
    v_now
  )
  returning * into v_comment;

  return jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'requires_moderation', true,
    'event', jsonb_build_object(
      'event_id', 'comment:' || v_comment.id::text,
      'event_type', 'comment',
      'comment_id', v_comment.id,
      'created_at', v_comment.created_at,
      'submitted_at', v_comment.created_at,
      'published_at', null,
      'moderation_status', 'pending',
      'actor_user_id', v_comment.author_user_id,
      'actor_name', v_comment.author_display_name,
      'actor_role', v_comment.author_role,
      'message', v_comment.body,
      'secondary_messages', '[]'::jsonb,
      'scope', v_comment.scope,
      'scope_id', v_comment.scope_id,
      'scope_label', v_scope_label,
      'is_own', true,
      'can_delete', true,
      'can_moderate', v_actor.role = 'admin',
      'delete_deadline', v_comment.created_at + interval '5 minutes'
    )
  );
end;
$$;

revoke all on function public.post_live_feed_comment_v1(text, uuid, text, uuid) from public, anon;
grant execute on function public.post_live_feed_comment_v1(text, uuid, text, uuid) to authenticated;

create or replace function public.get_live_feed_v1(
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
  v_limit integer := greatest(1, least(coalesce(p_limit, 100), 100));
  v_cutoff timestamptz := statement_timestamp() - interval '30 days';
  v_now timestamptz := statement_timestamp();
  v_events jsonb;
  v_scopes jsonb;
  v_default_scope jsonb;
begin
  select * into v_actor from private.live_feed_actor_context();

  with scope_rows as (
    select
      0 as sort_group,
      'Company'::text as sort_name,
      'company'::text as scope,
      null::uuid as scope_id,
      'Company'::text as label,
      (v_actor.role = 'admin') as can_post
    union all
    select
      1,
      actor_team.team_name,
      'team',
      actor_team.team_id,
      'Team · ' || actor_team.team_name,
      true
    from private.live_feed_actor_teams(
      v_actor.organization_id,
      v_actor.app_user_id,
      v_actor.role,
      v_actor.primary_team_id
    ) actor_team
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'scope', scope,
        'scope_id', scope_id,
        'label', label,
        'can_post', can_post
      )
      order by sort_group, sort_name
    ),
    '[]'::jsonb
  )
  into v_scopes
  from scope_rows;

  if v_actor.role = 'admin' then
    v_default_scope := jsonb_build_object(
      'scope', 'company',
      'scope_id', null,
      'label', 'Company'
    );
  else
    select jsonb_build_object(
      'scope', 'team',
      'scope_id', team_id,
      'label', 'Team · ' || team_name
    )
    into v_default_scope
    from private.live_feed_actor_teams(
      v_actor.organization_id,
      v_actor.app_user_id,
      v_actor.role,
      v_actor.primary_team_id
    )
    order by (team_id = v_actor.primary_team_id) desc, team_name, team_id
    limit 1;
  end if;

  with actor_teams as (
    select team_id, team_name
    from private.live_feed_actor_teams(
      v_actor.organization_id,
      v_actor.app_user_id,
      v_actor.role,
      v_actor.primary_team_id
    )
  ), sale_events as (
    select
      feed.created_at as event_at,
      'sale:' || feed.id::text as event_id,
      jsonb_build_object(
        'event_id', 'sale:' || feed.id::text,
        'event_type', 'sale',
        'created_at', feed.created_at,
        'submitted_at', feed.created_at,
        'published_at', feed.created_at,
        'moderation_status', null,
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
        'scope_label', 'Company',
        'is_own', false,
        'can_delete', false,
        'can_moderate', false,
        'delete_deadline', null
      ) as event
    from public.sales_feed feed
    where feed.organization_id = v_actor.organization_id
      and feed.ranking_eligible_at_event
      and feed.created_at >= v_cutoff
      and feed.created_at < coalesce(p_before, 'infinity'::timestamptz)
  ), comment_events as (
    select
      coalesce(comment.published_at, comment.created_at) as event_at,
      'comment:' || comment.id::text as event_id,
      jsonb_build_object(
        'event_id', 'comment:' || comment.id::text,
        'event_type', 'comment',
        'comment_id', comment.id,
        'created_at', coalesce(comment.published_at, comment.created_at),
        'submitted_at', comment.created_at,
        'published_at', comment.published_at,
        'moderation_status', comment.moderation_status,
        'actor_user_id', comment.author_user_id,
        'actor_name', comment.author_display_name,
        'actor_role', comment.author_role,
        'message', comment.body,
        'secondary_messages', '[]'::jsonb,
        'related_sale_id', null,
        'scope', comment.scope,
        'scope_id', comment.scope_id,
        'scope_label', case
          when comment.scope = 'company' then 'Company'
          else 'Team · ' || coalesce(team.name, 'Unavailable')
        end,
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
    left join public.teams team
      on team.id = comment.scope_id
     and team.organization_id = comment.organization_id
    where comment.organization_id = v_actor.organization_id
      and comment.deleted_at is null
      and coalesce(comment.published_at, comment.created_at) >= v_cutoff
      and coalesce(comment.published_at, comment.created_at) < coalesce(p_before, 'infinity'::timestamptz)
      and (
        v_actor.role = 'admin'
        or comment.author_user_id = v_actor.auth_user_id
        or (
          comment.moderation_status = 'approved'
          and (
            comment.scope = 'company'
            or (
              comment.scope = 'team'
              and exists (
                select 1 from actor_teams visible
                where visible.team_id = comment.scope_id
              )
            )
          )
        )
      )
  ), combined as (
    select * from sale_events
    union all
    select * from comment_events
  ), limited as (
    select *
    from combined
    order by event_at desc, event_id desc
    limit v_limit
  )
  select coalesce(jsonb_agg(event order by event_at desc, event_id desc), '[]'::jsonb)
  into v_events
  from limited;

  return jsonb_build_object(
    'ok', true,
    'organization_id', v_actor.organization_id,
    'actor_role', v_actor.role,
    'actor_primary_team_id', v_actor.primary_team_id,
    'actor_primary_team_name', v_actor.primary_team_name,
    'retention_days', 30,
    'limit', v_limit,
    'moderation_required', true,
    'available_scopes', v_scopes,
    'default_post_scope', v_default_scope,
    'events', v_events
  );
end;
$$;

revoke all on function public.get_live_feed_v1(integer, timestamptz) from public, anon;
grant execute on function public.get_live_feed_v1(integer, timestamptz) to authenticated;

create or replace function public.moderate_live_feed_comment_v1(
  p_comment_id uuid,
  p_decision text,
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
  v_team_name text;
  v_now timestamptz := statement_timestamp();
  v_decision text := lower(btrim(coalesce(p_decision, '')));
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_block_reason text;
begin
  select * into v_actor from private.live_feed_actor_context();

  -- Manager/Trainer moderation remains deliberately ungranted in this preview.
  if v_actor.role <> 'admin' then
    raise exception 'admin_required' using errcode = '42501';
  end if;
  if p_comment_id is null then
    raise exception 'comment_id_required' using errcode = '22023';
  end if;
  if v_decision not in ('approve', 'reject') then
    raise exception 'comment_moderation_decision_invalid' using errcode = '22023';
  end if;
  if char_length(coalesce(v_reason, '')) < 3 then
    raise exception 'comment_moderation_reason_required' using errcode = '22023';
  end if;
  if char_length(v_reason) > 240 then
    raise exception 'comment_moderation_reason_too_long' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_comment_id::text, 20260904));

  select * into v_comment
  from public.live_feed_comments
  where id = p_comment_id
    and organization_id = v_actor.organization_id
  for update;

  if not found then
    raise exception 'comment_not_found' using errcode = 'P0002';
  end if;

  if v_comment.scope = 'team' then
    select name into v_team_name
    from public.teams
    where id = v_comment.scope_id
      and organization_id = v_actor.organization_id;
  end if;

  if v_decision = 'approve'
     and v_comment.moderation_status = 'approved'
     and v_comment.deleted_at is null then
    return jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'decision', 'approved',
      'event', jsonb_build_object(
        'event_id', 'comment:' || v_comment.id::text,
        'event_type', 'comment',
        'comment_id', v_comment.id,
        'created_at', v_comment.published_at,
        'submitted_at', v_comment.created_at,
        'published_at', v_comment.published_at,
        'moderation_status', 'approved',
        'actor_user_id', v_comment.author_user_id,
        'actor_name', v_comment.author_display_name,
        'actor_role', v_comment.author_role,
        'message', v_comment.body,
        'secondary_messages', '[]'::jsonb,
        'scope', v_comment.scope,
        'scope_id', v_comment.scope_id,
        'scope_label', case when v_comment.scope = 'company' then 'Company' else 'Team · ' || coalesce(v_team_name, 'Unavailable') end,
        'is_own', v_comment.author_user_id = v_actor.auth_user_id,
        'can_delete', true,
        'can_moderate', false,
        'delete_deadline', v_comment.created_at + interval '5 minutes'
      )
    );
  end if;

  if v_comment.deleted_at is not null or v_comment.moderation_status = 'rejected' then
    raise exception 'comment_already_rejected_or_removed' using errcode = 'P0001';
  end if;
  if v_comment.moderation_status <> 'pending' then
    raise exception 'comment_not_pending_moderation' using errcode = 'P0001';
  end if;

  if v_decision = 'approve' then
    v_block_reason := private.live_feed_comment_prohibited_reason(v_comment.body);
    if v_block_reason is not null then
      raise exception 'customer_information_not_allowed:%', v_block_reason using errcode = '22023';
    end if;

    insert into private.live_feed_comment_moderation_events(
      comment_id,
      organization_id,
      scope,
      scope_id,
      decision,
      original_body,
      moderated_at,
      moderated_by_user_id,
      moderated_by_email,
      reason
    ) values (
      v_comment.id,
      v_comment.organization_id,
      v_comment.scope,
      v_comment.scope_id,
      'approved',
      v_comment.body,
      v_now,
      v_actor.auth_user_id,
      v_actor.email,
      v_reason
    );

    update public.live_feed_comments
    set moderation_status = 'approved',
        published_at = v_now,
        moderated_at = v_now
    where id = v_comment.id
    returning * into v_comment;

    return jsonb_build_object(
      'ok', true,
      'idempotent', false,
      'decision', 'approved',
      'event', jsonb_build_object(
        'event_id', 'comment:' || v_comment.id::text,
        'event_type', 'comment',
        'comment_id', v_comment.id,
        'created_at', v_comment.published_at,
        'submitted_at', v_comment.created_at,
        'published_at', v_comment.published_at,
        'moderation_status', 'approved',
        'actor_user_id', v_comment.author_user_id,
        'actor_name', v_comment.author_display_name,
        'actor_role', v_comment.author_role,
        'message', v_comment.body,
        'secondary_messages', '[]'::jsonb,
        'scope', v_comment.scope,
        'scope_id', v_comment.scope_id,
        'scope_label', case when v_comment.scope = 'company' then 'Company' else 'Team · ' || coalesce(v_team_name, 'Unavailable') end,
        'is_own', v_comment.author_user_id = v_actor.auth_user_id,
        'can_delete', true,
        'can_moderate', false,
        'delete_deadline', v_comment.created_at + interval '5 minutes'
      )
    );
  end if;

  insert into private.live_feed_comment_moderation_events(
    comment_id,
    organization_id,
    scope,
    scope_id,
    decision,
    original_body,
    moderated_at,
    moderated_by_user_id,
    moderated_by_email,
    reason
  ) values (
    v_comment.id,
    v_comment.organization_id,
    v_comment.scope,
    v_comment.scope_id,
    'rejected',
    v_comment.body,
    v_now,
    v_actor.auth_user_id,
    v_actor.email,
    v_reason
  );

  update public.live_feed_comments
  set body = '[Comment rejected]',
      moderation_status = 'rejected',
      published_at = null,
      moderated_at = v_now,
      deleted_at = v_now
  where id = v_comment.id;

  return jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'decision', 'rejected',
    'comment_id', v_comment.id,
    'deleted_at', v_now
  );
end;
$$;

revoke all on function public.moderate_live_feed_comment_v1(uuid, text, text) from public, anon;
grant execute on function public.moderate_live_feed_comment_v1(uuid, text, text) to authenticated;

create or replace function public.delete_live_feed_comment_v1(
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
  v_now timestamptz := statement_timestamp();
  v_is_author boolean;
  v_is_admin boolean;
  v_reason text;
begin
  select * into v_actor from private.live_feed_actor_context();

  if p_comment_id is null then
    raise exception 'comment_id_required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_comment_id::text, 20260905));

  select * into v_comment
  from public.live_feed_comments
  where id = p_comment_id
    and organization_id = v_actor.organization_id
  for update;

  if not found then
    raise exception 'comment_not_found' using errcode = 'P0002';
  end if;

  if v_comment.deleted_at is not null then
    return jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'comment_id', v_comment.id,
      'deleted_at', v_comment.deleted_at
    );
  end if;

  v_is_author := v_comment.author_user_id = v_actor.auth_user_id;
  v_is_admin := v_actor.role = 'admin';

  if not v_is_author and not v_is_admin then
    raise exception 'comment_delete_forbidden' using errcode = '42501';
  end if;

  if v_is_author and not v_is_admin and v_comment.created_at < v_now - interval '5 minutes' then
    raise exception 'comment_delete_window_expired' using errcode = '42501';
  end if;

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if char_length(coalesce(v_reason, '')) > 200 then
    raise exception 'comment_delete_reason_too_long' using errcode = '22023';
  end if;
  if v_is_admin and not v_is_author and char_length(coalesce(v_reason, '')) < 3 then
    raise exception 'admin_delete_reason_required' using errcode = '22023';
  end if;
  if v_reason is null then
    v_reason := case
      when v_is_author then 'author_removed_within_5_minutes'
      else 'admin_removed'
    end;
  end if;

  insert into private.live_feed_comment_deletions (
    comment_id,
    organization_id,
    scope,
    scope_id,
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
    v_comment.scope,
    v_comment.scope_id,
    v_comment.body,
    v_comment.author_user_id,
    v_comment.author_display_name,
    v_now,
    v_actor.auth_user_id,
    v_actor.email,
    v_reason
  )
  on conflict (comment_id) do nothing;

  update public.live_feed_comments
  set body = '[Comment removed]',
      deleted_at = v_now
  where id = v_comment.id;

  return jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'comment_id', v_comment.id,
    'deleted_at', v_now
  );
end;
$$;

revoke all on function public.delete_live_feed_comment_v1(uuid, text) from public, anon;
grant execute on function public.delete_live_feed_comment_v1(uuid, text) to authenticated;

comment on function public.post_live_feed_comment_v1(text, uuid, text, uuid) is
  'Submits a server-scoped COMPANY or TEAM comment into fail-closed Admin moderation. Only Admins may post COMPANY; non-Admins are restricted to authorized teams.';
comment on function public.get_live_feed_v1(integer, timestamptz) is
  'Returns verified company sale events plus server-authorized COMPANY and TEAM comment events from the last 30 days.';
comment on function public.moderate_live_feed_comment_v1(uuid, text, text) is
  'Organization Admin-only approval or rejection. Manager and Trainer moderation is deliberately not granted in this preview.';
comment on function public.delete_live_feed_comment_v1(uuid, text) is
  'Soft-deletes a comment for its author within five minutes or for an organization Admin at any time; private audit evidence is immutable.';

-- Realtime uses the same RLS policy; the browser may subscribe by organization,
-- but PostgreSQL determines whether each COMPANY or TEAM row is visible.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1
       from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'live_feed_comments'
     ) then
    execute 'alter publication supabase_realtime add table public.live_feed_comments';
  end if;
end;
$$;

commit;
