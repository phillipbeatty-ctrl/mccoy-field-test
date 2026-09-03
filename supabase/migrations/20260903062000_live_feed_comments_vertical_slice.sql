-- Preview-only Live Feed comments vertical slice.
-- Verified sales remain in public.sales_feed. User-authored comments use a
-- separate organization-scoped table and never participate in rankings,
-- compensation, provider reconciliation, or sale verification.

create table if not exists public.live_feed_comments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  author_user_id uuid not null,
  author_display_name text not null,
  author_role text not null,
  scope text not null default 'organization',
  scope_id uuid,
  body text not null,
  client_request_id uuid not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by_user_id uuid,
  deletion_reason text,
  constraint live_feed_comments_body_length
    check (char_length(btrim(body)) between 1 and 280),
  constraint live_feed_comments_scope_v1
    check (scope = 'organization' and scope_id is null),
  constraint live_feed_comments_author_role_present
    check (char_length(btrim(author_role)) between 1 and 40)
);

comment on table public.live_feed_comments is
  'Organization-scoped standalone Live Feed comments. No sale, ranking, compensation, provider, thread, reaction, mention, attachment, or push-notification semantics.';
comment on column public.live_feed_comments.scope is
  'Reserved for future feed scoping. Version 1 permits organization only.';
comment on column public.live_feed_comments.client_request_id is
  'Caller-generated idempotency key. One comment per author and request ID.';

create unique index if not exists live_feed_comments_author_request_unique
  on public.live_feed_comments(organization_id, author_user_id, client_request_id);
create index if not exists live_feed_comments_org_created_idx
  on public.live_feed_comments(organization_id, created_at desc, id desc);
create index if not exists live_feed_comments_org_active_created_idx
  on public.live_feed_comments(organization_id, created_at desc, id desc)
  where deleted_at is null;
create index if not exists live_feed_comments_author_rate_idx
  on public.live_feed_comments(author_user_id, created_at desc);

alter table public.live_feed_comments enable row level security;
alter table public.live_feed_comments replica identity full;

revoke all on table public.live_feed_comments from public, anon, authenticated;
grant select on table public.live_feed_comments to authenticated;
grant select, insert, update, delete on table public.live_feed_comments to service_role;

drop policy if exists "active organization members read live feed comments" on public.live_feed_comments;
create policy "active organization members read live feed comments"
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
    where membership.organization_id = live_feed_comments.organization_id
      and membership.auth_user_id = auth.uid()
      and membership.active
      and access.active
  )
);

create table if not exists private.live_feed_comment_deletions (
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
  role text
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
    lower(btrim(access.role))
  into v_display_name, v_role
  from public.organization_memberships membership
  join public.app_user_access access
    on access.organization_id = membership.organization_id
   and lower(access.email) = lower(membership.email)
  where membership.organization_id = v_organization_id
    and membership.auth_user_id = v_user_id
    and membership.active
    and access.active
    and lower(access.email) = v_email
  limit 1;

  if v_display_name is null or v_role is null then
    raise exception 'active_organization_access_required' using errcode = '42501';
  end if;

  if not private.organization_access_allowed(v_organization_id, 'field_coach_access') then
    raise exception 'field_coach_access_required' using errcode = '42501';
  end if;

  return query
  select v_organization_id, v_user_id, v_email, v_display_name, v_role;
end;
$$;

revoke all on function private.live_feed_actor_context() from public, anon, authenticated;

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
  return null;
end;
$$;

revoke all on function private.live_feed_comment_prohibited_reason(text) from public, anon, authenticated;

create or replace function public.post_live_feed_comment_v1(
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
  v_body text;
  v_block_reason text;
  v_existing public.live_feed_comments%rowtype;
  v_comment public.live_feed_comments%rowtype;
  v_now timestamptz := statement_timestamp();
begin
  select * into v_actor from private.live_feed_actor_context();

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
    if v_existing.deleted_at is not null then
      raise exception 'comment_request_already_deleted' using errcode = '23505';
    end if;
    if v_existing.body is distinct from v_body then
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
        'actor_user_id', v_existing.author_user_id,
        'actor_name', v_existing.author_display_name,
        'actor_role', v_existing.author_role,
        'message', v_existing.body,
        'secondary_messages', '[]'::jsonb,
        'scope', v_existing.scope,
        'is_own', true,
        'can_delete', v_actor.role = 'admin' or v_existing.created_at >= v_now - interval '5 minutes',
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
    created_at
  ) values (
    v_actor.organization_id,
    v_actor.auth_user_id,
    v_actor.display_name,
    v_actor.role,
    'organization',
    null,
    v_body,
    p_client_request_id,
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
      'actor_user_id', v_comment.author_user_id,
      'actor_name', v_comment.author_display_name,
      'actor_role', v_comment.author_role,
      'message', v_comment.body,
      'secondary_messages', '[]'::jsonb,
      'scope', v_comment.scope,
      'is_own', true,
      'can_delete', true,
      'delete_deadline', v_comment.created_at + interval '5 minutes'
    )
  );
