// COMMS page: where the falling rep-camaraderie messages (app-rep-comms-feed.js)
// can actually be browsed and replied to. The falling overlay is the ephemeral,
// app-wide broadcast display; this page is the compose/browse surface, and is
// deliberately its own page rather than living on Live Wins, which continues to
// show only sale celebrations -- no user message is ever mixed into that feed.
//
// Visibility: a non-admin only sees this page at all when comms is enabled
// for them (both org-wide and personally). An admin always sees it -- even
// with everything toggled off -- specifically so the org-wide "off" switch
// can never lock the admin out of the controls needed to turn it back on.
// Admin-only org-wide and per-rep toggles render inside the page itself.
(function(){
  const css=document.createElement('style');css.textContent=`
  .comms-wins-strip{display:flex;gap:8px;overflow-x:auto;padding-bottom:8px;margin-bottom:10px}
  .comms-win-chip{flex:0 0 auto;display:flex;flex-direction:column;gap:4px;padding:8px 12px;border:1px solid #e5e7eb;border-radius:12px;background:#f8faff;cursor:pointer;font-size:12px;text-align:left}
  .comms-win-chip strong{font-size:12px}
  .comms-win-chip.selected{border-color:#2563eb;background:#eff6ff}
  .comms-reply-banner{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 12px;border-radius:10px;background:#eff6ff;border:1px solid #bfdbfe;font-size:12px;margin-bottom:8px}
  .comms-reply-banner button{background:none;border:0;color:#2563eb;font-weight:800;cursor:pointer}
  .comms-feed{display:flex;flex-direction:column-reverse;gap:8px;max-height:52vh;overflow-y:auto;padding:4px 2px;margin-bottom:10px}
  .comms-message{padding:9px 12px;border:1px solid #e5e7eb;border-radius:12px;background:#fff}
  .comms-message .comms-meta{display:flex;justify-content:space-between;gap:8px;font-size:11px;color:#6b7280;margin-bottom:3px}
  .comms-message .comms-reply-context{font-size:11px;color:#2563eb;margin-bottom:3px}
  .comms-message-reply-link{background:none;border:0;color:#6b7280;font-size:11px;text-decoration:underline;cursor:pointer;padding:0;margin-top:4px}
  .comms-compose{display:flex;gap:8px;position:sticky;bottom:0;background:#fff;padding-top:6px}
  .comms-compose input{flex:1;padding:11px 12px;border:1px solid #d1d5db;border-radius:10px;font-size:14px}
  .comms-compose button{white-space:nowrap}
  .comms-empty{color:#6b7280;font-size:13px;padding:12px 0}
  .comms-off-notice{padding:10px 12px;border-radius:10px;background:#fff7ed;border:1px solid #fdba74;color:#9a3412;font-size:13px;margin-bottom:10px}
  .comms-admin-panel{margin-top:16px;padding-top:14px;border-top:1px solid #e5e7eb}
  .comms-admin-org-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;border:1px solid #e5e7eb;border-radius:10px;margin-bottom:10px;background:#f9fafb}
  .comms-admin-rep-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 10px;border-bottom:1px solid #f1f5f9;font-size:13px}
  .comms-admin-rep-row:last-child{border-bottom:0}
  .comms-toggle{position:relative;display:inline-block;width:40px;height:22px;flex:0 0 auto}
  .comms-toggle input{opacity:0;width:0;height:0}
  .comms-toggle-track{position:absolute;inset:0;background:#d1d5db;border-radius:999px;cursor:pointer;transition:background .15s}
  .comms-toggle-track::before{content:'';position:absolute;left:2px;top:2px;width:18px;height:18px;background:#fff;border-radius:50%;transition:transform .15s}
  .comms-toggle input:checked+.comms-toggle-track{background:#16a34a}
  .comms-toggle input:checked+.comms-toggle-track::before{transform:translateX(18px)}
  .comms-toggle input:disabled+.comms-toggle-track{opacity:.5;cursor:default}
  `;document.head.appendChild(css);

  const main=document.querySelector('main.main'),settings=document.getElementById('settings'),nav=document.querySelector('.sidebar nav');
  if(!main||!nav)return;
  const navButton=document.createElement('button');navButton.id='commsPageButton';navButton.type='button';navButton.className='nav-btn';navButton.dataset.view='comms';navButton.setAttribute('aria-controls','comms');navButton.textContent='COMMS';navButton.hidden=true;
  const salesHubButton=nav.querySelector('[data-view="field"]');
  if(salesHubButton)salesHubButton.insertAdjacentElement('afterend',navButton);else nav.appendChild(navButton);

  const page=document.createElement('section');page.id='comms';page.className='view';
  page.innerHTML=`<div class="card"><div class="card-head"><div><h2>COMMS</h2><p class="muted">Congratulate reps and build camaraderie. Messages fall across every screen for a few seconds when sent -- this page is where you can browse and reply.</p></div><button id="commsRefresh" class="assign-btn">Refresh</button></div>
  <div id="commsOffNotice" class="comms-off-notice" hidden></div>
  <div id="commsRecentWins" class="comms-wins-strip"></div>
  <div id="commsReplyBanner" class="comms-reply-banner" hidden><span id="commsReplyBannerText"></span><button id="commsReplyClear" type="button">Cancel reply</button></div>
  <div id="commsFeed" class="comms-feed"><div class="comms-empty">Loading recent messages…</div></div>
  <div id="commsComposeRow" class="comms-compose"><input id="commsInput" type="text" maxlength="240" placeholder="Say something nice…" aria-label="Message"><button id="commsSend" class="primary">SEND</button></div>
  <div id="commsSendMessage" class="muted small" role="status" aria-live="polite" style="margin-top:6px"></div>
  <div id="commsAdminPanel" class="comms-admin-panel" hidden>
    <h3>Admin controls</h3>
    <div class="comms-admin-org-row"><span>Enable COMMS for the whole organization</span><label class="comms-toggle"><input id="commsAdminOrgToggle" type="checkbox"><span class="comms-toggle-track"></span></label></div>
    <div id="commsAdminRepList"></div>
  </div>
  </div>`;
  if(settings)main.insertBefore(page,settings);else main.appendChild(page);

  const byId=id=>document.getElementById(id);
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const timeAgo=iso=>{const seconds=Math.max(0,Math.floor((Date.now()-new Date(iso).getTime())/1000));if(seconds<60)return'just now';const mins=Math.floor(seconds/60);if(mins<60)return`${mins}m ago`;const hrs=Math.floor(mins/60);if(hrs<24)return`${hrs}h ago`;return`${Math.floor(hrs/24)}d ago`;};

  let messages=[],recentWins=[],replyTarget=null,loaded=false,channel=null,commsStatus=null;

  function applyStatusToUI(){
    const notice=byId('commsOffNotice'),compose=byId('commsComposeRow'),adminPanel=byId('commsAdminPanel');
    const canSend=!!commsStatus?.enabled;
    byId('commsInput').disabled=!canSend;byId('commsSend').disabled=!canSend;
    compose.style.opacity=canSend?'1':'.5';
    if(!canSend){
      notice.hidden=false;
      notice.textContent=!commsStatus?.org_enabled
        ?'COMMS is currently turned off for the whole organization.'
        :'COMMS is currently turned off for your account.';
    }else notice.hidden=true;
    adminPanel.hidden=!commsStatus?.is_admin;
  }

  function renderWins(){
    const strip=byId('commsRecentWins');
    if(!recentWins.length){strip.innerHTML='';return;}
    strip.innerHTML=recentWins.map(win=>`<button type="button" class="comms-win-chip${replyTarget?.type==='win'&&replyTarget.id===win.id?' selected':''}" data-win-id="${win.id}"><strong>${esc(win.rep_name||'Rep')}</strong><span>${esc(win.isp||'Sale')}${win.internet_product?' · '+esc(win.internet_product):''}</span></button>`).join('');
    strip.querySelectorAll('.comms-win-chip').forEach(chip=>chip.onclick=()=>{
      const winId=Number(chip.dataset.winId);
      const win=recentWins.find(w=>w.id===winId);
      setReplyTarget(win?{type:'win',id:winId,label:`${win.rep_name||'that'} sale`}:null);
    });
  }

  function setReplyTarget(target){
    replyTarget=target;
    const banner=byId('commsReplyBanner');
    if(target){banner.hidden=false;byId('commsReplyBannerText').textContent=`Replying to ${target.label}`;}
    else banner.hidden=true;
    renderWins();
  }
  byId('commsReplyClear').onclick=()=>setReplyTarget(null);

  function renderFeed(){
    const feed=byId('commsFeed');
    if(!messages.length){feed.innerHTML='<div class="comms-empty">No messages yet. Be the first to say something.</div>';return;}
    feed.innerHTML=messages.map(msg=>{
      const replyContext=msg.reply_to_sale_rep_name?`<div class="comms-reply-context">Replying to ${esc(msg.reply_to_sale_rep_name)}'s ${esc(msg.reply_to_sale_isp||'sale')}</div>`:'';
      return `<div class="comms-message"><div class="comms-meta"><strong>${esc(msg.sender_name||'Rep')}</strong><span>${timeAgo(msg.created_at)}</span></div>${replyContext}<div>${esc(msg.message||'')}</div><button type="button" class="comms-message-reply-link" data-message-id="${msg.id}">Reply</button></div>`;
    }).join('');
    feed.querySelectorAll('.comms-message-reply-link').forEach(link=>link.onclick=()=>{
      const messageId=Number(link.dataset.messageId);
      const msg=messages.find(m=>m.id===messageId);
      setReplyTarget(msg?{type:'message',id:messageId,label:`${msg.sender_name||'that'} message`}:null);
      byId('commsInput').focus();
    });
  }

  function renderAdminReps(roster){
    const list=byId('commsAdminRepList');
    if(!roster.length){list.innerHTML='<div class="comms-empty">No reps found.</div>';return;}
    list.innerHTML=roster.map(rep=>`<div class="comms-admin-rep-row"><span>${esc(rep.display_name||rep.email)}${rep.role?` <span class="muted">(${esc(rep.role)})</span>`:''}</span><label class="comms-toggle"><input type="checkbox" data-rep-email="${esc(rep.email)}" ${rep.comms_enabled?'checked':''}><span class="comms-toggle-track"></span></label></div>`).join('');
    list.querySelectorAll('input[data-rep-email]').forEach(input=>input.addEventListener('change',async()=>{
      const email=input.dataset.repEmail,enabled=input.checked;
      input.disabled=true;
      try{
        const {error}=await sb.rpc('admin_set_comms_rep_enabled',{p_rep_email:email,p_enabled:enabled});
        if(error)throw error;
      }catch(error){
        console.error('Set rep comms toggle failed',error);
        input.checked=!enabled;
      }finally{input.disabled=false;}
    }));
  }

  async function loadAdminPanel(){
    if(!commsStatus?.is_admin)return;
    byId('commsAdminOrgToggle').checked=!!commsStatus.org_enabled;
    try{
      const {data,error}=await sb.rpc('admin_list_comms_rep_status');
      if(error)throw error;
      renderAdminReps(data||[]);
    }catch(error){console.error('Load comms admin roster failed',error);}
  }
  byId('commsAdminOrgToggle').addEventListener('change',async event=>{
    const enabled=event.target.checked;
    event.target.disabled=true;
    try{
      const {error}=await sb.rpc('admin_set_comms_org_enabled',{p_enabled:enabled});
      if(error)throw error;
      commsStatus.org_enabled=enabled;
      commsStatus.enabled=enabled&&commsStatus.rep_enabled;
      applyStatusToUI();
    }catch(error){
      console.error('Set org comms toggle failed',error);
      event.target.checked=!enabled;
    }finally{event.target.disabled=false;}
  });

  async function loadAll(){
    const status=byId('commsSendMessage');
    try{
      const [feedResult,winsResult]=await Promise.all([
        sb.rpc('list_recent_rep_comms_messages',{p_limit:50}),
        sb.rpc('list_recent_live_wins_for_reply',{p_limit:15})
      ]);
      if(feedResult.error)throw feedResult.error;
      if(winsResult.error)throw winsResult.error;
      messages=feedResult.data||[];
      recentWins=winsResult.data||[];
      renderFeed();renderWins();loaded=true;
    }catch(error){
      console.error('COMMS load failed',error);
      status.textContent='Unable to load COMMS right now. Try refreshing.';
    }
    await loadAdminPanel();
  }

  async function sendMessage(){
    const input=byId('commsInput'),status=byId('commsSendMessage'),button=byId('commsSend');
    const text=String(input.value||'').trim();
    if(!text){status.textContent='Type a message first.';return;}
    button.disabled=true;
    try{
      const params={p_message:text};
      if(replyTarget?.type==='win')params.p_reply_to_sales_feed_id=replyTarget.id;
      if(replyTarget?.type==='message')params.p_reply_to_message_id=replyTarget.id;
      const {error}=await sb.rpc('send_rep_comms_message',params);
      if(error)throw error;
      input.value='';status.textContent='';setReplyTarget(null);
    }catch(error){
      console.error('Send comms message failed',error);
      status.textContent=error?.message==='sending_too_fast'?'Sending a bit fast -- wait a couple seconds and try again.':error?.message==='message_length_invalid'?'Message must be 1-240 characters.':error?.message==='comms_disabled_for_organization'||error?.message==='comms_disabled_for_rep'?'COMMS is currently turned off. Contact an admin.':'Unable to send. Try again.';
    }finally{button.disabled=!commsStatus?.enabled?true:false;}
  }
  byId('commsSend').onclick=sendMessage;
  byId('commsInput').addEventListener('keydown',event=>{if(event.key==='Enter')sendMessage();});
  byId('commsRefresh').onclick=loadAll;

  function startRealtime(){
    if(channel)return;
    channel=sb.channel('mccoy-comms-page')
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'rep_comms_messages'},payload=>{
        if(!payload?.new)return;
        messages=[payload.new,...messages].slice(0,50);
        renderFeed();
      })
      .subscribe();
  }
  window.addEventListener('beforeunload',()=>{if(channel)sb.removeChannel(channel);});

  function showPage(){
    document.querySelectorAll('.view').forEach(view=>view.classList.toggle('active',view===page));
    document.querySelectorAll('.nav-btn').forEach(button=>button.classList.toggle('active',button===navButton));
    const title=byId('pageTitle');if(title)title.textContent='COMMS';
    startRealtime();
    if(!loaded)loadAll();
  }
  navButton.addEventListener('click',event=>{event.preventDefault();setTimeout(showPage,0);});

  let statusChecked=false;
  async function checkVisibility(){
    if(statusChecked||!window.MCCOY_ACCESS?.access?.active)return;
    statusChecked=true;
    try{
      const {data,error}=await sb.rpc('get_rep_comms_status');
      if(error)throw error;
      commsStatus=data;
      navButton.hidden=!(data?.is_admin||data?.enabled);
      applyStatusToUI();
    }catch(error){
      console.error('Comms visibility check failed',error);
    }
  }
  window.addEventListener('mccoy-access-ready',checkVisibility);
  const poll=setInterval(()=>{if(window.MCCOY_ACCESS?.access){clearInterval(poll);checkVisibility();}},300);
  checkVisibility();
})();
