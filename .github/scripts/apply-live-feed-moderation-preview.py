from pathlib import Path
import base64
import gzip


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


def decode_payload(source: str, target: str) -> None:
    payload = Path(source).read_text(encoding="utf-8").strip()
    data = gzip.decompress(base64.b64decode(payload, validate=True))
    path = Path(target)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    print(f"wrote {path} ({len(data)} bytes)")


decode_payload(
    ".github/live-feed-preview-moderation/migration.sql.gz.b64",
    "supabase/migrations/20260903063000_live_feed_comment_moderation_quarantine.sql",
)
decode_payload(
    ".github/live-feed-preview-moderation/canary.sql.gz.b64",
    "supabase/tests/live-feed-comments-preview-canary.sql",
)

client_path = Path("app-live-feed.js")
client = client_path.read_text(encoding="utf-8")

client = replace_once(
    client,
    ".live-feed-delete:disabled{opacity:.55;cursor:wait}.live-feed-empty",
    ".live-feed-delete:disabled{opacity:.55;cursor:wait}.live-feed-moderation-pill{display:inline-flex;margin-left:6px;padding:2px 6px;border:1px solid #f59e0b;border-radius:999px;background:#fffbeb;color:#92400e;font-size:9px;font-weight:900;letter-spacing:.05em;text-transform:uppercase}.live-feed-event-actions{gap:7px;align-items:center;flex-wrap:wrap}.live-feed-moderate{border-radius:7px;padding:5px 8px;font-size:10px;font-weight:800;cursor:pointer}.live-feed-moderate.approve{border:1px solid #86efac;background:#f0fdf4;color:#166534}.live-feed-moderate.reject{border:1px solid #fecaca;background:#fef2f2;color:#991b1b}.live-feed-moderate:disabled{opacity:.55;cursor:wait}.live-feed-empty",
    "moderation styles",
)

client = replace_once(
    client,
    "safety.textContent='Do not post customer names, phone numbers, addresses, account numbers, order information, or other customer data. Comments are organization-wide, text-only, and cannot be edited.';",
    "safety.textContent='Do not post customer names, phone numbers, addresses, account numbers, order information, or other customer data. Free-form comments are text-only, cannot be edited, and remain visible only to you and Admin until an Admin approves them for the organization.';",
    "moderation safety copy",
)

old_actions = """    const deleteDeadline=parseTime(event?.delete_deadline);
    const deleteAllowed=type==='comment'&&event.can_delete&&(isAdmin()||(event.is_own&&deleteDeadline>Date.now()));
    if(deleteAllowed){
      const actions=document.createElement('div');actions.className='live-feed-event-actions';
      const remove=document.createElement('button');remove.type='button';remove.className='live-feed-delete';remove.dataset.commentId=String(event.comment_id||'');remove.textContent=event.is_own?'Remove comment':'Remove as Admin';remove.setAttribute('aria-label',remove.textContent);
      actions.appendChild(remove);article.appendChild(actions);
    }
"""
new_actions = """    if(type==='comment'&&event.moderation_status==='pending'){
      const pending=document.createElement('span');pending.className='live-feed-moderation-pill';pending.textContent='Pending Admin approval';nameWrap.appendChild(pending);
    }
    const deleteDeadline=parseTime(event?.delete_deadline);
    const deleteAllowed=type==='comment'&&event.can_delete&&(isAdmin()||(event.is_own&&deleteDeadline>Date.now()));
    const moderationAllowed=type==='comment'&&event.can_moderate&&event.moderation_status==='pending';
    if(deleteAllowed||moderationAllowed){
      const actions=document.createElement('div');actions.className='live-feed-event-actions';
      if(moderationAllowed){
        const approve=document.createElement('button');approve.type='button';approve.className='live-feed-moderate approve';approve.dataset.commentId=String(event.comment_id||'');approve.dataset.decision='approve';approve.textContent='APPROVE';approve.setAttribute('aria-label','Approve this comment for the organization Live Feed');
        const reject=document.createElement('button');reject.type='button';reject.className='live-feed-moderate reject';reject.dataset.commentId=String(event.comment_id||'');reject.dataset.decision='reject';reject.textContent='REJECT';reject.setAttribute('aria-label','Reject this pending comment');
        actions.append(approve,reject);
      }
      if(deleteAllowed){
        const remove=document.createElement('button');remove.type='button';remove.className='live-feed-delete';remove.dataset.commentId=String(event.comment_id||'');remove.textContent=event.is_own?'Remove comment':'Remove as Admin';remove.setAttribute('aria-label',remove.textContent);actions.appendChild(remove);
      }
      article.appendChild(actions);
    }
"""
client = replace_once(client, old_actions, new_actions, "moderation event controls")

