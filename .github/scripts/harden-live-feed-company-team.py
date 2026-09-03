from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file_path = Path(path)
    source = file_path.read_text(encoding="utf-8")
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one replacement target, found {count}")
    file_path.write_text(source.replace(old, new, 1), encoding="utf-8")


CLIENT = "app-live-feed.js"
MIGRATION = "supabase/migrations/20260903062000_live_feed_comments_vertical_slice.sql"
CANARY = "supabase/tests/live-feed-comments-preview-canary.sql"
TEST = "live-feed-comments-contract.test.mjs"
DOCS = "docs/live-feed-comments-preview.md"

replace_once(
    CLIENT,
    "    identityKey:null,\n    initialized:false,\n    initializing:false,\n    loading:false,",
    "    identityKey:null,\n    generation:0,\n    initialized:false,\n    initializing:false,\n    authorizationRefreshing:false,\n    loading:false,",
)

replace_once(
    CLIENT,
    "  function identitySnapshot(){\n    const access=currentAccess(),user=currentUser();\n    const userId=String(user?.id||access?.auth_user_id||'').trim();\n    const email=String(user?.email||access?.email||'').trim().toLowerCase();\n    return {userId,email,key:userId||email?`${userId}|${email}`:''};\n  }\n\n  function selectedKey(scope=state.selectedScope,scopeId=state.selectedScopeId){return `${scope}:${scopeId||'company'}`;}",
    "  function identitySnapshot(){\n    const access=currentAccess(),user=currentUser();\n    const userId=String(user?.id||access?.auth_user_id||'').trim();\n    const email=String(user?.email||access?.email||'').trim().toLowerCase();\n    const organizationId=String(access?.organization_id||'').trim();\n    const role=normalizedRole(access?.role);\n    const active=access?.active===true?'1':'0';\n    return {userId,email,organizationId,role,active,key:userId||email?`${userId}|${email}|${organizationId}|${role}|${active}`:''};\n  }\n\n  // Empty scope IDs round-trip COMPANY as `company:`; the word `company` is never treated as a UUID.\n  function selectedKey(scope=state.selectedScope,scopeId=state.selectedScopeId){return `${scope}:${scopeId||''}`;}",
)

replace_once(
    CLIENT,
    "  async function loadFeed({scope=state.selectedScope,scopeId=state.selectedScopeId,quiet=false}={}){\n    if(state.loading){state.reloadQueued=true;return;}",
    "  async function loadFeed({scope=state.selectedScope,scopeId=state.selectedScopeId,quiet=false}={}){\n    const generation=state.generation;\n    if(state.loading){state.reloadQueued=true;return;}",
)

replace_once(
    CLIENT,
    "      const data=await invoke('get_live_feed_v2',{p_scope:scope,p_scope_id:scopeId||null,p_limit:FEED_LIMIT,p_before:null});\n      if(!data?.ok)throw new Error(data?.error||'live_feed_load_failed');",
    "      const data=await invoke('get_live_feed_v2',{p_scope:scope,p_scope_id:scopeId||null,p_limit:FEED_LIMIT,p_before:null});\n      if(generation!==state.generation)return;\n      if(!data?.ok)throw new Error(data?.error||'live_feed_load_failed');",
)

replace_once(
    CLIENT,
    "    }catch(error){\n      console.error('Live Feed load failed',error);\n      setComposerStatus(error?.message||'Unable to load Live Feed.','error');\n    }finally{\n      state.loading=false;syncComposers();scheduleRender();\n      if(state.reloadQueued){state.reloadQueued=false;setTimeout(()=>loadFeed({quiet:true}),0);}\n    }\n  }",
    "    }catch(error){\n      if(generation!==state.generation)return;\n      console.error('Live Feed load failed',error);\n      const message=String(error?.message||'Unable to load Live Feed.');\n      if(/team_scope_forbidden|auth_email_mismatch|organization_membership_required|active_organization_profile_required|field_coach_access_required|live_feed_role_not_supported/.test(message)){\n        state.events=[];scheduleRender();\n        if(message.includes('team_scope_forbidden'))setTimeout(refreshAuthorization,0);\n      }\n      setComposerStatus(message,'error');\n    }finally{\n      if(generation!==state.generation)return;\n      state.loading=false;syncComposers();scheduleRender();\n      if(state.reloadQueued){state.reloadQueued=false;setTimeout(()=>loadFeed({quiet:true}),0);}\n    }\n  }",
)

