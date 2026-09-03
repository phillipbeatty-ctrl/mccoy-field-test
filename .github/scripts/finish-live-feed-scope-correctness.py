from pathlib import Path

CLIENT = Path('app-live-feed.js')
MIGRATION = Path('supabase/preview-migrations/20260903062000_live_feed_company_team_comments_preview.sql')
CANARY = Path('supabase/tests/live-feed-comments-preview-canary.sql')
TEST = Path('live-feed-comments-contract.test.mjs')
DOCS = Path('docs/live-feed-comments-preview.md')


def replace_once(path: Path, old: str, new: str) -> None:
    source = path.read_text(encoding='utf-8')
    count = source.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected one replacement target, found {count}')
    path.write_text(source.replace(old, new, 1), encoding='utf-8')


# Realtime-delivered soft-deletion tombstones remove stale text from already-open clients.
replace_once(
    CLIENT,
    "  function onRealtimeChange(payload){\n    const row=payload?.new||payload?.old||null;if(!row)return;\n    if((payload.eventType==='INSERT'||payload.eventType==='UPDATE')&&row.moderation_status==='approved')queueToast(row);\n    if(rowMatchesSelected(row))loadFeed({quiet:true});\n  }",
    "  function onRealtimeChange(payload){\n    const row=payload?.new||payload?.old||null;if(!row)return;\n    if(row.deleted_at){\n      state.events=state.events.filter(item=>String(item.comment_id||'')!==String(row.id||''));\n      scheduleRender();\n      return;\n    }\n    if((payload.eventType==='INSERT'||payload.eventType==='UPDATE')&&row.moderation_status==='approved')queueToast(row);\n    if(rowMatchesSelected(row))loadFeed({quiet:true});\n  }",
)

# Replace the authorization refresh wholesale so a completed permission check invalidates every
# older feed/post/moderation continuation, restarts Realtime, and changes storage namespaces before
# restoring any draft when the server-selected organization changes.
client_source = CLIENT.read_text(encoding='utf-8')
refresh_start = client_source.index('  async function refreshAuthorization(){')
refresh_end = client_source.index('\n\n  async function initialize(){', refresh_start)
new_refresh = r'''  function invalidateForAuthorizationChange(){
    const client=resolveClient();
    state.generation+=1;
    if(state.channel&&client){try{client.removeChannel(state.channel);}catch(_){/* ignore */}}
    if(state.deleteExpiryTimer)clearTimeout(state.deleteExpiryTimer);
    state.loading=false;state.reloadQueued=false;state.posting=false;state.events=[];
    state.channel=null;state.channelOrganizationId=null;state.realtimeReady=null;state.deleteExpiryTimer=null;
    state.toastQueue=[];state.collapsedToasts=0;toastHost.replaceChildren();
    return state.generation;
  }

  async function refreshAuthorization(){
    if(!state.initialized||state.initializing||state.authorizationRefreshing)return;
    const identity=identitySnapshot(),access=currentAccess();
    if(!access?.active||!identity.key){resetForIdentity('');return;}
    if(identity.key!==state.identityKey){resetForIdentity(identity.key);initialize();return;}
    let activeGeneration=state.generation;
    state.authorizationRefreshing=true;
    try{
      const data=await invoke('get_live_feed_v2',{p_scope:'company',p_scope_id:null,p_limit:FEED_LIMIT,p_before:null});
      if(activeGeneration!==state.generation)return;
      if(!data?.ok)throw new Error(data?.error||'live_feed_authorization_refresh_failed');

      const previousOrganizationId=String(state.context?.organization_id||'');
      const previousScope=state.selectedScope,previousScopeId=state.selectedScopeId;
      saveDraftState();

      // This permission snapshot supersedes every request begun under the earlier team map.
      activeGeneration=invalidateForAuthorizationChange();
      state.authorizationRefreshing=true;
      state.context=null;state.scopes=[];state.selectedScope='company';state.selectedScopeId=null;
      state.draft='';state.pendingRequest=null;
      normalizeContext(data.context||{});

      const nextOrganizationId=String(state.context?.organization_id||'');
      const organizationChanged=!!previousOrganizationId&&previousOrganizationId!==nextOrganizationId;
      const next=(!organizationChanged&&availableScope(previousScope,previousScopeId))||roleDefaultScope()||availableScope('company',null);
      if(!next)throw new Error('No authorized Live Feed scope is available.');

      state.selectedScope=next.scope;state.selectedScopeId=next.scope_id||null;
      writeLocal(selectedScopeKey(),selectedKey());
      loadDraftState();
      syncComposers();scheduleRender();

      await startRealtime();
      if(activeGeneration!==state.generation)return;
      if(state.selectedScope==='company'){
        state.events=Array.isArray(data.events)?data.events:[];
        setComposerStatus('');scheduleRender();
      }else{
        await loadFeed({scope:state.selectedScope,scopeId:state.selectedScopeId,quiet:true});
      }
    }catch(error){
      if(activeGeneration!==state.generation)return;
      const message=String(error?.message||'Unable to revalidate Live Feed access.');
      console.error('Live Feed authorization refresh failed',error);
      if(/authentication_required|auth_email_mismatch|organization_membership_required|active_organization_profile_required|field_coach_access_required|live_feed_role_not_supported/.test(message)){
        resetForIdentity('');
        setComposerStatus('Live Feed access changed. Sign in again or press RECHECK ACCESS.','error');
      }else{
        state.events=[];scheduleRender();
        setComposerStatus('Unable to refresh Live Feed permissions. Existing content was hidden until access can be revalidated.','error');
      }
    }finally{
      if(activeGeneration===state.generation){state.authorizationRefreshing=false;syncComposers();}
    }
  }'''