client = replace_once(
    client,
    "    if(/comment too long/i.test(raw))return `Comments are limited to ${MAX_COMMENT_LENGTH} characters.`;\n    if(/authentication|required|access|membership/i.test(raw))return 'Your Live Feed access could not be verified. Sign in again and retry.';",
    "    if(/comment too long/i.test(raw))return `Comments are limited to ${MAX_COMMENT_LENGTH} characters.`;\n    if(/moderation reason required/i.test(raw))return 'Enter a reason before rejecting this comment.';\n    if(/comment already moderated/i.test(raw))return 'This comment was already reviewed. Refresh Live Feed.';\n    if(/comment moderation forbidden|admin required/i.test(raw))return 'Only an Admin can approve or reject pending comments.';\n    if(/authentication|required|access|membership/i.test(raw))return 'Your Live Feed access could not be verified. Sign in again and retry.';",
    "moderation errors",
)

client = replace_once(
    client,
    "      setComposerStatus(result.idempotent?'Comment already posted; duplicate retry safely ignored.':'Posted to Live Feed.','ok');",
    "      setComposerStatus(result.idempotent?'Comment already submitted; duplicate retry safely ignored.':'Submitted for Admin review. It is visible only to you and Admin until approved.','ok');",
    "pending post confirmation",
)

client = replace_once(
    client,
    "  async function deleteComment(commentId,event){\n",
    """  async function moderateComment(commentId,decision,event){
    if(!commentId||!isAdmin()||event?.moderation_status!=='pending')return;
    const client=resolveClient();if(!client)return;
    let reason='';
    if(decision==='approve'){
      if(!confirm('Approve and broadcast this comment to the organization Live Feed? Confirm that you reviewed it and it contains no customer names, contact details, addresses, order numbers, account numbers, or other customer data.'))return;
      reason='Reviewed by Admin: no customer data observed';
    }else{
      reason=prompt('Enter the reason for rejecting this pending comment:','Customer information or inappropriate content');
      if(!String(reason||'').trim()){setComposerStatus('A rejection reason is required. No change was made.','error');return;}
    }
    setComposerStatus(decision==='approve'?'Approving comment…':'Rejecting comment…');
    try{
      const {data,error}=await client.rpc('moderate_live_feed_comment_v1',{p_comment_id:commentId,p_decision:decision,p_reason:String(reason).trim()});
      if(error)throw error;
      const result=normalizeRpcResponse(data);if(!result?.ok)throw new Error(result?.error||'comment_moderation_failed');
      if(decision==='approve'&&result.event){markToastSeen(toastSeenKey({id:commentId}));mergeEvent(result.event);setComposerStatus('Comment approved and published to the organization Live Feed.','ok');}
      else{state.events=state.events.filter(item=>String(item.comment_id||'')!==String(commentId));scheduleRender();setComposerStatus('Comment rejected and retained in the private moderation audit.','ok');}
      window.dispatchEvent(new CustomEvent('mccoy-live-feed-comments-changed',{detail:{eventType:'MODERATE',commentId,decision}}));
    }catch(error){console.error('Live Feed comment moderation failed',error);setComposerStatus(friendlyError(error),'error');}
  }

  async function deleteComment(commentId,event){
""",
    "moderation function",
)