replace_once(
    CLIENT,
    "  async function postComment(){\n    const selected=selectedScope(),body=bodyText(state.draft);",
    "  async function postComment(){\n    const generation=state.generation;\n    const selected=selectedScope(),body=bodyText(state.draft);",
)

replace_once(
    CLIENT,
    "      const data=await invoke('post_live_feed_comment_v2',{p_scope:selected.scope,p_scope_id:selected.scope_id||null,p_body:body,p_client_request_id:requestId});\n      if(!data?.ok)throw new Error(data?.error||'comment_post_failed');",
    "      const data=await invoke('post_live_feed_comment_v2',{p_scope:selected.scope,p_scope_id:selected.scope_id||null,p_body:body,p_client_request_id:requestId});\n      if(generation!==state.generation)return;\n      if(!data?.ok)throw new Error(data?.error||'comment_post_failed');",
)

replace_once(
    CLIENT,
    "    }catch(error){\n      console.error('Live Feed comment failed',error);\n      setComposerStatus(error?.message||'Unable to post. Your draft and request ID were preserved; press RETRY.','error');\n    }finally{state.posting=false;syncComposers();}\n  }",
    "    }catch(error){\n      if(generation!==state.generation)return;\n      console.error('Live Feed comment failed',error);\n      setComposerStatus(error?.message||'Unable to post. Your draft and request ID were preserved; press RETRY.','error');\n    }finally{if(generation===state.generation){state.posting=false;syncComposers();}}\n  }",
)

replace_once(
    CLIENT,
    "  async function moderateComment(button){\n    if(button.dataset.busy==='1'||!isAdmin())return;",
    "  async function moderateComment(button){\n    const generation=state.generation;\n    if(button.dataset.busy==='1'||!isAdmin())return;",
)

replace_once(
    CLIENT,
    "      const data=await invoke('moderate_live_feed_comment_v2',{p_comment_id:commentId,p_decision:decision,p_reason:reason.trim(),p_certify_no_customer_data:decision==='approve'});\n      if(!data?.ok)throw new Error(data?.error||'comment_moderation_failed');",
    "      const data=await invoke('moderate_live_feed_comment_v2',{p_comment_id:commentId,p_decision:decision,p_reason:reason.trim(),p_certify_no_customer_data:decision==='approve'});\n      if(generation!==state.generation)return;\n      if(!data?.ok)throw new Error(data?.error||'comment_moderation_failed');",
)

replace_once(
    CLIENT,
    "    }catch(error){console.error('Live Feed moderation failed',error);setComposerStatus(error?.message||'Unable to moderate this comment.','error');}\n    finally{delete button.dataset.busy;button.disabled=false;button.textContent=decision==='approve'?'APPROVE':'REJECT';}\n  }",
    "    }catch(error){if(generation===state.generation){console.error('Live Feed moderation failed',error);setComposerStatus(error?.message||'Unable to moderate this comment.','error');}}\n    finally{if(generation===state.generation){delete button.dataset.busy;button.disabled=false;button.textContent=decision==='approve'?'APPROVE':'REJECT';}}\n  }",
)

replace_once(
    CLIENT,
    "  async function deleteComment(button){\n    if(button.dataset.busy==='1')return;",
    "  async function deleteComment(button){\n    const generation=state.generation;\n    if(button.dataset.busy==='1')return;",
)

replace_once(
    CLIENT,
    "      const data=await invoke('delete_live_feed_comment_v2',{p_comment_id:commentId,p_reason:reason?.trim()||null});\n      if(!data?.ok)throw new Error(data?.error||'comment_delete_failed');",
    "      const data=await invoke('delete_live_feed_comment_v2',{p_comment_id:commentId,p_reason:reason?.trim()||null});\n      if(generation!==state.generation)return;\n      if(!data?.ok)throw new Error(data?.error||'comment_delete_failed');",
)

replace_once(
    CLIENT,
    "    }catch(error){console.error('Live Feed deletion failed',error);setComposerStatus(error?.message||'Unable to remove this comment.','error');}\n    finally{delete button.dataset.busy;button.disabled=false;button.textContent=event?.is_own?'Remove comment':'Remove as Admin';}\n  }",
    "    }catch(error){if(generation===state.generation){console.error('Live Feed deletion failed',error);setComposerStatus(error?.message||'Unable to remove this comment.','error');}}\n    finally{if(generation===state.generation){delete button.dataset.busy;button.disabled=false;button.textContent=event?.is_own?'Remove comment':'Remove as Admin';}}\n  }",
)

