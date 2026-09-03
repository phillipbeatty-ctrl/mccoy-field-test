// Preview-only mixed Live Feed: verified sales remain authoritative in sales_feed,
// while standalone organization comments use live_feed_comments and dedicated RPCs.
(()=>{
  if(window.MCCOY_LIVE_FEED_V1)return;
  window.MCCOY_LIVE_FEED_V1=true;

  const MAX_COMMENT_LENGTH=280;
  const FEED_LIMIT=100;
  const COMMENT_TOAST_MAX_AGE_MS=15000;
  const COMMENT_TOAST_DURATION_MS=4000;
  const mountState=new Map();
  const state={
    client:null,
    initialized:false,
    loading:false,
    posting:false,
    loaded:false,
    events:[],
    organizationId:null,
    userId:null,
    role:null,
    email:null,
    channel:null,
    channelOrganizationId:null,
    realtimeReady:null,
    deleteExpiryTimer:null,
    draft:'',
    pendingRequest:null,
    renderScheduled:false,
    toastQueue:[],
    toastRunning:false,
    collapsedToasts:0
  };

  const style=document.createElement('style');
  style.textContent=`
    .live-feed-preview-heading{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.live-feed-preview-pill{display:inline-flex;align-items:center;padding:2px 7px;border:1px solid #c7d2fe;border-radius:999px;background:#eef2ff;color:#3730a3;font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase}
    .live-feed-composer{display:grid;gap:7px;margin:10px 0 12px;padding:10px;border:1px solid #dbe3ef;border-radius:11px;background:#f8fafc}.live-feed-compose-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:stretch}.live-feed-compose-input{box-sizing:border-box;width:100%;min-height:46px;max-height:132px;resize:vertical;padding:10px 11px;border:1px solid #cbd5e1;border-radius:9px;background:#fff;color:#0f172a;font:inherit;line-height:1.35}.live-feed-compose-input:focus{outline:2px solid rgba(37,99,235,.2);border-color:#2563eb}.live-feed-post{min-width:76px;min-height:46px}.live-feed-compose-meta{display:flex;justify-content:space-between;gap:10px;align-items:flex-start;flex-wrap:wrap;font-size:11px;color:#64748b}.live-feed-safety{max-width:760px}.live-feed-compose-status[data-state="error"]{color:#991b1b;font-weight:700}.live-feed-compose-status[data-state="ok"]{color:#166534;font-weight:700}.live-feed-compose-status[data-state="offline"]{color:#92400e;font-weight:700}.live-feed-character-count.over{color:#991b1b;font-weight:800}
    .live-feed-event-list{display:grid}.live-feed-event{padding:11px 0;border-bottom:1px solid #e5e7eb}.live-feed-event:last-child{border-bottom:0}.live-feed-event-head{display:flex;align-items:center;justify-content:space-between;gap:8px}.live-feed-event-identity{display:flex;align-items:center;gap:8px;min-width:0}.live-feed-event-icon{display:grid;place-items:center;flex:0 0 30px;width:30px;height:30px;border-radius:999px;background:#eef2ff;font-size:16px}.live-feed-comment .live-feed-event-icon{background:#f1f5f9;color:#334155;font-size:11px;font-weight:900}.live-feed-event-name{font-size:13px;font-weight:800;color:#0f172a}.live-feed-event-role{margin-left:4px;color:#64748b;font-size:10px;font-weight:700;text-transform:uppercase}.live-feed-event-time{white-space:nowrap;color:#64748b;font-size:10px}.live-feed-event-message{margin:6px 0 0;color:#1e293b;font-size:13px;line-height:1.42;white-space:pre-wrap;overflow-wrap:anywhere}.live-feed-sale .live-feed-event-message{font-weight:800}.live-feed-secondary{display:grid;gap:3px;margin:6px 0 0 38px;color:#475569;font-size:11px}.live-feed-event-actions{display:flex;justify-content:flex-end;margin-top:6px}.live-feed-delete{border:0;background:transparent;color:#64748b;padding:4px 0;font-size:10px;text-decoration:underline;cursor:pointer}.live-feed-delete:disabled{opacity:.55;cursor:wait}.live-feed-moderation-pill{display:inline-flex;margin-left:6px;padding:2px 6px;border:1px solid #f59e0b;border-radius:999px;background:#fffbeb;color:#92400e;font-size:9px;font-weight:900;letter-spacing:.05em;text-transform:uppercase}.live-feed-event-actions{gap:7px;align-items:center;flex-wrap:wrap}.live-feed-moderate{border-radius:7px;padding:5px 8px;font-size:10px;font-weight:800;cursor:pointer}.live-feed-moderate.approve{border:1px solid #86efac;background:#f0fdf4;color:#166534}.live-feed-moderate.reject{border:1px solid #fecaca;background:#fef2f2;color:#991b1b}.live-feed-moderate:disabled{opacity:.55;cursor:wait}.live-feed-empty{padding:12px 0;color:#64748b;font-size:12px}.live-feed-retention{margin-top:8px;color:#64748b;font-size:10px}
    #liveFeedCommentToasts{position:fixed;left:50%;top:max(12px,env(safe-area-inset-top));z-index:180000;width:min(520px,calc(100vw - 24px));transform:translateX(-50%);pointer-events:none}.live-feed-comment-toast{padding:11px 13px;border:1px solid rgba(148,163,184,.8);border-radius:12px;background:rgba(255,255,255,.97);box-shadow:0 14px 34px rgba(15,23,42,.2);color:#0f172a;animation:liveFeedCommentFloat ${COMMENT_TOAST_DURATION_MS}ms ease-out forwards}.live-feed-comment-toast strong{display:block;font-size:12px}.live-feed-comment-toast span{display:-webkit-box;margin-top:3px;overflow:hidden;-webkit-line-clamp:2;-webkit-box-orient:vertical;font-size:12px;line-height:1.35;color:#334155}
    @keyframes liveFeedCommentFloat{0%{opacity:0;transform:translateY(-22px) scale(.98)}12%{opacity:1;transform:translateY(0) scale(1)}74%{opacity:1;transform:translateY(76px) scale(1)}100%{opacity:0;transform:translateY(118px) scale(.99)}}
    @media(max-width:650px){.live-feed-compose-row{grid-template-columns:1fr}.live-feed-post{width:100%}}
    @media(prefers-reduced-motion:reduce){.live-feed-comment-toast{animation:liveFeedCommentFade ${COMMENT_TOAST_DURATION_MS}ms linear forwards}@keyframes liveFeedCommentFade{0%{opacity:0}10%,80%{opacity:1}100%{opacity:0}}}
  `;
  document.head.appendChild(style);

  const toastHost=document.createElement('div');
  toastHost.id='liveFeedCommentToasts';
  toastHost.setAttribute('role','status');
  toastHost.setAttribute('aria-live','polite');
  toastHost.setAttribute('aria-atomic','true');
  document.body.appendChild(toastHost);

  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const normalizedRole=value=>String(value||'').trim().toLowerCase();
  const isAdmin=()=>normalizedRole(state.role)==='admin';
  const parseTime=value=>{const time=Date.parse(value);return Number.isFinite(time)?time:0;};
  const eventKey=event=>String(event?.event_id||`${event?.event_type||'event'}:${event?.comment_id||event?.id||event?.created_at||''}`);
  const bodyText=value=>String(value||'').replace(/\r\n?/g,'\n').trim();
  const clipped=(value,max=160)=>{const text=String(value||'').replace(/\s+/g,' ').trim();return text.length<=max?text:text.slice(0,max-1)+'…';};
  const currentAccess=()=>window.MCCOY_ACCESS?.access||null;
  const currentUser=()=>window.MCCOY_ACCESS?.user||null;

  function resolveClient(){
    if(state.client)return state.client;
    try{state.client=window.MCCOY_REQUIRE_SUPABASE_CLIENT?.({auth:true,rpc:true})||window.MCCOY_GET_SUPABASE_CLIENT?.({auth:true,rpc:true})||null;}catch(_){}
    if(state.client)return state.client;
    try{if(typeof sb!=='undefined'&&sb)state.client=sb;}catch(_){}
    return state.client;
  }

  function draftKey(){return `mccoy-live-feed-draft:${state.organizationId||'organization'}:${state.userId||state.email||'user'}`;}
  function pendingKey(){return `mccoy-live-feed-pending:${state.organizationId||'organization'}:${state.userId||state.email||'user'}`;}
  function readLocal(key,fallback=''){
    try{return localStorage.getItem(key)??fallback;}catch{return fallback;}
  }
  function writeLocal(key,value){
    try{if(value)localStorage.setItem(key,value);else localStorage.removeItem(key);}catch(_){}
  }
  function loadDraftState(){
    state.draft=readLocal(draftKey(),'');
    try{const parsed=JSON.parse(readLocal(pendingKey(),'null'));state.pendingRequest=parsed&&parsed.id&&typeof parsed.body==='string'?parsed:null;}catch(_){state.pendingRequest=null;}
    if(state.pendingRequest&&state.pendingRequest.body!==bodyText(state.draft)){state.pendingRequest=null;writeLocal(pendingKey(),'');}
  }
  function saveDraft(){writeLocal(draftKey(),state.draft);}
  function savePending(){writeLocal(pendingKey(),state.pendingRequest?JSON.stringify(state.pendingRequest):'');}

  function allComposers(){return [...document.querySelectorAll('.live-feed-composer')];}
  function setComposerStatus(message='',status=''){
    for(const composer of allComposers()){
      const element=composer.querySelector('.live-feed-compose-status');
      if(element){element.textContent=message;element.dataset.state=status;}
    }
  }
  function syncComposers({focus=null}={}){
    for(const composer of allComposers()){
      const input=composer.querySelector('.live-feed-compose-input');
      const count=composer.querySelector('.live-feed-character-count');
      const button=composer.querySelector('.live-feed-post');
      if(input&&input!==focus&&input.value!==state.draft)input.value=state.draft;
      const length=Array.from(state.draft).length;
      if(count){count.textContent=`${length}/${MAX_COMMENT_LENGTH}`;count.classList.toggle('over',length>MAX_COMMENT_LENGTH);}
      if(button){button.disabled=state.posting||!state.draft.trim()||length>MAX_COMMENT_LENGTH;button.textContent=state.posting?'POSTING…':state.pendingRequest?'RETRY':'POST';}
    }
  }

  function handleDraftInput(input){
    const characters=Array.from(input.value);
    if(characters.length>MAX_COMMENT_LENGTH)input.value=characters.slice(0,MAX_COMMENT_LENGTH).join('');
    state.draft=input.value;
    if(state.pendingRequest&&state.pendingRequest.body!==bodyText(state.draft)){state.pendingRequest=null;savePending();}
    saveDraft();
    syncComposers({focus:input});
    if(navigator.onLine===false)setComposerStatus('Offline — draft saved on this device. Reconnect, then press RETRY.','offline');
    else setComposerStatus('');
  }

  function updateHeading(root){
    const card=root.closest('.sales-card,.card');
    if(!card)return;
    const candidates=[...card.querySelectorAll('.card-head h2,h2,strong')];
    const heading=candidates.find(element=>/live\s+wins/i.test(element.textContent||''))||candidates.find(element=>/live\s+feed/i.test(element.textContent||''));
    if(!heading)return;
    heading.textContent='⚡ Live Feed';
    heading.classList.add('live-feed-preview-heading');
    if(!card.querySelector('.live-feed-preview-pill')){
      const pill=document.createElement('span');pill.className='live-feed-preview-pill';pill.textContent='Preview';heading.insertAdjacentElement('afterend',pill);
    }
  }

  function createComposer(root){
    const composer=document.createElement('div');
    composer.className='live-feed-composer';
    composer.dataset.liveFeedComposerFor=root.id;
    const row=document.createElement('div');row.className='live-feed-compose-row';
    const input=document.createElement('textarea');input.className='live-feed-compose-input';input.rows=2;input.placeholder='Write a comment…';input.setAttribute('aria-label','Write a Live Feed comment');input.value=state.draft;
    const post=document.createElement('button');post.type='button';post.className='primary live-feed-post';post.textContent='POST';
    row.append(input,post);
    const meta=document.createElement('div');meta.className='live-feed-compose-meta';
    const left=document.createElement('div');
    const safety=document.createElement('div');safety.className='live-feed-safety';safety.textContent='Do not post customer names, phone numbers, addresses, account numbers, order information, or other customer data. Free-form comments are text-only, cannot be edited, and remain visible only to you and Admin until an Admin approves them for the organization.';
    const status=document.createElement('div');status.className='live-feed-compose-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
    left.append(safety,status);
    const count=document.createElement('span');count.className='live-feed-character-count';
    meta.append(left,count);
    composer.append(row,meta);
    root.insertAdjacentElement('beforebegin',composer);
    input.addEventListener('input',()=>handleDraftInput(input));
    input.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();postComment();}});
    post.addEventListener('click',postComment);
    return composer;
  }

  function ensureMount(root){
    if(!root||mountState.has(root))return;
    updateHeading(root);
    let composer=root.previousElementSibling;
    if(!composer?.classList?.contains('live-feed-composer'))composer=createComposer(root);
    root.setAttribute('aria-label','Live Feed activity');
    const observer=new MutationObserver(()=>{
      if(state.loaded&&!root.querySelector('[data-live-feed-render="v1"]'))scheduleRender();
    });
    observer.observe(root,{childList:true});
    mountState.set(root,{composer,observer});
    syncComposers();
    if(state.loaded)scheduleRender();
  }

  function findMounts(){
    document.querySelectorAll('#salesFeed,#dashboardSalesFeed').forEach(ensureMount);
  }

  function formatTimestamp(value){
    const date=new Date(value);return Number.isNaN(date.getTime())?'':date.toLocaleString();
  }
  function initials(name){
    return String(name||'Member').trim().split(/\s+/).slice(0,2).map(part=>part[0]?.toUpperCase()||'').join('')||'M';
  }
  function secondaryMessages(event){return Array.isArray(event?.secondary_messages)?event.secondary_messages.filter(value=>typeof value==='string'&&value.trim()):[];}

  function buildEventNode(event){
    const type=event?.event_type==='comment'?'comment':'sale';
    const article=document.createElement('article');article.className=`live-feed-event live-feed-${type}`;article.dataset.eventId=eventKey(event);
    const head=document.createElement('div');head.className='live-feed-event-head';
    const identity=document.createElement('div');identity.className='live-feed-event-identity';
    const icon=document.createElement('div');icon.className='live-feed-event-icon';icon.setAttribute('aria-hidden','true');icon.textContent=type==='sale'?'🎉':initials(event.actor_name);
    const nameWrap=document.createElement('div');
    const name=document.createElement('span');name.className='live-feed-event-name';name.textContent=String(event.actor_name||'Team member');
    nameWrap.appendChild(name);
    if(type==='comment'&&event.actor_role){const role=document.createElement('span');role.className='live-feed-event-role';role.textContent=String(event.actor_role);nameWrap.appendChild(role);}
    identity.append(icon,nameWrap);
    const time=document.createElement('time');time.className='live-feed-event-time';time.dateTime=String(event.created_at||'');time.textContent=formatTimestamp(event.created_at);
    head.append(identity,time);
    const message=document.createElement(type==='sale'?'strong':'div');message.className='live-feed-event-message';message.textContent=String(event.message||'');
    article.append(head,message);
    const extra=secondaryMessages(event);
    if(type==='sale'&&extra.length){const list=document.createElement('div');list.className='live-feed-secondary';for(const text of extra){const line=document.createElement('div');line.textContent=text;list.appendChild(line);}article.appendChild(list);}
    if(type==='comment'&&event.moderation_status==='pending'){
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
    return article;
  }

  function render(){
    state.renderScheduled=false;
    findMounts();
    for(const root of mountState.keys()){
      const scrollTop=root.scrollTop;
      const wrapper=document.createElement('div');wrapper.className='live-feed-event-list';wrapper.dataset.liveFeedRender='v1';
      if(!state.events.length){const empty=document.createElement('div');empty.className='live-feed-empty';empty.textContent=state.loaded?'No Live Feed activity in the last 30 days.':'Loading Live Feed…';wrapper.appendChild(empty);}
      else for(const event of state.events.slice(0,FEED_LIMIT))wrapper.appendChild(buildEventNode(event));
      const retention=document.createElement('div');retention.className='live-feed-retention';retention.textContent='Showing up to 100 organization events from the last 30 days. Verified sales remain separate from comments and continue to control rankings.';wrapper.appendChild(retention);
      root.replaceChildren(wrapper);root.scrollTop=scrollTop;
      updateHeading(root);
    }
    if(state.deleteExpiryTimer){clearTimeout(state.deleteExpiryTimer);state.deleteExpiryTimer=null;}
    if(!isAdmin()){
      const deadlines=state.events
        .filter(event=>event?.event_type==='comment'&&event.is_own&&event.can_delete)
        .map(event=>parseTime(event.delete_deadline))
        .filter(deadline=>deadline>Date.now());
      if(deadlines.length){
        const nextDeadline=Math.min(...deadlines);
        state.deleteExpiryTimer=setTimeout(()=>scheduleRender(),Math.max(25,nextDeadline-Date.now()+25));
      }
    }
    syncComposers();
  }
  function scheduleRender(){
    if(state.renderScheduled)return;state.renderScheduled=true;queueMicrotask(render);
  }

  function normalizeRpcResponse(data){
    if(typeof data==='string'){try{return JSON.parse(data);}catch(_){return null;}}
    return data&&typeof data==='object'?data:null;
  }
  function mergeEvent(event){
    if(!event?.event_id)return;
    const key=eventKey(event),next=[event,...state.events.filter(item=>eventKey(item)!==key)];
    next.sort((left,right)=>parseTime(right.created_at)-parseTime(left.created_at)||eventKey(right).localeCompare(eventKey(left)));
    state.events=next.slice(0,FEED_LIMIT);scheduleRender();
  }

  function friendlyError(error){
    const raw=String(error?.message||error||'').replace(/_/g,' ').trim();
    if(/customer information not allowed/i.test(raw))return 'Comment not posted. Customer names, contact details, addresses, order numbers, and account information are prohibited.';
    if(/rate limited 3 seconds/i.test(raw))return 'Please wait a few seconds before posting another comment.';
    if(/rate limited 5 per minute/i.test(raw))return 'Posting paused: maximum 5 comments per minute.';
    if(/rate limited 30 per hour/i.test(raw))return 'Posting paused: maximum 30 comments per hour.';
    if(/comment too long/i.test(raw))return `Comments are limited to ${MAX_COMMENT_LENGTH} characters.`;
    if(/moderation reason required/i.test(raw))return 'Enter a reason before rejecting this comment.';
    if(/comment already moderated/i.test(raw))return 'This comment was already reviewed. Refresh Live Feed.';
    if(/comment moderation forbidden|admin required/i.test(raw))return 'Only an Admin can approve or reject pending comments.';
    if(/authentication|required|access|membership/i.test(raw))return 'Your Live Feed access could not be verified. Sign in again and retry.';
    if(/function .* does not exist|could not find the function|schema cache/i.test(raw))return 'The preview database is not connected to this Live Feed build yet.';
    return raw||'Live Feed request failed. Your draft was kept.';
  }

  async function loadFeed({quiet=false}={}){
    const client=resolveClient();if(!client||state.loading)return;
    state.loading=true;
    if(!quiet)setComposerStatus('Loading Live Feed…');
    try{
      const {data,error}=await client.rpc('get_live_feed_v1',{p_limit:FEED_LIMIT,p_before:null});
      if(error)throw error;
      const result=normalizeRpcResponse(data);
      if(!result?.ok||!Array.isArray(result.events))throw new Error(result?.error||'live_feed_load_failed');
      state.events=result.events;
      state.loaded=true;
      if(result.organization_id&&result.organization_id!==state.organizationId){state.organizationId=result.organization_id;loadDraftState();}
      scheduleRender();
      await startRealtime();
      if(!quiet)setComposerStatus('Live Feed is current.','ok');
    }catch(error){
      console.error('Live Feed load failed',error);
      if(!state.loaded){state.events=[];scheduleRender();}
      setComposerStatus(friendlyError(error),'error');
    }finally{state.loading=false;syncComposers();}
  }

  function requestIdForDraft(body){
    if(state.pendingRequest?.body===body&&state.pendingRequest.id)return state.pendingRequest.id;
    const id=crypto.randomUUID?.()||'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,character=>{const random=Math.random()*16|0,value=character==='x'?random:(random&3|8);return value.toString(16);});
    state.pendingRequest={id,body};savePending();return id;
  }

  async function postComment(){
    if(state.posting)return;
    const client=resolveClient(),body=bodyText(state.draft);
    if(!client){setComposerStatus('McCoy connection is not ready. Refresh this preview and retry.','error');return;}
    if(!body){setComposerStatus('Write a comment before posting.','error');return;}
    if(Array.from(body).length>MAX_COMMENT_LENGTH){setComposerStatus(`Comments are limited to ${MAX_COMMENT_LENGTH} characters.`,'error');return;}
    if(navigator.onLine===false){setComposerStatus('Offline — draft saved on this device. Reconnect, then press RETRY.','offline');state.pendingRequest={id:requestIdForDraft(body),body};savePending();syncComposers();return;}
    const requestId=requestIdForDraft(body);
    state.posting=true;syncComposers();setComposerStatus('Posting comment…');
    try{
      const {data,error}=await client.rpc('post_live_feed_comment_v1',{p_body:body,p_client_request_id:requestId});
      if(error)throw error;
      const result=normalizeRpcResponse(data);
      if(!result?.ok||!result.event)throw new Error(result?.error||'comment_post_failed');
      mergeEvent(result.event);
      state.draft='';state.pendingRequest=null;saveDraft();savePending();syncComposers();
      setComposerStatus(result.idempotent?'Comment already submitted; duplicate retry safely ignored.':'Submitted for Admin review. It is visible only to you and Admin until approved.','ok');
      window.dispatchEvent(new CustomEvent('mccoy-live-feed-comments-changed',{detail:{eventType:'INSERT',event:result.event,own:true}}));
    }catch(error){
      console.error('Live Feed comment post failed',error);
      setComposerStatus(friendlyError(error),navigator.onLine===false?'offline':'error');
    }finally{state.posting=false;syncComposers();}
  }

  async function moderateComment(commentId,decision,event){
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
    if(!commentId)return;
    if(event?.is_own&&!isAdmin()&&parseTime(event.delete_deadline)<=Date.now()){
      setComposerStatus('The five-minute window to remove this comment has expired.','error');
      scheduleRender();
      return;
    }
    const client=resolveClient();if(!client)return;
    let reason=null;
    if(!event?.is_own&&isAdmin()){
      reason=prompt('Enter the Admin reason for removing this comment:','');
      if(!String(reason||'').trim())return;
    }else if(!confirm('Remove this Live Feed comment? It cannot be restored in the feed.'))return;
    setComposerStatus('Removing comment…');
    try{
      const {data,error}=await client.rpc('delete_live_feed_comment_v1',{p_comment_id:commentId,p_reason:reason});
      if(error)throw error;
      const result=normalizeRpcResponse(data);if(!result?.ok)throw new Error(result?.error||'comment_delete_failed');
      state.events=state.events.filter(item=>String(item.comment_id||'')!==String(commentId));scheduleRender();setComposerStatus('Comment removed.','ok');
      window.dispatchEvent(new CustomEvent('mccoy-live-feed-comments-changed',{detail:{eventType:'DELETE',commentId}}));
    }catch(error){console.error('Live Feed comment delete failed',error);setComposerStatus(friendlyError(error),'error');}
  }

  function saleCelebrationActive(){return document.getElementById('liveWinCelebration')?.classList.contains('show');}
  function clearCommentToastForSale(){toastHost.replaceChildren();}
  function toastSeenKey(row){return `mccoy-live-feed-comment:${row?.id||row?.comment_id||''}`;}
  function wasToastSeen(key){try{return sessionStorage.getItem(key)==='1';}catch{return false;}}
  function markToastSeen(key){try{sessionStorage.setItem(key,'1');}catch(_){}}

  function enqueueCommentToast(row){
    const ownById=state.userId&&String(row?.author_user_id||'')===String(state.userId);
    const ownByEmail=state.email&&String(row?.author_email||'').trim().toLowerCase()===state.email;
    if(!row||row.moderation_status!=='approved'||ownById||ownByEmail)return;
    const created=parseTime(row.published_at||row.created_at);if(!created||Date.now()-created>COMMENT_TOAST_MAX_AGE_MS)return;
    const key=toastSeenKey(row);if(wasToastSeen(key))return;markToastSeen(key);
    if(state.toastQueue.length>=3){state.collapsedToasts+=1;return;}
    state.toastQueue.push({row,enqueuedAt:Date.now()});drainToasts();
  }
  async function drainToasts(){
    if(state.toastRunning)return;state.toastRunning=true;
    try{
      while(state.toastQueue.length||state.collapsedToasts){
        while(saleCelebrationActive())await wait(250);
        let row=null;
        if(state.toastQueue.length){const next=state.toastQueue.shift();if(Date.now()-next.enqueuedAt>COMMENT_TOAST_MAX_AGE_MS)continue;row=next.row;}
        const toast=document.createElement('div');toast.className='live-feed-comment-toast';
        const author=document.createElement('strong'),message=document.createElement('span');
        if(row){author.textContent=String(row.author_display_name||'Team member');message.textContent=clipped(row.body);}
        else{author.textContent='Live Feed';message.textContent=`${state.collapsedToasts} new comments`;state.collapsedToasts=0;}
        toast.append(author,message);toastHost.replaceChildren(toast);
        await wait(COMMENT_TOAST_DURATION_MS);toast.remove();await wait(120);
      }
    }finally{state.toastRunning=false;}
  }

  function commentEventFromRow(row){
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

  function onCommentRealtime(payload){
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

  async function startRealtime(){
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

  async function initialize(){
    const access=currentAccess();if(state.initialized||!access?.active)return;
    state.initialized=true;state.organizationId=access.organization_id||null;state.role=access.role||null;state.email=String(currentUser()?.email||access.email||'').toLowerCase();state.userId=currentUser()?.id||access.auth_user_id||null;
    const client=resolveClient();
    if(client&&!state.userId){try{const {data}=await client.auth.getSession();state.userId=data?.session?.user?.id||null;state.email=state.email||String(data?.session?.user?.email||'').toLowerCase();}catch(_){}}
    loadDraftState();findMounts();syncComposers();await startRealtime();await loadFeed();
  }

  document.addEventListener('click',event=>{
    const moderation=event.target?.closest?.('.live-feed-moderate');if(moderation){event.preventDefault();const commentId=moderation.dataset.commentId,eventItem=state.events.find(item=>String(item.comment_id||'')===String(commentId));moderateComment(commentId,moderation.dataset.decision,eventItem);return;}
    const remove=event.target?.closest?.('.live-feed-delete');if(remove){event.preventDefault();const commentId=remove.dataset.commentId,eventItem=state.events.find(item=>String(item.comment_id||'')===String(commentId));deleteComment(commentId,eventItem);return;}
    if(event.target?.closest?.('#salesRefreshBtn,#repDashboardSalesRefresh'))setTimeout(()=>loadFeed({quiet:true}),0);
  });
  window.addEventListener('mccoy-live-sales-changed',()=>{clearCommentToastForSale();loadFeed({quiet:true});});
  window.addEventListener('mccoy-sale-saved',()=>loadFeed({quiet:true}));
  window.addEventListener('mccoy-access-ready',initialize);
  window.addEventListener('mccoy-sales-hub-layout-ready',findMounts);
  window.addEventListener('online',()=>{if(state.draft)setComposerStatus('Back online. Your saved draft is ready; press RETRY to post.','ok');});
  window.addEventListener('offline',()=>{if(state.draft)setComposerStatus('Offline — draft saved on this device. Reconnect, then press RETRY.','offline');});
  window.addEventListener('beforeunload',()=>{if(state.channel&&state.client)state.client.removeChannel(state.channel);});

  let attempts=0;const mountPoll=setInterval(()=>{attempts+=1;findMounts();if(attempts>=60)clearInterval(mountPoll);},250);
  const accessPoll=setInterval(()=>{if(currentAccess()){clearInterval(accessPoll);initialize();}},300);

  window.MCCOY_LIVE_FEED={
    refresh:()=>loadFeed(),
    post:postComment,
    findMounts,
    state:()=>({loaded:state.loaded,eventCount:state.events.length,organizationId:state.organizationId,userId:state.userId})
  };
})();