old_enqueue = """  function enqueueCommentToast(row){
    const ownById=state.userId&&String(row?.author_user_id||'')===String(state.userId);
    const ownByEmail=state.email&&String(row?.author_email||'').trim().toLowerCase()===state.email;
    if(!row||ownById||ownByEmail)return;
    const created=parseTime(row.created_at);if(!created||Date.now()-created>COMMENT_TOAST_MAX_AGE_MS)return;
"""
new_enqueue = """  function enqueueCommentToast(row){
    const ownById=state.userId&&String(row?.author_user_id||'')===String(state.userId);
    const ownByEmail=state.email&&String(row?.author_email||'').trim().toLowerCase()===state.email;
    if(!row||row.moderation_status!=='approved'||ownById||ownByEmail)return;
    const created=parseTime(row.published_at||row.created_at);if(!created||Date.now()-created>COMMENT_TOAST_MAX_AGE_MS)return;
"""
client = replace_once(client, old_enqueue, new_enqueue, "approved-only comment toast")

old_event = """  function commentEventFromRow(row){
    const own=String(row.author_user_id||'')===String(state.userId||''),created=parseTime(row.created_at);
    return {
      event_id:`comment:${row.id}`,
      event_type:'comment',
      comment_id:row.id,
      created_at:row.created_at,
      actor_user_id:row.author_user_id,
      actor_name:row.author_display_name,
      actor_role:row.author_role,
      message:row.body,
      secondary_messages:[],
      related_sale_id:null,
      scope:row.scope||'organization',
      is_own:own,
      can_delete:isAdmin()||(own&&created>=Date.now()-5*60*1000),
      delete_deadline:new Date(created+5*60*1000).toISOString()
    };
  }
"""
new_event = """  function commentEventFromRow(row){
    const own=String(row.author_user_id||'')===String(state.userId||''),submitted=parseTime(row.created_at),status=String(row.moderation_status||'pending');
    return {
      event_id:`comment:${row.id}`,
      event_type:'comment',
      comment_id:row.id,
      created_at:row.published_at||row.created_at,
      submitted_at:row.created_at,
      published_at:row.published_at||null,
      moderation_status:status,
      actor_user_id:row.author_user_id,
      actor_name:row.author_display_name,
      actor_role:row.author_role,
      message:row.body,
      secondary_messages:[],
      related_sale_id:null,
      scope:row.scope||'organization',
      is_own:own,
      can_delete:isAdmin()||(own&&submitted>=Date.now()-5*60*1000),
      can_moderate:isAdmin()&&status==='pending',
      delete_deadline:new Date(submitted+5*60*1000).toISOString()
    };
  }
"""
client = replace_once(client, old_event, new_event, "moderation event mapping")

old_realtime = """  function onCommentRealtime(payload){
    const type=payload?.eventType,row=payload?.new||null,old=payload?.old||null;
    if(type==='INSERT'&&row){
      const event=commentEventFromRow(row);mergeEvent(event);enqueueCommentToast(row);
      window.dispatchEvent(new CustomEvent('mccoy-live-feed-comments-changed',{detail:{eventType:'INSERT',event,own:event.is_own}}));
      return;
    }
    if(type==='UPDATE'){
      if(row?.deleted_at){state.events=state.events.filter(item=>String(item.comment_id||'')!==String(row.id));scheduleRender();}
      else if(row)mergeEvent(commentEventFromRow(row));
      window.dispatchEvent(new CustomEvent('mccoy-live-feed-comments-changed',{detail:{eventType:'UPDATE',commentId:row?.id||old?.id||null}}));
    }
  }
"""
new_realtime = """  function onCommentRealtime(payload){
    const type=payload?.eventType,row=payload?.new||null,old=payload?.old||null;
    if(type==='INSERT'&&row){
      const event=commentEventFromRow(row);mergeEvent(event);
      if(row.moderation_status==='approved')enqueueCommentToast(row);
      window.dispatchEvent(new CustomEvent('mccoy-live-feed-comments-changed',{detail:{eventType:'INSERT',event,own:event.is_own}}));
      return;
    }
    if(type==='UPDATE'){
      if(row?.deleted_at||row?.moderation_status==='rejected'){
        state.events=state.events.filter(item=>String(item.comment_id||'')!==String(row.id));scheduleRender();
      }else if(row){
        const event=commentEventFromRow(row);mergeEvent(event);
        if(row.moderation_status==='approved'&&old?.moderation_status!=='approved')enqueueCommentToast(row);
      }
      window.dispatchEvent(new CustomEvent('mccoy-live-feed-comments-changed',{detail:{eventType:'UPDATE',commentId:row?.id||old?.id||null}}));
    }
  }
"""
client = replace_once(client, old_realtime, new_realtime, "moderation realtime flow")

