create extension if not exists pgcrypto;

create table if not exists public.native_location_sessions (
  session_id uuid primary key references public.test_sessions(id) on delete cascade,
  user_id uuid not null,
  token_sha256 text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

alter table public.native_location_sessions enable row level security;
revoke all on public.native_location_sessions from public, anon, authenticated;

create or replace function public.register_native_location_token(p_session_id uuid, p_token text)
returns jsonb language plpgsql security definer set search_path='pg_catalog','public' as $function$
declare v_uid uuid:=auth.uid();
begin
  if v_uid is null then raise exception 'authentication_required' using errcode='42501'; end if;
  if p_token is null or length(p_token)<32 then raise exception 'strong_token_required' using errcode='22023'; end if;
  if not exists(select 1 from public.test_sessions where id=p_session_id and tester_user_id=v_uid and ended_at is null) then raise exception 'open_owned_session_required' using errcode='42501'; end if;
  insert into public.native_location_sessions(session_id,user_id,token_sha256,active,created_at,revoked_at)
  values(p_session_id,v_uid,encode(digest(p_token,'sha256'),'hex'),true,clock_timestamp(),null)
  on conflict(session_id) do update set user_id=excluded.user_id,token_sha256=excluded.token_sha256,active=true,created_at=clock_timestamp(),revoked_at=null;
  return jsonb_build_object('ok',true,'session_id',p_session_id);
end;$function$;

create or replace function public.revoke_native_location_token(p_session_id uuid)
returns jsonb language plpgsql security definer set search_path='pg_catalog','public' as $function$
declare v_uid uuid:=auth.uid();
begin
  if v_uid is null then raise exception 'authentication_required' using errcode='42501'; end if;
  update public.native_location_sessions set active=false,revoked_at=clock_timestamp() where session_id=p_session_id and user_id=v_uid;
  return jsonb_build_object('ok',true,'session_id',p_session_id);
end;$function$;

revoke all on function public.register_native_location_token(uuid,text) from public,anon;
grant execute on function public.register_native_location_token(uuid,text) to authenticated;
revoke all on function public.revoke_native_location_token(uuid) from public,anon;
grant execute on function public.revoke_native_location_token(uuid) to authenticated;

create unique index if not exists test_events_native_location_dedupe_idx
on public.test_events(session_id,event_type,event_time)
where event_type='native_background_location';
