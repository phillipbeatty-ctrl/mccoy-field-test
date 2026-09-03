from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)

client_path = Path("app-live-feed.js")
client = client_path.read_text(encoding="utf-8")

client = replace_once(
    client,
    "    channel:null,\n    channelOrganizationId:null,\n",
    "    channel:null,\n    channelOrganizationId:null,\n    realtimeReady:null,\n    deleteExpiryTimer:null,\n",
    "state timers",
)

client = replace_once(
    client,
    "    if(state.pendingRequest&&state.pendingRequest.body!==state.draft){state.pendingRequest=null;writeLocal(pendingKey(),'');}\n",
    "    if(state.pendingRequest&&state.pendingRequest.body!==bodyText(state.draft)){state.pendingRequest=null;writeLocal(pendingKey(),'');}\n",
    "normalized restored draft",
)

client = replace_once(
    client,
    "  function handleDraftInput(input){\n    state.draft=input.value;\n    if(state.pendingRequest&&state.pendingRequest.body!==state.draft){state.pendingRequest=null;savePending();}\n",
    "  function handleDraftInput(input){\n    const characters=Array.from(input.value);\n    if(characters.length>MAX_COMMENT_LENGTH)input.value=characters.slice(0,MAX_COMMENT_LENGTH).join('');\n    state.draft=input.value;\n    if(state.pendingRequest&&state.pendingRequest.body!==bodyText(state.draft)){state.pendingRequest=null;savePending();}\n",
    "code-point draft clamp",
)

client = replace_once(
    client,
    ";input.maxLength=MAX_COMMENT_LENGTH;input.rows=2;",
    ";input.rows=2;",
    "remove UTF-16 maxlength",
)

client = replace_once(
    client,
    "    if(type==='comment'&&event.can_delete){\n",
    "    const deleteDeadline=parseTime(event?.delete_deadline);\n    const deleteAllowed=type==='comment'&&event.can_delete&&(isAdmin()||(event.is_own&&deleteDeadline>Date.now()));\n    if(deleteAllowed){\n",
    "dynamic delete permission",
)

client = replace_once(
    client,
    "    syncComposers();\n  }\n  function scheduleRender(){\n",
    "    if(state.deleteExpiryTimer){clearTimeout(state.deleteExpiryTimer);state.deleteExpiryTimer=null;}\n    if(!isAdmin()){\n      const deadlines=state.events\n        .filter(event=>event?.event_type==='comment'&&event.is_own&&event.can_delete)\n        .map(event=>parseTime(event.delete_deadline))\n        .filter(deadline=>deadline>Date.now());\n      if(deadlines.length){\n        const nextDeadline=Math.min(...deadlines);\n        state.deleteExpiryTimer=setTimeout(()=>scheduleRender(),Math.max(25,nextDeadline-Date.now()+25));\n      }\n    }\n    syncComposers();\n  }\n  function scheduleRender(){\n",
    "delete expiry rerender",
)

client = replace_once(
    client,
    "  async function deleteComment(commentId,event){\n    if(!commentId)return;\n    const client=resolveClient();if(!client)return;\n",
    "  async function deleteComment(commentId,event){\n    if(!commentId)return;\n    if(event?.is_own&&!isAdmin()&&parseTime(event.delete_deadline)<=Date.now()){\n      setComposerStatus('The five-minute window to remove this comment has expired.','error');\n      scheduleRender();\n      return;\n    }\n    const client=resolveClient();if(!client)return;\n",
    "delete click expiry guard",
)