replace_once(
    CLIENT,
    "  function startRealtime(){\n    const client=resolveClient(),organizationId=String(state.context?.organization_id||'');",
    "  function startRealtime(){\n    const generation=state.generation;\n    const client=resolveClient(),organizationId=String(state.context?.organization_id||'');",
)

replace_once(
    CLIENT,
    "      state.channel=client.channel(`mccoy-live-feed-v2:${organizationId}:${state.context?.user_id||'user'}`)\n        .on('postgres_changes',{event:'*',schema:'public',table:'live_feed_comments',filter:`organization_id=eq.${organizationId}`},onRealtimeChange)\n        .subscribe(status=>{if(status==='SUBSCRIBED')finish(true);else if(['CHANNEL_ERROR','TIMED_OUT','CLOSED'].includes(status))finish(false);});",
    "      state.channel=client.channel(`mccoy-live-feed-v2:${organizationId}:${state.context?.user_id||'user'}`)\n        .on('postgres_changes',{event:'*',schema:'public',table:'live_feed_comments',filter:`organization_id=eq.${organizationId}`},payload=>{if(generation===state.generation)onRealtimeChange(payload);})\n        .subscribe(status=>{if(generation!==state.generation){finish(false);return;}if(status==='SUBSCRIBED')finish(true);else if(['CHANNEL_ERROR','TIMED_OUT','CLOSED'].includes(status))finish(false);});",
)

replace_once(
    CLIENT,
    "  function resetForIdentity(nextIdentityKey=''){\n    saveDraftState();",
    "  function resetForIdentity(nextIdentityKey=''){\n    saveDraftState();\n    state.generation+=1;",
)

replace_once(
    CLIENT,
    "    state.identityKey=nextIdentityKey;state.initialized=false;state.initializing=false;state.loading=false;state.reloadQueued=false;state.posting=false;state.events=[];state.context=null;state.scopes=[];",
    "    state.identityKey=nextIdentityKey;state.initialized=false;state.initializing=false;state.authorizationRefreshing=false;state.loading=false;state.reloadQueued=false;state.posting=false;state.events=[];state.context=null;state.scopes=[];",
)

refresh_function = """  async function refreshAuthorization(){
    if(!state.initialized||state.initializing||state.authorizationRefreshing)return;
    const identity=identitySnapshot(),access=currentAccess();
    if(!access?.active||!identity.key){resetForIdentity('');return;}
    if(identity.key!==state.identityKey){resetForIdentity(identity.key);initialize();return;}
    const generation=state.generation;
    state.authorizationRefreshing=true;
    try{
      const data=await invoke('get_live_feed_v2',{p_scope:'company',p_scope_id:null,p_limit:FEED_LIMIT,p_before:null});
      if(generation!==state.generation)return;
      if(!data?.ok)throw new Error(data?.error||'live_feed_authorization_refresh_failed');
      const previousScope=state.selectedScope,previousScopeId=state.selectedScopeId;
      saveDraftState();
      normalizeContext(data.context||{});
      const next=availableScope(previousScope,previousScopeId)||roleDefaultScope()||availableScope('company',null);
      if(!next)throw new Error('No authorized Live Feed scope is available.');
      const scopeChanged=next.scope!==previousScope||String(next.scope_id||'')!==String(previousScopeId||'');
      state.selectedScope=next.scope;state.selectedScopeId=next.scope_id||null;writeLocal(selectedScopeKey(),selectedKey());
      if(scopeChanged){state.draft='';state.pendingRequest=null;state.events=[];loadDraftState();}
      await startRealtime();
      if(generation!==state.generation)return;
      if(state.selectedScope==='company'){
        state.events=Array.isArray(data.events)?data.events:[];scheduleRender();
      }else{
        await loadFeed({scope:state.selectedScope,scopeId:state.selectedScopeId,quiet:true});
      }
    }catch(error){
      if(generation!==state.generation)return;
      const message=String(error?.message||'Unable to revalidate Live Feed access.');
      console.error('Live Feed authorization refresh failed',error);
      if(/authentication_required|auth_email_mismatch|organization_membership_required|active_organization_profile_required|field_coach_access_required|live_feed_role_not_supported/.test(message)){
        saveDraftState();state.events=[];state.context=null;state.scopes=[];state.draft='';state.pendingRequest=null;scheduleRender();
        setComposerStatus('Live Feed access changed. Sign in again or press RECHECK ACCESS.','error');
      }else setComposerStatus('Unable to refresh Live Feed permissions. Existing content was not expanded.','error');
    }finally{
      if(generation===state.generation){state.authorizationRefreshing=false;syncComposers();}
    }
  }

"""
replace_once(CLIENT, "  async function initialize(){\n", refresh_function + "  async function initialize(){\n")