old_click = """  document.addEventListener('click',event=>{
    const remove=event.target?.closest?.('.live-feed-delete');if(remove){event.preventDefault();const commentId=remove.dataset.commentId,eventItem=state.events.find(item=>String(item.comment_id||'')===String(commentId));deleteComment(commentId,eventItem);return;}
    if(event.target?.closest?.('#salesRefreshBtn,#repDashboardSalesRefresh'))setTimeout(()=>loadFeed({quiet:true}),0);
  });
"""
new_click = """  document.addEventListener('click',event=>{
    const moderation=event.target?.closest?.('.live-feed-moderate');if(moderation){event.preventDefault();const commentId=moderation.dataset.commentId,eventItem=state.events.find(item=>String(item.comment_id||'')===String(commentId));moderateComment(commentId,moderation.dataset.decision,eventItem);return;}
    const remove=event.target?.closest?.('.live-feed-delete');if(remove){event.preventDefault();const commentId=remove.dataset.commentId,eventItem=state.events.find(item=>String(item.comment_id||'')===String(commentId));deleteComment(commentId,eventItem);return;}
    if(event.target?.closest?.('#salesRefreshBtn,#repDashboardSalesRefresh'))setTimeout(()=>loadFeed({quiet:true}),0);
  });
"""
client = replace_once(client, old_click, new_click, "moderation click routing")
client_path.write_text(client, encoding="utf-8")

live_wins_path = Path("app-live-wins.js")
live_wins = live_wins_path.read_text(encoding="utf-8")
live_wins = replace_once(live_wins, "app-live-feed.js?v=2026090301", "app-live-feed.js?v=2026090302", "Live Feed cache key")
live_wins_path.write_text(live_wins, encoding="utf-8")

worker_path = Path("service-worker.js")
worker = worker_path.read_text(encoding="utf-8")
worker = replace_once(worker, "field-coach-app-shell-v9-20260903-live-feed-preview", "field-coach-app-shell-v10-20260903-live-feed-moderation-preview", "service worker identity")
worker = replace_once(worker, "/app-live-feed.js?v=2026090301", "/app-live-feed.js?v=2026090302", "service worker Live Feed cache key")
worker_path.write_text(worker, encoding="utf-8")

test_path = Path("live-feed-comments-contract.test.mjs")
test = test_path.read_text(encoding="utf-8")
test = replace_once(
    test,
    "const migration=readFileSync(new URL('./supabase/migrations/20260903062000_live_feed_comments_vertical_slice.sql',import.meta.url),'utf8')\n",
    "const baseMigration=readFileSync(new URL('./supabase/migrations/20260903062000_live_feed_comments_vertical_slice.sql',import.meta.url),'utf8')\nconst moderationMigration=readFileSync(new URL('./supabase/migrations/20260903063000_live_feed_comment_moderation_quarantine.sql',import.meta.url),'utf8')\nconst migration=baseMigration+'\\n'+moderationMigration\n",
    "combined migration source",
)
test = replace_once(
    test,
    "  const expression=new RegExp(`create or replace function public\\\\.${name}\\\\([\\\\s\\\\S]*?\\\\n\\\\$\\\\$;`,'i')\n  const match=migration.match(expression)\n  assert.ok(match,`${name} must exist`)\n  return match[0]\n",
    "  const expression=new RegExp(`create or replace function public\\\\.${name}\\\\([\\\\s\\\\S]*?\\\\n\\\\$\\\\$;`,'gi')\n  const matches=[...migration.matchAll(expression)]\n  assert.ok(matches.length,`${name} must exist`)\n  return matches.at(-1)[0]\n",
    "latest function body",
)
test = replace_once(test, "app-live-feed\\.js\\?v=2026090301", "app-live-feed\\.js\\?v=2026090302", "test client cache key")
test = replace_once(test, "field-coach-app-shell-v9-20260903-live-feed-preview", "field-coach-app-shell-v10-20260903-live-feed-moderation-preview", "test worker identity")
test = replace_once(test, "'/app-live-feed\\.js\\?v=2026090301'", "'/app-live-feed\\.js\\?v=2026090302'", "test worker cache key")

