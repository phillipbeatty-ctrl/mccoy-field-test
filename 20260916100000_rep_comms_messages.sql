-- Ephemeral, app-wide rep camaraderie messages -- GroupMe-style free text,
-- broadcast in real time to every active user via a falling/fading overlay
-- (built client-side), plus a browsable "COMMS" page for replying to a
-- message or to a specific live win. Deliberately separate from sales_feed
-- (which Live Wins alone continues to own) per explicit instruction: no
-- user-created message is ever mixed into the Live Wins celebration feed.
--
-- Kept as a real, lightweight table (not a pure ephemeral broadcast-only
-- channel) specifically so the COMMS page has something real to list and
-- reply to; the "not persistent" requirement is about the on-screen falling
-- display, not the underlying record. A 30-day retention window keeps this
-- from growing unbounded while still giving COMMS a meaningful history.
create table public.rep_comms_messages (
  id bigserial primary key,
  organization_id uuid not null,
  sender_user_id uuid not null,
  sender_email text not null,
  sender_name text not null,
  message text not null,
  reply_to_sales_feed_id bigint references public.sales_feed(id) on delete set null,
  reply_to_message_id bigint references public.rep_comms_messages(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint rep_comms_messages_length check (length(trim(message)) between 1 and 240)
);

create index rep_comms_messages_org_recent on public.rep_comms_messages(organization_id, created_at desc);

alter table public.rep_comms_messages enable row level security;

-- Explicit, organization-scoped read policy so realtime delivery is
-- predictable and verifiable, rather than relying on RLS-enabled-with-no-
-- policy behavior for postgres_changes delivery, which is not something I
-- want to depend on without being able to directly verify it here.
create policy rep_comms_messages_org_read on public.rep_comms_messages
  for select
  using (
    organization_id in (
      select a.organization_id from public.app_user_access a
      where lower(trim(a.email)) = lower(coalesce((select auth.jwt())->>'email',''))
        and a.active is true
    )
  );

alter publication supabase_realtime add table public.rep_comms_messages;

-- Sends a new message. Rate-limited server-side (one message per 3 seconds
-- per sender) as a floor beneath the client's own display-layer throttling
-- (max 3 falling at once, "Multiple Messages Incoming" for overflow) --
-- that throttling controls what's shown, not how fast someone can send.
create or replace function public.send_rep_comms_message(
  p_message text,
  p_reply_to_sales_feed_id bigint default null,
  p_reply_to_message_id bigint default null
)
returns public.rep_comms_messages
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text;
  v_access public.app_user_access%rowtype;
  v_clean text;
  v_last_sent timestamptz;
  v_result public.rep_comms_messages%rowtype;
begin
  if v_uid is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  select lower(trim(email)) into v_email from auth.users where id = v_uid;
  select * into v_access from public.app_user_access
    where lower(trim(email)) = v_email and active is true;
  if v_access.organization_id is null then raise exception 'active_mccoy_access_required' using errcode = '42501'; end if;

  v_clean := trim(coalesce(p_message, ''));
  if length(v_clean) < 1 or length(v_clean) > 240 then
    raise exception 'message_length_invalid' using errcode = '22023';
  end if;

  select max(created_at) into v_last_sent
    from public.rep_comms_messages
    where sender_user_id = v_uid and created_at > now() - interval '3 seconds';
  if v_last_sent is not null then
    raise exception 'sending_too_fast' using errcode = '42901';
  end if;

  if p_reply_to_sales_feed_id is not null and not exists(
    select 1 from public.sales_feed where id = p_reply_to_sales_feed_id and organization_id = v_access.organization_id
  ) then
    raise exception 'reply_target_not_found' using errcode = 'P0002';
  end if;
  if p_reply_to_message_id is not null and not exists(
    select 1 from public.rep_comms_messages where id = p_reply_to_message_id and organization_id = v_access.organization_id
  ) then
    raise exception 'reply_target_not_found' using errcode = 'P0002';
  end if;

  insert into public.rep_comms_messages(
    organization_id, sender_user_id, sender_email, sender_name, message,
    reply_to_sales_feed_id, reply_to_message_id
  ) values (
    v_access.organization_id, v_uid, v_email,
    coalesce(nullif(trim(v_access.display_name), ''), 'Rep'), v_clean,
    p_reply_to_sales_feed_id, p_reply_to_message_id
  ) returning * into v_result;

  return v_result;
end;
$$;

revoke all on function public.send_rep_comms_message(text, bigint, bigint) from public, anon;
grant execute on function public.send_rep_comms_message(text, bigint, bigint) to authenticated;

-- Recent messages for the COMMS page, newest first, with enough context
-- about any sales_feed reply target to render "replying to <rep>'s sale" --
-- COMMS needs to show what a reply is actually responding to.
create or replace function public.list_recent_rep_comms_messages(p_limit integer default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text;
  v_org uuid;
  v_limit integer := greatest(1, least(200, coalesce(p_limit, 50)));
  v_result jsonb;
begin
  if v_uid is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  select lower(trim(email)) into v_email from auth.users where id = v_uid;
  select organization_id into v_org from public.app_user_access
    where lower(trim(email)) = v_email and active is true;
  if v_org is null then raise exception 'active_mccoy_access_required' using errcode = '42501'; end if;

  select coalesce(jsonb_agg(row_to_json(m)), '[]'::jsonb) into v_result
  from (
    select
      c.id, c.sender_name, c.message, c.created_at,
      c.reply_to_message_id,
      c.reply_to_sales_feed_id,
      sf.rep_name as reply_to_sale_rep_name,
      sf.isp as reply_to_sale_isp
    from public.rep_comms_messages c
    left join public.sales_feed sf on sf.id = c.reply_to_sales_feed_id
    where c.organization_id = v_org
    order by c.created_at desc
    limit v_limit
  ) m;

  return v_result;
end;
$$;

revoke all on function public.list_recent_rep_comms_messages(integer) from public, anon;
grant execute on function public.list_recent_rep_comms_messages(integer) to authenticated;