replace_once(
    CLIENT,
    "    state.identityKey=identity.key;state.initializing=true;findMounts();syncComposers();\n    try{",
    "    state.identityKey=identity.key;state.initializing=true;const generation=state.generation;findMounts();syncComposers();\n    try{",
)

replace_once(
    CLIENT,
    "      const bootstrap=await invoke('get_live_feed_v2',{p_scope:'company',p_scope_id:null,p_limit:FEED_LIMIT,p_before:null});\n      if(!bootstrap?.ok)throw new Error(bootstrap?.error||'live_feed_bootstrap_failed');",
    "      const bootstrap=await invoke('get_live_feed_v2',{p_scope:'company',p_scope_id:null,p_limit:FEED_LIMIT,p_before:null});\n      if(generation!==state.generation)return;\n      if(!bootstrap?.ok)throw new Error(bootstrap?.error||'live_feed_bootstrap_failed');",
)

replace_once(
    CLIENT,
    "      await startRealtime();\n      await loadFeed({scope:state.selectedScope,scopeId:state.selectedScopeId});\n      state.initialized=true;\n    }catch(error){console.error('Live Feed initialization failed',error);setComposerStatus(error?.message||'Unable to initialize Live Feed.','error');}\n    finally{state.initializing=false;syncComposers();}\n  }",
    "      await startRealtime();\n      if(generation!==state.generation)return;\n      await loadFeed({scope:state.selectedScope,scopeId:state.selectedScopeId});\n      if(generation!==state.generation)return;\n      state.initialized=true;\n    }catch(error){if(generation===state.generation){console.error('Live Feed initialization failed',error);setComposerStatus(error?.message||'Unable to initialize Live Feed.','error');}}\n    finally{if(generation===state.generation){state.initializing=false;syncComposers();}}\n  }",
)

replace_once(
    CLIENT,
    "  window.addEventListener('mccoy-access-ready',()=>{\n    const identity=identitySnapshot();\n    if(state.identityKey&&identity.key&&state.identityKey!==identity.key)resetForIdentity(identity.key);\n    initialize();\n  });\n  window.addEventListener('mccoy-account-switch-start',()=>resetForIdentity(''));",
    "  window.addEventListener('mccoy-access-ready',()=>{\n    const identity=identitySnapshot();\n    if(!currentAccess()?.active){resetForIdentity('');return;}\n    if(state.identityKey&&identity.key&&state.identityKey!==identity.key){resetForIdentity(identity.key);initialize();return;}\n    if(state.initialized){refreshAuthorization();return;}\n    initialize();\n  });\n  window.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&state.initialized)refreshAuthorization();});\n  window.addEventListener('focus',()=>{if(state.initialized)refreshAuthorization();});\n  window.addEventListener('mccoy-account-switch-start',()=>resetForIdentity(''));",
)

replace_once(
    MIGRATION,
    "    check (char_length(btrim(body)) between 1 and 280),",
    "    check (char_length(btrim(body, E' \\t\\r\\n')) between 1 and 280),",
)

replace_once(
    MIGRATION,
    "  v_user_id uuid := auth.uid();\n  v_organization_id uuid;\n  v_email text := lower(btrim(coalesce(auth.jwt()->>'email', '')));",
    "  v_user_id uuid := auth.uid();\n  v_organization_id uuid;\n  v_jwt_email text := lower(btrim(coalesce(auth.jwt()->>'email', '')));\n  v_email text;",
)

replace_once(
    MIGRATION,
    "begin\n  if v_user_id is null or v_email = '' then\n    raise exception 'authentication_required' using errcode = '42501';\n  end if;\n\n  v_organization_id := private.current_organization_id();",
    "begin\n  if v_user_id is null or v_jwt_email = '' then\n    raise exception 'authentication_required' using errcode = '42501';\n  end if;\n\n  select lower(btrim(auth_user.email))\n  into v_email\n  from auth.users auth_user\n  where auth_user.id = v_user_id\n    and auth_user.deleted_at is null;\n\n  if v_email is null or v_email = '' or v_email <> v_jwt_email then\n    raise exception 'auth_email_mismatch' using errcode = '42501';\n  end if;\n\n  v_organization_id := private.current_organization_id();",
)

replace_once(
    MIGRATION,
    "  v_body := replace(replace(btrim(coalesce(p_body, '')), E'\\r\\n', E'\\n'), E'\\r', E'\\n');",
    "  v_body := replace(replace(btrim(coalesce(p_body, ''), E' \\t\\r\\n'), E'\\r\\n', E'\\n'), E'\\r', E'\\n');",
)