test += """

test('free-form comments are quarantined until an Admin approves them',()=>{
  const post=functionBody('post_live_feed_comment_v1')
  const getFeed=functionBody('get_live_feed_v1')
  const moderate=functionBody('moderate_live_feed_comment_v1')
  assert.match(migration,/moderation_status text not null default 'pending'/)
  assert.match(migration,/moderation_status in \('pending','approved','rejected'\)/)
  assert.match(post,/'pending'/)
  assert.match(getFeed,/comment\.moderation_status = 'approved'/)
  assert.match(getFeed,/comment\.author_user_id = v_actor\.auth_user_id/)
  assert.match(getFeed,/v_actor\.role = 'admin'/)
  assert.match(moderate,/v_actor\.role <> 'admin'/)
  assert.match(moderate,/p_decision not in \('approve','reject'\)/)
  assert.match(moderate,/published_at = v_now/)
  assert.match(moderationMigration,/private\.live_feed_comment_moderation_events/)
  assert.match(moderationMigration,/live_feed_comment_moderation_events_immutable/)
})

test('the client publishes and toasts only after moderation approval',()=>{
  assert.match(client,/Pending Admin approval/)
  assert.match(client,/Submitted for Admin review/)
  assert.match(client,/moderate_live_feed_comment_v1/)
  assert.match(client,/row\.moderation_status!=='approved'/)
  assert.match(client,/row\.moderation_status==='approved'&&old\?\.moderation_status!=='approved'/)
  assert.match(client,/contains no customer names, contact details, addresses, order numbers, account numbers/)
  assert.match(client,/can_moderate/)
})
"""
test_path.write_text(test, encoding="utf-8")

docs_path = Path("docs/live-feed-comments-preview.md")
docs = docs_path.read_text(encoding="utf-8")
docs = replace_once(
    docs,
    "| Visibility | All active authorized members of the same organization |",
    "| Visibility | Author and Admin see pending submissions; all active authorized members of the same organization see approved comments |",
    "docs visibility",
)
docs = replace_once(
    docs,
    "| Customer information | Explicitly prohibited; obvious contact, address, order, and account patterns are rejected server-side |",
    "| Customer information | Explicitly prohibited; obvious patterns are rejected immediately and every free-form submission remains quarantined until an Admin certifies it contains no customer data |",
    "docs customer information",
)
docs = replace_once(
    docs,
    "The server derives organization, Auth user ID, email, display name, and role from the signed-in identity. Authenticated clients receive organization-scoped SELECT access for Realtime, but no direct INSERT, UPDATE, or DELETE privileges. Writes use idempotent RPCs.\n",
    "The server derives organization, Auth user ID, email, display name, and role from the signed-in identity. Authenticated clients receive organization-scoped SELECT access for Realtime, but no direct INSERT, UPDATE, or DELETE privileges. Writes use idempotent RPCs.\n\nFree-form comments fail closed in a moderation quarantine. The author receives immediate pending confirmation and an Admin may review the pending text. Ordinary members do not receive the row or its notification until an Admin explicitly approves it after certifying that no customer information is present. Rejection preserves private immutable audit evidence and never broadcasts the text organization-wide.\n",
    "docs moderation boundary",
)
docs = replace_once(
    docs,
    "- two preview users in the same organization can exchange comments in Realtime;",
    "- one preview user can submit a pending comment, an Admin can approve it, and a second same-organization user receives only the approved comment in Realtime;",
    "docs acceptance flow",
)
docs_path.write_text(docs, encoding="utf-8")

print("Materialized fail-closed moderation and patched the Live Feed preview client/contracts.")