old_realtime = """  async function startRealtime(){
    const client=resolveClient(),organizationId=state.organizationId||currentAccess()?.organization_id||null;
    if(!client?.channel||!organizationId)return;
    if(state.channel&&state.channelOrganizationId===organizationId)return;
    if(state.channel){try{await client.removeChannel(state.channel);}catch(_){}state.channel=null;}
    state.channelOrganizationId=organizationId;
    state.channel=client.channel(`mccoy-live-feed-comments-${organizationId}`)
      .on('postgres_changes',{event:'*',schema:'public',table:'live_feed_comments',filter:`organization_id=eq.${organizationId}`},onCommentRealtime)
      .subscribe(status=>window.dispatchEvent(new CustomEvent('mccoy-live-feed-status',{detail:{status}})));
  }
"""
new_realtime = """  async function startRealtime(){
    const client=resolveClient(),organizationId=state.organizationId||currentAccess()?.organization_id||null;
    if(!client?.channel||!organizationId)return null;
    if(state.channel&&state.channelOrganizationId===organizationId)return state.realtimeReady;
    if(state.channel){try{await client.removeChannel(state.channel);}catch(_){}state.channel=null;state.realtimeReady=null;}
    state.channelOrganizationId=organizationId;
    state.realtimeReady=new Promise(resolve=>{
      let settled=false;
      const settle=status=>{if(settled)return;settled=true;resolve(status);};
      state.channel=client.channel(`mccoy-live-feed-comments-${organizationId}`)
        .on('postgres_changes',{event:'*',schema:'public',table:'live_feed_comments',filter:`organization_id=eq.${organizationId}`},onCommentRealtime)
        .subscribe(status=>{
          window.dispatchEvent(new CustomEvent('mccoy-live-feed-status',{detail:{status}}));
          if(['SUBSCRIBED','CHANNEL_ERROR','TIMED_OUT','CLOSED'].includes(status))settle(status);
        });
      setTimeout(()=>settle('SUBSCRIBE_WAIT_EXPIRED'),2500);
    });
    return state.realtimeReady;
  }
"""
client = replace_once(client, old_realtime, new_realtime, "realtime snapshot barrier")

client = replace_once(
    client,
    "    loadDraftState();findMounts();syncComposers();await loadFeed();\n",
    "    loadDraftState();findMounts();syncComposers();await startRealtime();await loadFeed();\n",
    "subscribe before snapshot",
)

client_path.write_text(client, encoding="utf-8")

migration_path = Path("supabase/migrations/20260903062000_live_feed_comments_vertical_slice.sql")
migration = migration_path.read_text(encoding="utf-8")
migration = replace_once(
    migration,
    "        'can_delete', true,\n        'delete_deadline', v_existing.created_at + interval '5 minutes'\n",
    "        'can_delete', v_actor.role = 'admin' or v_existing.created_at >= v_now - interval '5 minutes',\n        'delete_deadline', v_existing.created_at + interval '5 minutes'\n",
    "idempotent delete window",
)
migration_path.write_text(migration, encoding="utf-8")

test_path = Path("live-feed-comments-contract.test.mjs")
test = test_path.read_text(encoding="utf-8")
test = replace_once(
    test,
    "  assert.match(client,/localStorage\\.setItem/)\n",
    "  assert.match(client,/localStorage\\.setItem/)\n  assert.match(client,/pendingRequest\\.body!==bodyText\\(state\\.draft\\)/)\n  assert.match(client,/Array\\.from\\(input\\.value\\)/)\n  assert.doesNotMatch(client,/input\\.maxLength=MAX_COMMENT_LENGTH/)\n",
    "draft and Unicode contracts",
)
test = replace_once(
    test,
    "  assert.match(migration,/live_feed_comment_deletions_immutable/)\n",
    "  assert.match(migration,/live_feed_comment_deletions_immutable/)\n  assert.match(client,/deleteDeadline>Date\\.now\\(\\)/)\n  assert.match(client,/deleteExpiryTimer=setTimeout/)\n  assert.match(client,/five-minute window to remove this comment has expired/)\n",
    "delete expiry contracts",
)
test = replace_once(
    test,
    "  assert.match(client,/filter:`organization_id=eq\\.\\$\\{organizationId\\}`/)\n",
    "  assert.match(client,/filter:`organization_id=eq\\.\\$\\{organizationId\\}`/)\n  assert.match(client,/await startRealtime\\(\\);await loadFeed\\(\\)/)\n  assert.match(client,/SUBSCRIBE_WAIT_EXPIRED/)\n",
    "realtime snapshot contract",
)
test_path.write_text(test, encoding="utf-8")

print("Patched Codex findings and closed the initial snapshot/subscription gap.")
