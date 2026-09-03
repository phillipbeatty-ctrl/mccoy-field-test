from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file_path = Path(path)
    source = file_path.read_text(encoding="utf-8")
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one replacement target, found {count}")
    file_path.write_text(source.replace(old, new, 1), encoding="utf-8")


CLIENT = "app-live-feed.js"
MIGRATION = "supabase/preview-migrations/20260903062000_live_feed_company_team_comments_preview.sql"
CANARY = "supabase/tests/live-feed-comments-preview-canary.sql"
TEST = "live-feed-comments-contract.test.mjs"
DOCS = "docs/live-feed-comments-preview.md"

replace_once(
    CLIENT,
    "  };\n\n  const style=document.createElement('style');",
    "  };\n  let authTransitionSubscription=null;\n\n  const style=document.createElement('style');",
)

identity_block = """  function identitySnapshot(){
    const access=currentAccess(),user=currentUser();
    const userId=String(user?.id||access?.auth_user_id||'').trim();
    const email=String(user?.email||access?.email||'').trim().toLowerCase();
    const organizationId=String(access?.organization_id||'').trim();
    const role=normalizedRole(access?.role);
    const active=access?.active===true?'1':'0';
    return {userId,email,organizationId,role,active,key:userId||email?`${userId}|${email}|${organizationId}|${role}|${active}`:''};
  }

"""
transition_guard = identity_block + """  function installAuthTransitionGuard(){
    const client=resolveClient();
    if(authTransitionSubscription||!client?.auth?.onAuthStateChange)return;
    const {data}=client.auth.onAuthStateChange((_event,session)=>{
      const nextUserId=String(session?.user?.id||'').trim();
      const nextEmail=String(session?.user?.email||'').trim().toLowerCase();
      const nextPrefix=nextUserId&&nextEmail?`${nextUserId}|${nextEmail}|`:'';
      if(!nextPrefix){
        if(state.identityKey||state.context||state.events.length)resetForIdentity('');
        return;
      }
      if(state.identityKey&&!state.identityKey.startsWith(nextPrefix))resetForIdentity('');
    });
    authTransitionSubscription=data?.subscription||null;
  }

"""
replace_once(CLIENT, identity_block, transition_guard)

replace_once(
    CLIENT,
    "  window.addEventListener('beforeunload',()=>{if(state.channel&&resolveClient())resolveClient().removeChannel(state.channel);});\n\n  const poll=setInterval(()=>{findMounts();if(currentAccess()?.active&&resolveClient()){clearInterval(poll);initialize();}},300);",
    "  window.addEventListener('beforeunload',()=>{if(state.channel&&resolveClient())resolveClient().removeChannel(state.channel);if(authTransitionSubscription)authTransitionSubscription.unsubscribe();});\n\n  const poll=setInterval(()=>{findMounts();if(resolveClient())installAuthTransitionGuard();if(currentAccess()?.active&&resolveClient()){clearInterval(poll);initialize();}},300);",
)

actor_marker = """create or replace function private.live_feed_actor_context()
returns table (
"""
role_function = """create or replace function private.live_feed_normalized_role(p_role text)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select case
    when lower(btrim(coalesce(p_role, ''))) = 'tester' then 'rep'
    else lower(btrim(coalesce(p_role, '')))
  end
$$;

revoke all on function private.live_feed_normalized_role(text) from public, anon, authenticated;

""" + actor_marker
replace_once(MIGRATION, actor_marker, role_function)

replace_once(
    MIGRATION,
    "    lower(btrim(access.role)),",
    "    private.live_feed_normalized_role(access.role),",
)
replace_once(
    MIGRATION,
    "    and lower(membership.role) = lower(access.role)\n    and lower(profile.role) = lower(access.role)",
    "    and private.live_feed_normalized_role(membership.role) = private.live_feed_normalized_role(access.role)\n    and private.live_feed_normalized_role(profile.role) = private.live_feed_normalized_role(access.role)",
)

replace_once(
    CANARY,
    "union all select 'live-feed-rep-b@preview.invalid','rep',true,'Preview Rep B',organization_b from live_feed_canary_ids",
    "union all select 'live-feed-rep-b@preview.invalid','tester',true,'Preview Tester B',organization_b from live_feed_canary_ids",
)
replace_once(
    CANARY,
    "union all select organization_b,rep_b_auth,'live-feed-rep-b@preview.invalid','rep',true,true from live_feed_canary_ids",
    "union all select organization_b,rep_b_auth,'live-feed-rep-b@preview.invalid','tester',true,true from live_feed_canary_ids",
)
replace_once(
    CANARY,
    "-- Cross-organization users receive neither Company nor Team A data.\nselect pg_temp.live_feed_login((select rep_b_auth from live_feed_canary_ids),'live-feed-rep-b@preview.invalid');\ndo $$\ndeclare feed jsonb;\nbegin\n  feed:=public.get_live_feed_v2('company',null,100,null);",
    "-- Tester access is normalized to Rep authority and remains cross-organization isolated.\nselect pg_temp.live_feed_login((select rep_b_auth from live_feed_canary_ids),'live-feed-rep-b@preview.invalid');\ndo $$\ndeclare feed jsonb;\nbegin\n  feed:=public.get_live_feed_v2('company',null,100,null);\n  if feed->'context'->>'role' <> 'rep' then\n    raise exception 'tester role was not normalized to Rep Live Feed authority';\n  end if;",
)

replace_once(
    TEST,
    "  assert.match(migration,/lower\\(membership\\.role\\) = lower\\(access\\.role\\)/)",
    "  assert.match(migration,/private\\.live_feed_normalized_role/);\n  assert.match(migration,/when lower\\(btrim\\(coalesce\\(p_role, ''\\)\\)\\) = 'tester' then 'rep'/);\n  assert.match(migration,/live_feed_normalized_role\\(membership\\.role\\) = private\\.live_feed_normalized_role\\(access\\.role\\)/)",
)
replace_once(
    TEST,
    "  assert.match(client,/mccoy-account-switch-start/)\n  assert.match(client,/mccoy-logout/)",
    "  assert.match(client,/mccoy-account-switch-start/)\n  assert.match(client,/mccoy-logout/)\n  assert.match(client,/auth\\.onAuthStateChange/)\n  assert.match(client,/state\\.identityKey&&!state\\.identityKey\\.startsWith\\(nextPrefix\\)/)",
)
replace_once(
    TEST,
    "  assert.match(canary,/organization A data leaked to organization B/)",
    "  assert.match(canary,/tester role was not normalized to Rep Live Feed authority/)\n  assert.match(canary,/organization A data leaked to organization B/)",
)

replace_once(
    DOCS,
    "| Rep | Yes | No | Active primary team only | Active primary team only | No |",
    "| Rep / Tester | Yes | No | Active primary team only | Active primary team only | No |",
)
replace_once(
    DOCS,
    "When the authenticated user, organization, role, or active-access signature changes without a page reload, the client increments an identity generation, removes the old channel, and clears the previous state before initializing again.",
    "The client also listens directly to Supabase `onAuthStateChange`, so a different account or sign-out clears the former feed synchronously before asynchronous onboarding and organization routing finish. When the authenticated user, organization, role, or active-access signature changes without a page reload, the client increments an identity generation, removes the old channel, and clears the previous state before initializing again.",
)
replace_once(
    DOCS,
    "- Rep can post only the assigned TEAM.",
    "- Rep can post only the assigned TEAM. A legacy `tester` access role is normalized to Rep authority while the profile remains `rep`.",
)

print("Applied direct auth-transition clearing and tester-to-Rep authority normalization.")
