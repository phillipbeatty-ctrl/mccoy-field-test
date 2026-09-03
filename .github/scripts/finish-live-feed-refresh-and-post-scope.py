from pathlib import Path

CLIENT = Path('app-live-feed.js')
TEST = Path('live-feed-comments-contract.test.mjs')
DOCS = Path('docs/live-feed-comments-preview.md')


def replace_once(path: Path, old: str, new: str) -> None:
    source = path.read_text(encoding='utf-8')
    count = source.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected one replacement target, found {count}')
    path.write_text(source.replace(old, new, 1), encoding='utf-8')


replace_once(
    CLIENT,
    "    authorizationRefreshing:false,\n    loading:false,",
    "    authorizationRefreshing:false,\n    authorizationReady:false,\n    loading:false,",
)

replace_once(
    CLIENT,
    "        select.value=selectedKey();\n        select.disabled=!state.context||state.loading;",
    "        select.value=selectedKey();\n        select.disabled=!state.context||!state.authorizationReady||state.authorizationRefreshing||state.loading||state.posting;",
)

replace_once(
    CLIENT,
    "      const canPost=!!selected?.can_post;",
    "      const canPost=!!selected?.can_post&&state.authorizationReady&&!state.authorizationRefreshing;",
)

replace_once(
    CLIENT,
    "      if(scopeStatus)scopeStatus.textContent=!state.context?'Resolving server permissions…':canPost?'Posting allowed in this scope.':'Read access only in this scope.';",
    "      if(scopeStatus)scopeStatus.textContent=state.authorizationRefreshing?'Revalidating server permissions…':!state.context?'Resolving server permissions…':canPost?'Posting allowed in this scope.':'Read access only in this scope.';",
)

replace_once(
    CLIENT,
    "  async function loadFeed({scope=state.selectedScope,scopeId=state.selectedScopeId,quiet=false}={}){\n    const generation=state.generation;\n    if(state.loading){state.reloadQueued=true;return;}",
    "  async function loadFeed({scope=state.selectedScope,scopeId=state.selectedScopeId,quiet=false}={}){\n    const generation=state.generation;\n    if(state.loading){state.reloadQueued=true;return false;}",
)

replace_once(
    CLIENT,
    "      if(generation!==state.generation)return;\n      if(!data?.ok)throw new Error(data?.error||'live_feed_load_failed');",
    "      if(generation!==state.generation)return false;\n      if(!data?.ok)throw new Error(data?.error||'live_feed_load_failed');",
)

replace_once(
    CLIENT,
    "      state.events=Array.isArray(data.events)?data.events:[];\n      if(!quiet)setComposerStatus('');\n    }catch(error){",
    "      state.events=Array.isArray(data.events)?data.events:[];\n      if(!quiet)setComposerStatus('');\n      return true;\n    }catch(error){",
)

replace_once(
    CLIENT,
    "      setComposerStatus(message,'error');\n    }finally{",
    "      setComposerStatus(message,'error');\n      return false;\n    }finally{",
)

replace_once(
    CLIENT,
    "  async function changeScope(value){\n    const [scope,id='']=String(value||'').split(':');",
    "  async function changeScope(value){\n    if(state.posting||state.authorizationRefreshing||!state.authorizationReady)return;\n    const [scope,id='']=String(value||'').split(':');",
)

replace_once(
    CLIENT,
    "    state.loading=false;state.reloadQueued=false;state.posting=false;state.events=[];",
    "    state.authorizationReady=false;state.loading=false;state.reloadQueued=false;state.posting=false;state.events=[];",
)

# Replace the permission refresh so protected content and drafts are synchronously hidden before
# the network request, and every scope (including COMPANY) is re-queried after Realtime subscribes.
source = CLIENT.read_text(encoding='utf-8')
start = source.index('  async function refreshAuthorization(){')
end = source.index('\n\n  async function initialize(){', start)
new_refresh = r'''  async function refreshAuthorization(){
    if(!state.initialized||state.initializing||state.authorizationRefreshing)return;
    const identity=identitySnapshot(),access=currentAccess();
    if(!access?.active||!identity.key){resetForIdentity('');return;}
    if(identity.key!==state.identityKey){resetForIdentity(identity.key);initialize();return;}

    const previousOrganizationId=String(state.context?.organization_id||'');
    const previousScope=state.selectedScope,previousScopeId=state.selectedScopeId;
    if(state.authorizationReady)saveDraftState();

    // Hide all previously authorized content before waiting on the new permission snapshot.
    let activeGeneration=invalidateForAuthorizationChange();
    state.authorizationRefreshing=true;state.authorizationReady=false;
    state.context=null;state.scopes=[];state.selectedScope='company';state.selectedScopeId=null;
    state.draft='';state.pendingRequest=null;
    setComposerStatus('Revalidating Live Feed access…');syncComposers();scheduleRender();

    try{
      const data=await invoke('get_live_feed_v2',{p_scope:'company',p_scope_id:null,p_limit:FEED_LIMIT,p_before:null});
      if(activeGeneration!==state.generation)return;
      if(!data?.ok)throw new Error(data?.error||'live_feed_authorization_refresh_failed');

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
      const loaded=await loadFeed({scope:state.selectedScope,scopeId:state.selectedScopeId,quiet:true});
      if(activeGeneration!==state.generation)return;
      if(!loaded)throw new Error('live_feed_authorization_snapshot_failed');
      state.authorizationReady=true;
      setComposerStatus('');syncComposers();scheduleRender();
    }catch(error){
      if(activeGeneration!==state.generation)return;
      const message=String(error?.message||'Unable to revalidate Live Feed access.');
      console.error('Live Feed authorization refresh failed',error);
      if(/authentication_required|auth_email_mismatch|organization_membership_required|active_organization_profile_required|field_coach_access_required|live_feed_role_not_supported/.test(message)){
        resetForIdentity('');
        setComposerStatus('Live Feed access changed. Sign in again or press RECHECK ACCESS.','error');
      }else{
        state.events=[];state.context=null;state.scopes=[];state.draft='';state.pendingRequest=null;scheduleRender();
        setComposerStatus('Unable to refresh Live Feed permissions. Existing content and drafts remain hidden until access can be revalidated.','error');
      }
    }finally{
      if(activeGeneration===state.generation){state.authorizationRefreshing=false;syncComposers();}
    }
  }'''