replace_once(
    CANARY,
    "-- Public Realtime rows contain no moderation/deletion reasons or moderator identities.\ndo $$",
    "-- A stale JWT cannot retain access after auth.users email changes.\nupdate auth.users\nset email='live-feed-rep-a1-current@preview.invalid',updated_at=now()\nwhere id=(select rep_a1_auth from live_feed_canary_ids);\nselect pg_temp.live_feed_login((select rep_a1_auth from live_feed_canary_ids),'live-feed-rep-a1@preview.invalid');\ndo $$\nbegin\n  begin\n    perform public.get_live_feed_v2('company',null,100,null);\n    raise exception 'stale JWT retained Live Feed access after auth.users email changed';\n  exception when sqlstate '42501' then\n    if sqlerrm <> 'auth_email_mismatch' then raise; end if;\n  end;\nend;\n$$;\n\n-- Public Realtime rows contain no moderation/deletion reasons or moderator identities.\ndo $$",
)

replace_once(
    TEST,
    "  assert.match(migration,/lower\\(access\\.email\\) = v_email/)\n  assert.match(migration,/lower\\(membership\\.email\\) = v_email/)",
    "  assert.match(migration,/from auth\\.users auth_user/)\n  assert.match(migration,/v_email <> v_jwt_email[\\s\\S]*auth_email_mismatch/)\n  assert.match(migration,/lower\\(access\\.email\\) = v_email/)\n  assert.match(migration,/lower\\(membership\\.email\\) = v_email/)",
)

replace_once(
    TEST,
    "test('client exposes COMPANY and TEAM choices without using browser-only authorization',()=>{\n  assert.match(client,/Choose Company or Team Live Feed/)",
    "test('client exposes COMPANY and TEAM choices without using browser-only authorization',()=>{\n  assert.match(client,/Choose Company or Team Live Feed/)\n  assert.match(client,/function selectedKey[\\s\\S]*scopeId\\|\\|''/)\n  assert.doesNotMatch(client,/scopeId\\|\\|'company'/)",
)

replace_once(
    TEST,
    "  assert.match(client,/function resetForIdentity/)\n  assert.match(client,/state\\.identityKey&&identity\\.key&&state\\.identityKey!==identity\\.key/)\n  assert.match(client,/await startRealtime\\(\\);[\\s\\S]*await loadFeed/)",
    "  assert.match(client,/function resetForIdentity/)\n  assert.match(client,/state\\.generation\\+=1/)\n  assert.match(client,/generation!==state\\.generation/)\n  assert.match(client,/organizationId=String\\(access\\?\\.organization_id/)\n  assert.match(client,/`\\$\\{userId\\}\\|\\$\\{email\\}\\|\\$\\{organizationId\\}\\|\\$\\{role\\}\\|\\$\\{active\\}`/)\n  assert.match(client,/function refreshAuthorization/)\n  assert.match(client,/visibilitychange/)\n  assert.match(client,/state\\.identityKey&&identity\\.key&&state\\.identityKey!==identity\\.key/)\n  assert.match(client,/await startRealtime\\(\\);[\\s\\S]*await loadFeed/)",
)

replace_once(
    TEST,
    "  assert.match(canary,/mismatched login email retained Live Feed access/)\n  assert.match(canary,/^rollback;$/m)",
    "  assert.match(canary,/mismatched login email retained Live Feed access/)\n  assert.match(canary,/stale JWT retained Live Feed access after auth\\.users email changed/)\n  assert.match(canary,/^rollback;$/m)",
)

replace_once(
    DOCS,
    "The login email must match the active `organization_memberships`, `app_user_access`, and user-profile identity. A changed or mismatched login fails closed.",
    "The current `auth.users.email`, JWT email, active `organization_memberships`, `app_user_access`, and user-profile identity must all match. An email change invalidates a stale token immediately rather than waiting for token expiry.",
)

replace_once(
    DOCS,
    "When the authenticated user changes without a page reload, the client removes the old channel and clears the previous user's events, organization, role, scopes, draft pointer, moderation controls, and notification queue before initializing the new account.",
    "When the authenticated user, organization, role, or active-access signature changes without a page reload, the client increments an identity generation, removes the old channel, and clears the previous state before initializing again. Every asynchronous response and Realtime callback carries that generation and is discarded after a reset. Returning the app to the foreground also revalidates current team authority, so reassignment cannot leave an old team selected."
)

print("Applied Live Feed COMPANY/TEAM security and scope round-trip hardening.")