CLIENT.write_text(client_source[:refresh_start] + new_refresh + client_source[refresh_end:], encoding='utf-8')

# Deleted rows remain RLS-readable only as redacted tombstones so Postgres Changes can deliver the
# UPDATE. The feed RPC still excludes deleted rows, and the client immediately removes the event.
replace_once(
    MIGRATION,
    "begin\n  if p_deleted_at is not null then\n    return false;\n  end if;\n\n  begin\n    select * into v_actor from private.live_feed_actor_context();",
    "begin\n  begin\n    select * into v_actor from private.live_feed_actor_context();",
)
replace_once(
    MIGRATION,
    "  update public.live_feed_comments\n  set deleted_at = v_now\n  where id = v_comment.id;",
    "  update public.live_feed_comments\n  set body = 'Comment removed.',\n      deleted_at = v_now\n  where id = v_comment.id;",
)

# The JWT-email mismatch canary must expect the earlier, stricter current-auth-email failure.
replace_once(
    CANARY,
    "    if sqlerrm <> 'active_organization_profile_required' then raise; end if;",
    "    if sqlerrm <> 'auth_email_mismatch' then raise; end if;",
)

# Verify the redacted tombstone remains selectable under RLS while disappearing from the feed.
canary_marker = """-- Team A2 rep cannot read Team A1; Company remains readable.
select pg_temp.live_feed_login((select rep_a2_auth from live_feed_canary_ids),'live-feed-rep-a2@preview.invalid');
"""
canary_insert = """-- Approved soft deletion is delivered as a redacted RLS-visible tombstone and disappears from snapshots.
select pg_temp.live_feed_login((select admin_a_auth from live_feed_canary_ids),'live-feed-admin-a@preview.invalid');
select public.delete_live_feed_comment_v2((select rep_a1_comment from live_feed_canary_ids),'Preview tombstone verification');
select pg_temp.live_feed_login((select rep_a1_auth from live_feed_canary_ids),'live-feed-rep-a1@preview.invalid');
do $$
begin
  if not exists (
    select 1 from public.live_feed_comments
    where id=(select rep_a1_comment from live_feed_canary_ids)
      and deleted_at is not null
      and body='Comment removed.'
  ) then raise exception 'approved deletion tombstone was not RLS-readable and redacted'; end if;
  if exists (
    select 1 from jsonb_array_elements(public.get_live_feed_v2('team',(select team_a1 from live_feed_canary_ids),100,null)->'events') event
    where event->>'comment_id'=(select rep_a1_comment::text from live_feed_canary_ids)
  ) then raise exception 'soft-deleted comment remained in Team snapshot'; end if;
end;
$$;

""" + canary_marker
replace_once(CANARY, canary_marker, canary_insert)

# Extend source contracts for the exact review findings.
replace_once(
    TEST,
    "  assert.match(client,/function refreshAuthorization/)\n  assert.match(client,/visibilitychange/)",
    "  assert.match(client,/function refreshAuthorization/)\n  assert.match(client,/function invalidateForAuthorizationChange/)\n  assert.match(client,/activeGeneration=invalidateForAuthorizationChange\\(\\)/)\n  assert.match(client,/previousOrganizationId/)\n  assert.match(client,/organizationChanged/)\n  assert.match(client,/visibilitychange/)",
)
replace_once(
    TEST,
    "  assert.match(migration,/private\\.live_feed_comment_deletions/)\n  assert.match(migration,/original_body text not null/)",
    "  assert.match(migration,/private\\.live_feed_comment_deletions/)\n  assert.match(migration,/original_body text not null/)\n  assert.match(migration,/set body = 'Comment removed\\.'/)\n  assert.doesNotMatch(migration,/if p_deleted_at is not null then[\\s\\S]*return false/)\n  assert.match(client,/if\\(row\\.deleted_at\\)[\\s\\S]*state\\.events=state\\.events\\.filter/)",
)
replace_once(
    TEST,
    "  assert.match(canary,/stale JWT retained Live Feed access after auth\\.users email changed/)\n  assert.match(canary,/^rollback;$/m)",
    "  assert.match(canary,/stale JWT retained Live Feed access after auth\\.users email changed/)\n  assert.match(canary,/approved deletion tombstone was not RLS-readable and redacted/)\n  assert.match(canary,/soft-deleted comment remained in Team snapshot/)\n  assert.match(canary,/^rollback;$/m)",
)

replace_once(
    DOCS,
    "Moderation reasons, moderator IDs, deletion reasons, and deleting-user IDs are stored only in private audit tables. They are not columns on the Realtime-readable comment row.",
    "Moderation reasons, moderator IDs, deletion reasons, and deleting-user IDs are stored only in private audit tables. They are not columns on the Realtime-readable comment row. A soft deletion replaces the public body with `Comment removed.` before setting `deleted_at`; the redacted tombstone remains scope-authorized long enough for Postgres Changes to tell already-open clients to remove the event, while feed snapshots continue excluding deleted rows.",
)
replace_once(
    DOCS,
    "Returning the app to the foreground also revalidates current team authority, so reassignment cannot leave an old team selected.",
    "Returning the app to the foreground also revalidates current team authority. Applying that permission snapshot increments the client generation, discards every older in-flight feed/post/moderation response, restarts Realtime, and changes the draft storage namespace before restoring any draft when the server organization changes.",
)

print('Applied final Live Feed authority-refresh, organization-draft, tombstone, and canary fixes.')
