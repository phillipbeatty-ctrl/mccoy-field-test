// Preview-only mixed Live Feed with explicit server-enforced COMPANY and TEAM scopes.
// Verified sales remain authoritative in sales_feed; comments use dedicated v2 RPCs.
(()=>{
  if(window.MCCOY_LIVE_FEED_V2)return;
  window.MCCOY_LIVE_FEED_V2=true;

  const MAX_COMMENT_LENGTH=280;
  const FEED_LIMIT=100;
  const COMMENT_TOAST_MAX_AGE_MS=15000;
  const COMMENT_TOAST_DURATION_MS=4000;
  const mountState=new Map();
  const state={
    client:null,
    identityKey:null,
    generation:0,
    initialized:false,
    initializing:false,
    authorizationRefreshing:false,
    loading:false,
    reloadQueued:false,
    posting:false,
    events:[],
    context:null,
    scopes:[],
    selectedScope:'company',
    selectedScopeId:null,
    draft:'',
    pendingRequest:null,
    channel:null,
    channelOrganizationId:null,
    realtimeReady:null,
    deleteExpiryTimer:null,
    renderScheduled:false,
    toastQueue:[],
    toastRunning:false,
    collapsedToasts:0
  };

  const style=document.createElement('style');
  style.textContent=`
    .live-feed-preview-heading{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.live-feed-preview-pill{display:inline-flex;align-items:center;padding:2px 7px;border:1px solid #c7d2fe;border-radius:999px;background:#eef2ff;color:#3730a3;font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase}
    .live-feed-composer{display:grid;gap:8px;margin:10px 0 12px;padding:10px;border:1px solid #dbe3ef;border-radius:11px;background:#f8fafc}.live-feed-scope-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.live-feed-scope-row label{font-size:11px;font-weight:900;letter-spacing:.05em;color:#475569}.live-feed-scope-select{min-width:210px;max-width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;color:#0f172a;font:inherit}.live-feed-scope-status{font-size:11px;color:#64748b}
    .live-feed-compose-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:stretch}.live-feed-compose-input{box-sizing:border-box;width:100%;min-height:46px;max-height:132px;resize:vertical;padding:10px 11px;border:1px solid #cbd5e1;border-radius:9px;background:#fff;color:#0f172a;font:inherit;line-height:1.35}.live-feed-compose-input:focus{outline:2px solid rgba(37,99,235,.2);border-color:#2563eb}.live-feed-compose-input:disabled{background:#f1f5f9;color:#64748b}.live-feed-post{min-width:82px;min-height:46px}.live-feed-compose-meta{display:flex;justify-content:space-between;gap:10px;align-items:flex-start;flex-wrap:wrap;font-size:11px;color:#64748b}.live-feed-safety{max-width:780px}.live-feed-compose-status[data-state="error"]{color:#991b1b;font-weight:700}.live-feed-compose-status[data-state="ok"]{color:#166534;font-weight:700}.live-feed-compose-status[data-state="offline"]{color:#92400e;font-weight:700}.live-feed-character-count.over{color:#991b1b;font-weight:800}
    .live-feed-event-list{display:grid}.live-feed-event{padding:11px 0;border-bottom:1px solid #e5e7eb}.live-feed-event:last-child{border-bottom:0}.live-feed-event-head{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}.live-feed-event-identity{display:flex;align-items:center;gap:8px;min-width:0}.live-feed-event-icon{display:grid;place-items:center;flex:0 0 30px;width:30px;height:30px;border-radius:999px;background:#eef2ff;font-size:16px}.live-feed-comment .live-feed-event-icon{background:#f1f5f9;color:#334155;font-size:11px;font-weight:900}.live-feed-event-name{font-size:13px;font-weight:800;color:#0f172a}.live-feed-event-role{margin-left:4px;color:#64748b;font-size:10px;font-weight:700;text-transform:uppercase}.live-feed-event-time{white-space:nowrap;color:#64748b;font-size:10px}.live-feed-badges{display:flex;gap:5px;align-items:center;flex-wrap:wrap;margin-top:3px}.live-feed-scope-pill,.live-feed-moderation-pill{display:inline-flex;padding:2px 6px;border-radius:999px;font-size:9px;font-weight:900;letter-spacing:.05em;text-transform:uppercase}.live-feed-scope-pill{border:1px solid #cbd5e1;background:#f8fafc;color:#475569}.live-feed-moderation-pill.pending{border:1px solid #f59e0b;background:#fffbeb;color:#92400e}.live-feed-moderation-pill.rejected{border:1px solid #fecaca;background:#fef2f2;color:#991b1b}.live-feed-event-message{margin:6px 0 0;color:#1e293b;font-size:13px;line-height:1.42;white-space:pre-wrap;overflow-wrap:anywhere}.live-feed-sale .live-feed-event-message{font-weight:800}.live-feed-secondary{display:grid;gap:3px;margin:6px 0 0 38px;color:#475569;font-size:11px}.live-feed-event-actions{display:flex;justify-content:flex-end;gap:7px;align-items:center;flex-wrap:wrap;margin-top:6px}.live-feed-delete{border:0;background:transparent;color:#64748b;padding:4px 0;font-size:10px;text-decoration:underline;cursor:pointer}.live-feed-delete:disabled{opacity:.55;cursor:wait}.live-feed-moderate{border-radius:7px;padding:5px 8px;font-size:10px;font-weight:800;cursor:pointer}.live-feed-moderate.approve{border:1px solid #86efac;background:#f0fdf4;color:#166534}.live-feed-moderate.reject{border:1px solid #fecaca;background:#fef2f2;color:#991b1b}.live-feed-moderate:disabled{opacity:.55;cursor:wait}.live-feed-empty{padding:12px 0;color:#64748b;font-size:12px}.live-feed-retention{margin-top:8px;color:#64748b;font-size:10px}
    #liveFeedCommentToasts{position:fixed;left:50%;top:max(12px,env(safe-area-inset-top));z-index:180000;width:min(520px,calc(100vw - 24px));transform:translateX(-50%);pointer-events:none}.live-feed-comment-toast{padding:11px 13px;border:1px solid rgba(148,163,184,.8);border-radius:12px;background:rgba(255,255,255,.97);box-shadow:0 14px 34px rgba(15,23,42,.2);color:#0f172a;animation:liveFeedCommentFloat ${COMMENT_TOAST_DURATION_MS}ms ease-out forwards}.live-feed-comment-toast strong{display:block;font-size:12px}.live-feed-comment-toast small{display:block;margin-top:2px;color:#64748b;font-size:10px}.live-feed-comment-toast span{display:-webkit-box;margin-top:3px;overflow:hidden;-webkit-line-clamp:2;-webkit-box-orient:vertical;font-size:12px;line-height:1.35;color:#334155}
    @keyframes liveFeedCommentFloat{0%{opacity:0;transform:translateY(-22px) scale(.98)}12%{opacity:1;transform:translateY(0) scale(1)}74%{opacity:1;transform:translateY(76px) scale(1)}100%{opacity:0;transform:translateY(118px) scale(.99)}}
    @media(max-width:650px){.live-feed-compose-row{grid-template-columns:1fr}.live-feed-post{width:100%}.live-feed-scope-select{width:100%}.live-feed-scope-row{align-items:stretch}}
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
  const isAdmin=()=>normalizedRole(state.context?.role)==='admin';
  const parseTime=value=>{const time=Date.parse(value);return Number.isFinite(time)?time:0;};
  const eventKey=event=>String(event?.event_id||`${event?.event_type||'event'}:${event?.comment_id||event?.id||event?.created_at||''}`);
  const bodyText=value=>String(value||'').replace(/\r\n?/g,'\n').trim();
  const clipped=(value,max=160)=>{const text=String(value||'').replace(/\s+/g,' ').trim();return text.length<=max?text:text.slice(0,max-1)+'…';};
  const currentAccess=()=>window.MCCOY_ACCESS?.access||null;
  const currentUser=()=>window.MCCOY_ACCESS?.user||null;

  function resolveClient(){
    if(state.client)return state.client;
    try{state.client=window.MCCOY_REQUIRE_SUPABASE_CLIENT?.({auth:true,rpc:true,realtime:true})||window.MCCOY_GET_SUPABASE_CLIENT?.({auth:true,rpc:true,realtime:true})||null;}catch(_){/* lexical fallback below */}
    if(state.client)return state.client;
    try{if(typeof sb!=='undefined'&&sb)state.client=sb;}catch(_){/* unavailable until app boot */}
    return state.client;
  }

  function identitySnapshot(){
    const access=currentAccess(),user=currentUser();
    const userId=String(user?.id||access?.auth_user_id||'').trim();
    const email=String(user?.email||access?.email||'').trim().toLowerCase();
    const organizationId=String(access?.organization_id||'').trim();
    const role=normalizedRole(access?.role);
    const active=access?.active===true?'1':'0';
    return {userId,email,organizationId,role,active,key:userId||email?`${userId}|${email}|${organizationId}|${role}|${active}`:''};
  }

  // Empty scope IDs round-trip COMPANY as `company:`; the word `company` is never treated as a UUID.
  function selectedKey(scope=state.selectedScope,scopeId=state.selectedScopeId){return `${scope}:${scopeId||''}`;}
  function storagePrefix(){return `mccoy-live-feed-v2:${state.context?.organization_id||'organization'}:${state.context?.user_id||state.identityKey||'user'}`;}
  function draftKey(){return `${storagePrefix()}:draft:${selectedKey()}`;}
  function pendingKey(){return `${storagePrefix()}:pending:${selectedKey()}`;}
  function selectedScopeKey(){return `${storagePrefix()}:selected-scope`;}
  function readLocal(key,fallback=''){try{return localStorage.getItem(key)??fallback;}catch{return fallback;}}
  function writeLocal(key,value){try{if(value)localStorage.setItem(key,value);else localStorage.removeItem(key);}catch(_){/* storage is optional */}}

  function saveDraftState(){
    if(!state.context)return;
    writeLocal(draftKey(),state.draft);
    writeLocal(pendingKey(),state.pendingRequest?JSON.stringify(state.pendingRequest):'');
  }

  function loadDraftState(){
    state.draft=readLocal(draftKey(),'');
    try{
      const parsed=JSON.parse(readLocal(pendingKey(),'null'));
      state.pendingRequest=parsed&&parsed.id&&typeof parsed.body==='string'&&parsed.scope===state.selectedScope&&String(parsed.scopeId||'')===String(state.selectedScopeId||'')?parsed:null;
    }catch(_){state.pendingRequest=null;}
    if(state.pendingRequest&&state.pendingRequest.body!==bodyText(state.draft)){
      state.pendingRequest=null;
      writeLocal(pendingKey(),'');
    }
  }

  function availableScope(scope,scopeId){
    return state.scopes.find(item=>item.scope===scope&&String(item.scope_id||'')===String(scopeId||''))||null;
  }

  function selectedScope(){return availableScope(state.selectedScope,state.selectedScopeId);}

  function roleDefaultScope(){
    const remembered=readLocal(selectedScopeKey(),'');
    if(remembered){
      const [scope,id='']=remembered.split(':');
      const found=availableScope(scope,id||null);
      if(found)return found;
    }
    if(isAdmin())return availableScope('company',null)||state.scopes[0]||null;
    return state.scopes.find(item=>item.scope==='team'&&item.can_post)||availableScope('company',null)||state.scopes[0]||null;
  }

  function scopeLabel(item){return item?.scope==='team'?`TEAM · ${item.name}`:'COMPANY';}

  function allComposers(){return [...document.querySelectorAll('.live-feed-composer')];}
  function setComposerStatus(message='',status=''){
    for(const composer of allComposers()){
      const element=composer.querySelector('.live-feed-compose-status');
      if(element){element.textContent=message;element.dataset.state=status;}
    }
  }

  function syncComposers({focus=null}={}){
    const selected=selectedScope();
    for(const composer of allComposers()){
      const select=composer.querySelector('.live-feed-scope-select');
      const input=composer.querySelector('.live-feed-compose-input');
      const count=composer.querySelector('.live-feed-character-count');
      const button=composer.querySelector('.live-feed-post');
      const scopeStatus=composer.querySelector('.live-feed-scope-status');
      const safety=composer.querySelector('.live-feed-safety');
      if(select){
        const signature=state.scopes.map(item=>`${selectedKey(item.scope,item.scope_id)}|${item.name}|${item.can_post?'1':'0'}|${item.active===false?'0':'1'}`).join(';');
        if(select.dataset.scopeSignature!==signature){
          select.replaceChildren();
          for(const item of state.scopes){
            const option=new Option(scopeLabel(item),selectedKey(item.scope,item.scope_id));
            if(item.active===false)option.textContent+=' · inactive';
            select.appendChild(option);
          }
          select.dataset.scopeSignature=signature;
        }
        select.value=selectedKey();
        select.disabled=!state.context||state.loading;
      }
      const canPost=!!selected?.can_post;
      if(input&&input!==focus&&input.value!==state.draft)input.value=state.draft;
      if(input){
        input.disabled=!canPost||state.posting;
        input.placeholder=!state.context?'Loading Live Feed access…':canPost?`Write a ${selected?.scope==='team'?'team':'company'} comment…`:'This feed is read-only for your role.';
      }
      const length=Array.from(state.draft).length;
      if(count){count.textContent=`${length}/${MAX_COMMENT_LENGTH}`;count.classList.toggle('over',length>MAX_COMMENT_LENGTH);}
      if(button){button.disabled=!canPost||state.posting||!state.draft.trim()||length>MAX_COMMENT_LENGTH;button.textContent=state.posting?'POSTING…':state.pendingRequest?'RETRY':'POST';}
      if(scopeStatus)scopeStatus.textContent=!state.context?'Resolving server permissions…':canPost?'Posting allowed in this scope.':'Read access only in this scope.';
      if(safety){
        const destination=selected?.scope==='team'?`the ${selected.name} team`:'the company';
        safety.textContent=`Do not post customer names, phone numbers, addresses, account numbers, order information, or other customer data. Free-form comments are text-only, cannot be edited, and remain visible only to you and Admin until an Admin approves them for ${destination}.`;
      }
    }
  }

  function handleDraftInput(input){
    const characters=Array.from(input.value);
    if(characters.length>MAX_COMMENT_LENGTH)input.value=characters.slice(0,MAX_COMMENT_LENGTH).join('');
    state.draft=input.value;
    if(state.pendingRequest&&state.pendingRequest.body!==bodyText(state.draft))state.pendingRequest=null;
    saveDraftState();
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
      const pill=document.createElement('span');pill.className='live-feed-preview-pill';pill.textContent='Company + Team preview';heading.insertAdjacentElement('afterend',pill);
    }
  }

  function createComposer(root){
    const composer=document.createElement('div');
    composer.className='live-feed-composer';
    composer.dataset.liveFeedComposerFor=root.id;

    const scopeRow=document.createElement('div');scopeRow.className='live-feed-scope-row';
    const label=document.createElement('label');label.textContent='LIVE FEED';
    const select=document.createElement('select');select.className='live-feed-scope-select';select.setAttribute('aria-label','Choose Company or Team Live Feed');
    const scopeStatus=document.createElement('span');scopeStatus.className='live-feed-scope-status';
    scopeRow.append(label,select,scopeStatus);

    const row=document.createElement('div');row.className='live-feed-compose-row';
    const input=document.createElement('textarea');input.className='live-feed-compose-input';input.rows=2;input.setAttribute('aria-label','Write a Live Feed comment');
    const post=document.createElement('button');post.type='button';post.className='primary live-feed-post';post.textContent='POST';
    row.append(input,post);

    const meta=document.createElement('div');meta.className='live-feed-compose-meta';
    const left=document.createElement('div');
    const safety=document.createElement('div');safety.className='live-feed-safety';
    const status=document.createElement('div');status.className='live-feed-compose-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
    left.append(safety,status);
    const count=document.createElement('span');count.className='live-feed-character-count';
    meta.append(left,count);

    composer.append(scopeRow,row,meta);
    root.insertAdjacentElement('beforebegin',composer);
    select.addEventListener('change',()=>changeScope(select.value));
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
      if(state.initialized&&!root.querySelector('[data-live-feed-render="v2"]'))scheduleRender();
    });
    observer.observe(root,{childList:true});
    mountState.set(root,{composer,observer});
    syncComposers();
    scheduleRender();
  }

  function findMounts(){document.querySelectorAll('#salesFeed,#dashboardSalesFeed').forEach(ensureMount);}
  function formatTimestamp(value){const date=new Date(value);return Number.isNaN(date.getTime())?'':date.toLocaleString();}
  function initials(name){return String(name||'Member').trim().split(/\s+/).slice(0,2).map(part=>part[0]?.toUpperCase()||'').join('')||'M';}
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
    const badges=document.createElement('div');badges.className='live-feed-badges';
    const scope=document.createElement('span');scope.className='live-feed-scope-pill';scope.textContent=event.scope==='team'?`TEAM · ${event.scope_name||'Team'}`:'COMPANY';badges.appendChild(scope);
    if(type==='comment'&&event.moderation_status&&event.moderation_status!=='approved'){
      const moderation=document.createElement('span');moderation.className=`live-feed-moderation-pill ${event.moderation_status}`;moderation.textContent=event.moderation_status==='pending'?'Pending Admin approval':'Rejected';badges.appendChild(moderation);
    }
    nameWrap.appendChild(badges);
    identity.append(icon,nameWrap);
    const time=document.createElement('time');time.className='live-feed-event-time';time.dateTime=String(event.created_at||'');time.textContent=formatTimestamp(event.created_at);
    head.append(identity,time);
    const message=document.createElement(type==='sale'?'strong':'div');message.className='live-feed-event-message';message.textContent=String(event.message||'');
    article.append(head,message);
    const extra=secondaryMessages(event);
    if(type==='sale'&&extra.length){const list=document.createElement('div');list.className='live-feed-secondary';for(const text of extra){const line=document.createElement('div');line.textContent=text;list.appendChild(line);}article.appendChild(list);}

    const deleteDeadline=parseTime(event?.delete_deadline);
    const deleteAllowed=type==='comment'&&event.can_delete&&(isAdmin()||(event.is_own&&deleteDeadline>Date.now()));
    const moderationAllowed=type==='comment'&&isAdmin()&&event.can_moderate&&event.moderation_status==='pending';
    if(deleteAllowed||moderationAllowed){
      const actions=document.createElement('div');actions.className='live-feed-event-actions';
      if(moderationAllowed){
        const approve=document.createElement('button');approve.type='button';approve.className='live-feed-moderate approve';approve.dataset.commentId=String(event.comment_id||'');approve.dataset.decision='approve';approve.textContent='APPROVE';approve.setAttribute('aria-label',`Approve this comment for ${event.scope_name||event.scope}`);
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
    const selected=selectedScope();
    for(const root of mountState.keys()){
      const scrollTop=root.scrollTop;
      const wrapper=document.createElement('div');wrapper.className='live-feed-event-list';wrapper.dataset.liveFeedRender='v2';
      if(!state.events.length){
        const empty=document.createElement('div');empty.className='live-feed-empty';
        empty.textContent=state.loading?'Loading Live Feed…':`No ${selected?.scope==='team'?'team':'company'} activity in the last 30 days.`;
        wrapper.appendChild(empty);
      }else{
        for(const event of state.events.slice(0,FEED_LIMIT))wrapper.appendChild(buildEventNode(event));
      }
      const retention=document.createElement('div');retention.className='live-feed-retention';
      retention.textContent=selected?.scope==='team'
        ?`Showing up to 100 comments for ${selected.name} from the last 30 days. Verified sales remain in the Company feed and continue to control rankings.`
        :'Showing up to 100 Company events from the last 30 days. Verified sales remain separate from comments and continue to control rankings.';
      wrapper.appendChild(retention);
      root.replaceChildren(wrapper);root.scrollTop=scrollTop;updateHeading(root);
    }

    if(state.deleteExpiryTimer){clearTimeout(state.deleteExpiryTimer);state.deleteExpiryTimer=null;}
    if(!isAdmin()){
      const deadlines=state.events.filter(event=>event?.event_type==='comment'&&event.is_own&&event.can_delete).map(event=>parseTime(event.delete_deadline)).filter(deadline=>deadline>Date.now());
      if(deadlines.length){const nextDeadline=Math.min(...deadlines);state.deleteExpiryTimer=setTimeout(scheduleRender,Math.max(25,nextDeadline-Date.now()+25));}
    }
    syncComposers();
  }

  function scheduleRender(){if(state.renderScheduled)return;state.renderScheduled=true;queueMicrotask(render);}
  function mergeEvent(event){
    if(!event)return;
    const key=eventKey(event),map=new Map(state.events.map(item=>[eventKey(item),item]));map.set(key,event);
    state.events=[...map.values()].sort((left,right)=>parseTime(right.created_at)-parseTime(left.created_at)||eventKey(right).localeCompare(eventKey(left))).slice(0,FEED_LIMIT);
    scheduleRender();
  }

  function normalizeContext(context){
    const teams=Array.isArray(context?.teams)?context.teams:[];
    state.context=context||null;
    state.scopes=[{
      scope:'company',scope_id:null,name:'Company',active:true,can_post:!!context?.can_post_company
    },...teams.map(team=>({
      scope:'team',scope_id:String(team.scope_id||''),name:String(team.name||'Team'),active:team.active!==false,can_post:!!team.can_post
    })).filter(team=>team.scope_id)];
  }

  async function invoke(name,args){
    const client=resolveClient();if(!client)throw new Error('McCoy connection is not ready.');
    const {data,error}=await client.rpc(name,args);if(error)throw error;return data;
  }

  async function loadFeed({scope=state.selectedScope,scopeId=state.selectedScopeId,quiet=false}={}){
    const generation=state.generation;
    if(state.loading){state.reloadQueued=true;return;}
    state.loading=true;if(!quiet)setComposerStatus('Loading Live Feed…');syncComposers();scheduleRender();
    try{
      const data=await invoke('get_live_feed_v2',{p_scope:scope,p_scope_id:scopeId||null,p_limit:FEED_LIMIT,p_before:null});
      if(generation!==state.generation)return;
      if(!data?.ok)throw new Error(data?.error||'live_feed_load_failed');
      normalizeContext(data.context||{});
      const selected=availableScope(scope,scopeId);
      if(!selected){
        const fallback=roleDefaultScope();
        if(!fallback)throw new Error('No authorized Live Feed scope is available.');
        state.selectedScope=fallback.scope;state.selectedScopeId=fallback.scope_id||null;writeLocal(selectedScopeKey(),selectedKey());
        state.loading=false;
        return loadFeed({scope:state.selectedScope,scopeId:state.selectedScopeId});
      }
      state.selectedScope=selected.scope;state.selectedScopeId=selected.scope_id||null;
      state.events=Array.isArray(data.events)?data.events:[];
      if(!quiet)setComposerStatus('');
    }catch(error){
      if(generation!==state.generation)return;
      console.error('Live Feed load failed',error);
      const message=String(error?.message||'Unable to load Live Feed.');
      if(/team_scope_forbidden|auth_email_mismatch|organization_membership_required|active_organization_profile_required|field_coach_access_required|live_feed_role_not_supported/.test(message)){
        state.events=[];scheduleRender();
        if(message.includes('team_scope_forbidden'))setTimeout(refreshAuthorization,0);
      }
      setComposerStatus(message,'error');
    }finally{
      if(generation!==state.generation)return;
      state.loading=false;syncComposers();scheduleRender();
      if(state.reloadQueued){state.reloadQueued=false;setTimeout(()=>loadFeed({quiet:true}),0);}
    }
  }

  async function changeScope(value){
    const [scope,id='']=String(value||'').split(':');
    const next=availableScope(scope,id||null);if(!next)return;
    saveDraftState();
    state.selectedScope=next.scope;state.selectedScopeId=next.scope_id||null;
    writeLocal(selectedScopeKey(),selectedKey());
    state.draft='';state.pendingRequest=null;loadDraftState();state.events=[];syncComposers();scheduleRender();
    await loadFeed();
  }

  function requestIdForDraft(body){
    if(state.pendingRequest&&state.pendingRequest.body===body&&state.pendingRequest.scope===state.selectedScope&&String(state.pendingRequest.scopeId||'')===String(state.selectedScopeId||''))return state.pendingRequest.id;
    const id=globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(16).slice(2)}`;
    state.pendingRequest={id,body,scope:state.selectedScope,scopeId:state.selectedScopeId||null};saveDraftState();return id;
  }

  async function postComment(){
    const generation=state.generation;
    const selected=selectedScope(),body=bodyText(state.draft);
    if(state.posting||!selected?.can_post)return;
    if(!body){setComposerStatus('Write a comment before posting.','error');return;}
    if(Array.from(body).length>MAX_COMMENT_LENGTH){setComposerStatus('Comment is longer than 280 characters.','error');return;}
    if(navigator.onLine===false){setComposerStatus('Offline — draft saved. Reconnect, then press RETRY.','offline');return;}
    const requestId=requestIdForDraft(body);
    state.posting=true;syncComposers();setComposerStatus(`Submitting to ${scopeLabel(selected)} for Admin review…`);
    try{
      const data=await invoke('post_live_feed_comment_v2',{p_scope:selected.scope,p_scope_id:selected.scope_id||null,p_body:body,p_client_request_id:requestId});
      if(generation!==state.generation)return;
      if(!data?.ok)throw new Error(data?.error||'comment_post_failed');
      mergeEvent(data.event);
      state.draft='';state.pendingRequest=null;saveDraftState();
      setComposerStatus(`Submitted to ${scopeLabel(selected)}. It remains visible only to you and Admin until approved.`,'ok');
      await loadFeed({quiet:true});
    }catch(error){
      if(generation!==state.generation)return;
      console.error('Live Feed comment failed',error);
      setComposerStatus(error?.message||'Unable to post. Your draft and request ID were preserved; press RETRY.','error');
    }finally{if(generation===state.generation){state.posting=false;syncComposers();}}
  }

  async function moderateComment(button){
    const generation=state.generation;
    if(button.dataset.busy==='1'||!isAdmin())return;
    const commentId=button.dataset.commentId,decision=button.dataset.decision;
    if(!commentId||!['approve','reject'].includes(decision))return;
    let reason='';
    if(decision==='approve'){
      if(!confirm('Approve this comment for its selected Company or Team feed? By continuing, you certify that it contains no customer information.'))return;
      reason=prompt('Record the moderation reason:','Reviewed: no customer data observed')||'';
    }else{
      reason=prompt('Enter the reason for rejecting this comment:','')||'';
    }
    if(reason.trim().length<3){setComposerStatus('A moderation reason is required.','error');return;}
    button.dataset.busy='1';button.disabled=true;button.textContent=decision==='approve'?'APPROVING…':'REJECTING…';
    try{
      const data=await invoke('moderate_live_feed_comment_v2',{p_comment_id:commentId,p_decision:decision,p_reason:reason.trim(),p_certify_no_customer_data:decision==='approve'});
      if(generation!==state.generation)return;
      if(!data?.ok)throw new Error(data?.error||'comment_moderation_failed');
      mergeEvent(data.event);setComposerStatus(decision==='approve'?'Comment approved for its server-enforced scope.':'Comment rejected and kept out of shared feeds.','ok');
      await loadFeed({quiet:true});
    }catch(error){if(generation===state.generation){console.error('Live Feed moderation failed',error);setComposerStatus(error?.message||'Unable to moderate this comment.','error');}}
    finally{if(generation===state.generation){delete button.dataset.busy;button.disabled=false;button.textContent=decision==='approve'?'APPROVE':'REJECT';}}
  }

  async function deleteComment(button){
    const generation=state.generation;
    if(button.dataset.busy==='1')return;
    const commentId=button.dataset.commentId,event=state.events.find(item=>String(item.comment_id||'')===String(commentId||''));if(!commentId)return;
    let reason=null;
    if(isAdmin()&&!event?.is_own){reason=prompt('Enter the Admin reason for removing this comment:','')||'';if(reason.trim().length<3){setComposerStatus('An Admin deletion reason is required.','error');return;}}
    else if(!confirm('Remove this comment? The audit record will be preserved.'))return;
    button.dataset.busy='1';button.disabled=true;button.textContent='REMOVING…';
    try{
      const data=await invoke('delete_live_feed_comment_v2',{p_comment_id:commentId,p_reason:reason?.trim()||null});
      if(generation!==state.generation)return;
      if(!data?.ok)throw new Error(data?.error||'comment_delete_failed');
      state.events=state.events.filter(item=>String(item.comment_id||'')!==String(commentId));scheduleRender();setComposerStatus('Comment removed. Audit evidence was preserved.','ok');
    }catch(error){if(generation===state.generation){console.error('Live Feed deletion failed',error);setComposerStatus(error?.message||'Unable to remove this comment.','error');}}
    finally{if(generation===state.generation){delete button.dataset.busy;button.disabled=false;button.textContent=event?.is_own?'Remove comment':'Remove as Admin';}}
  }

  function toastSeenKey(row){return `mccoy-live-feed-v2-toast:${row.id}:${row.published_at||''}`;}
  function toastWasSeen(key){try{return sessionStorage.getItem(key)==='1';}catch{return false;}}
  function markToastSeen(key){try{sessionStorage.setItem(key,'1');}catch(_){/* optional */}}
  function saleCelebrationActive(){return !!document.getElementById('liveWinCelebration')?.classList.contains('show');}

  async function drainToasts(){
    if(state.toastRunning)return;state.toastRunning=true;
    while(state.toastQueue.length||state.collapsedToasts){
      while(saleCelebrationActive())await wait(250);
      if(state.collapsedToasts){
        const count=state.collapsedToasts;state.collapsedToasts=0;
        const toast=document.createElement('div');toast.className='live-feed-comment-toast';toast.innerHTML=`<strong>Live Feed</strong><span>${count} additional comments were approved.</span>`;toastHost.replaceChildren(toast);await wait(COMMENT_TOAST_DURATION_MS);toastHost.replaceChildren();continue;
      }
      const row=state.toastQueue.shift();if(!row)continue;
      const toast=document.createElement('div');toast.className='live-feed-comment-toast';
      const title=document.createElement('strong');title.textContent=String(row.author_display_name||'Team member');
      const scope=document.createElement('small');scope.textContent=row.scope==='team'?'Team comment':'Company comment';
      const body=document.createElement('span');body.textContent=clipped(row.body,180);
      toast.append(title,scope,body);toastHost.replaceChildren(toast);await wait(COMMENT_TOAST_DURATION_MS);toastHost.replaceChildren();await wait(120);
    }
    state.toastRunning=false;
  }

  function queueToast(row){
    if(!row||row.moderation_status!=='approved'||String(row.author_user_id||'')===String(state.context?.user_id||''))return;
    if(Date.now()-parseTime(row.published_at)>COMMENT_TOAST_MAX_AGE_MS)return;
    const key=toastSeenKey(row);if(toastWasSeen(key))return;markToastSeen(key);
    if(state.toastQueue.length>=3)state.collapsedToasts+=1;else state.toastQueue.push(row);
    drainToasts();
  }

  function rowMatchesSelected(row){return row?.scope===state.selectedScope&&String(row?.scope_id||'')===String(state.selectedScopeId||'');}
  function onRealtimeChange(payload){
    const row=payload?.new||payload?.old||null;if(!row)return;
    if((payload.eventType==='INSERT'||payload.eventType==='UPDATE')&&row.moderation_status==='approved')queueToast(row);
    if(rowMatchesSelected(row))loadFeed({quiet:true});
  }

  function startRealtime(){
    const generation=state.generation;
    const client=resolveClient(),organizationId=String(state.context?.organization_id||'');
    if(!client||!organizationId)return Promise.resolve(false);
    if(state.channel&&state.channelOrganizationId===organizationId)return state.realtimeReady||Promise.resolve(true);
    if(state.channel){try{client.removeChannel(state.channel);}catch(_){/* ignore */}}
    state.channelOrganizationId=organizationId;
    state.realtimeReady=new Promise(resolve=>{
      let settled=false;const finish=value=>{if(settled)return;settled=true;resolve(value);};
      state.channel=client.channel(`mccoy-live-feed-v2:${organizationId}:${state.context?.user_id||'user'}`)
        .on('postgres_changes',{event:'*',schema:'public',table:'live_feed_comments',filter:`organization_id=eq.${organizationId}`},payload=>{if(generation===state.generation)onRealtimeChange(payload);})
        .subscribe(status=>{if(generation!==state.generation){finish(false);return;}if(status==='SUBSCRIBED')finish(true);else if(['CHANNEL_ERROR','TIMED_OUT','CLOSED'].includes(status))finish(false);});
      setTimeout(()=>finish(false),5000);
    });
    return state.realtimeReady;
  }

  function resetForIdentity(nextIdentityKey=''){
    saveDraftState();
    state.generation+=1;
    const client=resolveClient();if(state.channel&&client){try{client.removeChannel(state.channel);}catch(_){/* ignore */}}
    if(state.deleteExpiryTimer)clearTimeout(state.deleteExpiryTimer);
    state.identityKey=nextIdentityKey;state.initialized=false;state.initializing=false;state.authorizationRefreshing=false;state.loading=false;state.reloadQueued=false;state.posting=false;state.events=[];state.context=null;state.scopes=[];state.selectedScope='company';state.selectedScopeId=null;state.draft='';state.pendingRequest=null;state.channel=null;state.channelOrganizationId=null;state.realtimeReady=null;state.deleteExpiryTimer=null;state.toastQueue=[];state.collapsedToasts=0;toastHost.replaceChildren();
    setComposerStatus('');syncComposers();scheduleRender();
  }

  async function refreshAuthorization(){
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

  async function initialize(){
    const identity=identitySnapshot(),access=currentAccess();
    if(!access?.active||!identity.key)return;
    if(state.identityKey&&state.identityKey!==identity.key)resetForIdentity(identity.key);
    if(state.initialized||state.initializing)return;
    state.identityKey=identity.key;state.initializing=true;const generation=state.generation;findMounts();syncComposers();
    try{
      const bootstrap=await invoke('get_live_feed_v2',{p_scope:'company',p_scope_id:null,p_limit:FEED_LIMIT,p_before:null});
      if(generation!==state.generation)return;
      if(!bootstrap?.ok)throw new Error(bootstrap?.error||'live_feed_bootstrap_failed');
      normalizeContext(bootstrap.context||{});
      const initial=roleDefaultScope()||availableScope('company',null);
      if(!initial)throw new Error('No authorized Live Feed scope is available.');
      state.selectedScope=initial.scope;state.selectedScopeId=initial.scope_id||null;writeLocal(selectedScopeKey(),selectedKey());
      loadDraftState();state.events=[];syncComposers();scheduleRender();
      await startRealtime();
      if(generation!==state.generation)return;
      await loadFeed({scope:state.selectedScope,scopeId:state.selectedScopeId});
      if(generation!==state.generation)return;
      state.initialized=true;
    }catch(error){if(generation===state.generation){console.error('Live Feed initialization failed',error);setComposerStatus(error?.message||'Unable to initialize Live Feed.','error');}}
    finally{if(generation===state.generation){state.initializing=false;syncComposers();}}
  }

  document.addEventListener('click',event=>{
    const moderate=event.target?.closest?.('.live-feed-moderate');if(moderate){event.preventDefault();moderateComment(moderate);return;}
    const remove=event.target?.closest?.('.live-feed-delete');if(remove){event.preventDefault();deleteComment(remove);}
  });
  window.addEventListener('mccoy-live-sales-changed',()=>{if(state.selectedScope==='company')loadFeed({quiet:true});});
  window.addEventListener('mccoy-access-ready',()=>{
    const identity=identitySnapshot();
    if(!currentAccess()?.active){resetForIdentity('');return;}
    if(state.identityKey&&identity.key&&state.identityKey!==identity.key){resetForIdentity(identity.key);initialize();return;}
    if(state.initialized){refreshAuthorization();return;}
    initialize();
  });
  window.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&state.initialized)refreshAuthorization();});
  window.addEventListener('focus',()=>{if(state.initialized)refreshAuthorization();});
  window.addEventListener('mccoy-account-switch-start',()=>resetForIdentity(''));
  window.addEventListener('mccoy-logout',()=>resetForIdentity(''));
  window.addEventListener('online',()=>{setComposerStatus('Back online. Press RETRY to submit any preserved draft.','ok');syncComposers();});
  window.addEventListener('offline',()=>setComposerStatus('Offline — drafts remain on this device until you explicitly retry.','offline'));
  window.addEventListener('beforeunload',()=>{if(state.channel&&resolveClient())resolveClient().removeChannel(state.channel);});

  const poll=setInterval(()=>{findMounts();if(currentAccess()?.active&&resolveClient()){clearInterval(poll);initialize();}},300);
  setTimeout(()=>clearInterval(poll),20000);
})();