CLIENT.write_text(source[:start] + new_refresh + source[end:], encoding='utf-8')

# Initial access becomes usable only after the post-subscription snapshot succeeds.
replace_once(
    CLIENT,
    "      await loadFeed({scope:state.selectedScope,scopeId:state.selectedScopeId});\n      if(generation!==state.generation)return;\n      state.initialized=true;",
    "      const loaded=await loadFeed({scope:state.selectedScope,scopeId:state.selectedScopeId});\n      if(generation!==state.generation)return;\n      if(!loaded)throw new Error('live_feed_initial_snapshot_failed');\n      state.authorizationReady=true;state.initialized=true;",
)

replace_once(
    CLIENT,
    "    state.identityKey=nextIdentityKey;state.initialized=false;state.initializing=false;state.authorizationRefreshing=false;state.loading=false;",
    "    state.identityKey=nextIdentityKey;state.initialized=false;state.initializing=false;state.authorizationRefreshing=false;state.authorizationReady=false;state.loading=false;",
)

# Extend source contracts for the exact review findings.
replace_once(
    TEST,
    "  assert.match(client,/function refreshAuthorization/)\n  assert.match(client,/function invalidateForAuthorizationChange/)",
    "  assert.match(client,/function refreshAuthorization/)\n  assert.match(client,/Hide all previously authorized content before waiting on the new permission snapshot/)\n  assert.match(client,/state\\.context=null;state\\.scopes=\\[\\];state\\.selectedScope='company'/)\n  assert.match(client,/state\\.draft='';state\\.pendingRequest=null/)\n  assert.match(client,/const loaded=await loadFeed\\(\\{scope:state\\.selectedScope,scopeId:state\\.selectedScopeId,quiet:true\\}\\)/)\n  assert.match(client,/function invalidateForAuthorizationChange/)",
)

replace_once(
    TEST,
    "  assert.match(client,/scope:'team'/)\n  assert.match(client,/state\\.scopes\\.find\\(item=>item\\.scope==='team'&&item\\.can_post\\)/)",
    "  assert.match(client,/scope:'team'/)\n  assert.match(client,/select\\.disabled=!state\\.context\\|\\|!state\\.authorizationReady\\|\\|state\\.authorizationRefreshing\\|\\|state\\.loading\\|\\|state\\.posting/)\n  assert.match(client,/if\\(state\\.posting\\|\\|state\\.authorizationRefreshing\\|\\|!state\\.authorizationReady\\)return/)\n  assert.match(client,/state\\.scopes\\.find\\(item=>item\\.scope==='team'&&item\\.can_post\\)/)",
)

replace_once(
    DOCS,
    "Returning the app to the foreground also revalidates current team authority. Applying that permission snapshot increments the client generation, discards every older in-flight feed/post/moderation response, restarts Realtime, and changes the draft storage namespace before restoring any draft when the server organization changes.",
    "Returning the app to the foreground also revalidates current team authority. The client synchronously hides the prior feed and draft and disables the composer before awaiting the permission snapshot. Applying the successful snapshot increments the client generation, discards every older in-flight feed/post/moderation response, restarts Realtime, changes the draft storage namespace before restoring any draft when the server organization changes, and then re-queries the selected COMPANY or TEAM feed after subscription so no event can fall between authorization and Realtime.",
)

replace_once(
    DOCS,
    "All authority is enforced by database functions and Row Level Security. The browser receives only the scopes the server says the signed-in user may read or post.",
    "All authority is enforced by database functions and Row Level Security. The browser receives only the scopes the server says the signed-in user may read or post. The scope selector is disabled during posting or permission revalidation, so a pending post cannot clear or enter another scope's draft or feed.",
)

print('Applied synchronous permission hiding, post-bound scope locking, and post-subscription COMPANY refresh.')