end;
$$;

revoke all on function public.post_live_feed_comment_v1(text, uuid) from public, anon;
grant execute on function public.post_live_feed_comment_v1(text, uuid) to authenticated;

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
  v_now timestamptz := statement_timestamp();
  v_cutoff timestamptz := statement_timestamp() - interval '30 days';
  v_events jsonb;
begin
  select * into v_actor from private.live_feed_actor_context();

  with sale_events as (
    select
      feed.created_at,
      'sale:' || feed.id::text as event_id,
      jsonb_build_object(
        'event_id', 'sale:' || feed.id::text,
        'event_type', 'sale',
        'created_at', feed.created_at,
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
        'scope', 'organization',
        'is_own', false,
        'can_delete', false,
        'delete_deadline', null
      ) as event
    from public.sales_feed feed
    where feed.organization_id = v_actor.organization_id
      and feed.ranking_eligible_at_event
      and feed.created_at >= v_cutoff
      and feed.created_at < coalesce(p_before, 'infinity'::timestamptz)
  ), comment_events as (
    select
      comment.created_at,
      'comment:' || comment.id::text as event_id,
      jsonb_build_object(
        'event_id', 'comment:' || comment.id::text,
        'event_type', 'comment',
        'comment_id', comment.id,
        'created_at', comment.created_at,
        'actor_user_id', comment.author_user_id,
        'actor_name', comment.author_display_name,
        'actor_role', comment.author_role,
        'message', comment.body,
        'secondary_messages', '[]'::jsonb,
        'related_sale_id', null,
        'scope', comment.scope,
        'is_own', comment.author_user_id = v_actor.auth_user_id,
        'can_delete',
          v_actor.role = 'admin'
          or (
            comment.author_user_id = v_actor.auth_user_id
            and comment.created_at >= v_now - interval '5 minutes'
          ),
        'delete_deadline', comment.created_at + interval '5 minutes'
      ) as event
    from public.live_feed_comments comment
    where comment.organization_id = v_actor.organization_id
      and comment.deleted_at is null
      and comment.created_at >= v_cutoff
      and comment.created_at < coalesce(p_before, 'infinity'::timestamptz)
  ), combined as (
    select * from sale_events
    union all
    select * from comment_events
  ), limited as (
    select * from combined
    order by created_at desc, event_id desc
    limit v_limit
  )
  select coalesce(jsonb_agg(event order by created_at desc, event_id desc), '[]'::jsonb)
  into v_events
  from limited;

  return jsonb_build_object(
    'ok', true,
    'organization_id', v_actor.organization_id,
    'retention_days', 30,
    'limit', v_limit,
    'events', v_events
  );
end;
$$;

revoke all on function public.get_live_feed_v1(integer, timestamptz) from public, anon;
grant execute on function public.get_live_feed_v1(integer, timestamptz) to authenticated;

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

  perform pg_advisory_xact_lock(hashtextextended(p_comment_id::text, 20260903));

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
  )
  on conflict (comment_id) do nothing;

  update public.live_feed_comments
  set body = '[Comment removed]',
      deleted_at = v_now,
      deleted_by_user_id = v_actor.auth_user_id,
      deletion_reason = v_reason
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

create or replace function private.prevent_live_feed_comment_deletion_audit_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  raise exception 'live_feed_comment_deletion_audit_is_immutable' using errcode = '42501';
end;
$$;

revoke all on function private.prevent_live_feed_comment_deletion_audit_change() from public, anon, authenticated;

drop trigger if exists live_feed_comment_deletions_immutable on private.live_feed_comment_deletions;
create trigger live_feed_comment_deletions_immutable
before update or delete on private.live_feed_comment_deletions
for each row execute function private.prevent_live_feed_comment_deletion_audit_change();

comment on function public.post_live_feed_comment_v1(text, uuid) is
  'Posts one standalone organization-scoped Live Feed comment. Identity and organization are derived server-side; customer information and rapid posting are rejected.';
comment on function public.get_live_feed_v1(integer, timestamptz) is
  'Returns up to 100 mixed verified-sale and comment events from the last 30 days for the caller organization.';
comment on function public.delete_live_feed_comment_v1(uuid, text) is
  'Soft-deletes a comment for its author within five minutes or for an Admin at any time. No edit operation exists in version 1.';

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
