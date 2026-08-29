// Admin-only daily field-session start and termination metrics.
// Uses existing authoritative test_sessions/test_events data through a protected Edge Function.
(function(){
  if(window.MCCOY_ADMIN_DAILY_SESSION_METRICS)return;
  window.MCCOY_ADMIN_DAILY_SESSION_METRICS=true;

  const TIME_ZONE='America/Los_Angeles';
  const byId=id=>document.getElementById(id);
  const state={loadedDate:'',busy:false,refreshTimer:null};

  function pacificDate(value=new Date()){
    const parts=new Intl.DateTimeFormat('en-US',{timeZone:TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(value);
    const get=type=>parts.find(part=>part.type===type)?.value||'';
    return `${get('year')}-${get('month')}-${get('day')}`;
  }

  function addDays(value,days){
    const [year,month,day]=String(value).split('-').map(Number),date=new Date(Date.UTC(year,month-1,day));
    date.setUTCDate(date.getUTCDate()+days);
    return date.toISOString().slice(0,10);
  }

  function formatTime(value){
    if(!value)return '—';
    const date=new Date(value);if(Number.isNaN(date.getTime()))return '—';
    return new Intl.DateTimeFormat('en-US',{timeZone:TIME_ZONE,month:'numeric',day:'numeric',hour:'numeric',minute:'2-digit',second:'2-digit'}).format(date);
  }

  function formatDuration(seconds){
    const total=Math.max(0,Number(seconds||0));
    const hours=Math.floor(total/3600),minutes=Math.floor((total%3600)/60),secs=Math.floor(total%60);
    if(hours)return `${hours}h ${minutes}m`;
    if(minutes)return `${minutes}m ${secs}s`;
    return `${secs}s`;
  }

  function ensureStyles(){
    if(byId('adminDailySessionStyles'))return;
    const style=document.createElement('style');style.id='adminDailySessionStyles';style.textContent=`
      #adminDailySessionPanel{margin-top:14px}
      .admin-session-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap}
      .admin-session-calendar{display:flex;align-items:end;gap:7px;flex-wrap:wrap}
      .admin-session-calendar label{display:grid;gap:4px;font-size:11px;font-weight:800;color:#475569}
      .admin-session-calendar input{min-height:38px;padding:7px 9px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;font:inherit}
      .admin-session-calendar button{min-height:38px;padding:7px 10px}
      .admin-session-summary{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;margin:12px 0}
      .admin-session-metric{padding:11px;border:1px solid #e2e8f0;border-radius:10px;background:#f8fafc}
      .admin-session-metric span{display:block;font-size:10px;color:#64748b}
      .admin-session-metric strong{display:block;margin-top:4px;font-size:20px;color:#0f172a}
      .admin-session-table-wrap{overflow:auto;max-height:440px;border:1px solid #e2e8f0;border-radius:10px}
      .admin-session-table{width:100%;border-collapse:collapse;min-width:860px}
      .admin-session-table th,.admin-session-table td{text-align:left;padding:9px 10px;border-bottom:1px solid #eef2f7;vertical-align:top;font-size:11px}
      .admin-session-table th{position:sticky;top:0;z-index:1;background:#fff;color:#64748b}
      .admin-session-user{font-weight:800;color:#111827}.admin-session-email{margin-top:2px;color:#64748b;font-size:10px}
      .admin-session-status{display:inline-block;padding:3px 7px;border-radius:999px;font-weight:800;background:#e2e8f0;color:#334155}
      .admin-session-status.active{background:#dcfce7;color:#166534}.admin-session-status.terminated{background:#fee2e2;color:#991b1b}
      #adminDailySessionMessage{min-height:18px;margin:8px 0;color:#64748b}
      @media(max-width:900px){.admin-session-summary{grid-template-columns:repeat(2,minmax(0,1fr))}.admin-session-calendar{width:100%}}
      @media(max-width:560px){.admin-session-summary{grid-template-columns:1fr}.admin-session-calendar>*{flex:1 1 auto}.admin-session-calendar label{flex:1 1 100%}}
    `;document.head.appendChild(style);
  }

  function ensurePanel(){
    const dashboard=byId('dashboard');if(!dashboard)return false;
    ensureStyles();
    let panel=byId('adminDailySessionPanel');
    if(!panel){
      panel=document.createElement('section');panel.id='adminDailySessionPanel';panel.className='card';panel.hidden=true;
      panel.innerHTML=`<div class="admin-session-head"><div><h2 style="margin:0">Daily Session Activity</h2><p class="muted" style="margin:4px 0 0">Admin-only session starts and terminations in Pacific time.</p></div><div class="admin-session-calendar"><button id="adminSessionPrevious" class="assign-btn" type="button" aria-label="Previous day">◀</button><label for="adminSessionDate">Day<input id="adminSessionDate" type="date"></label><button id="adminSessionNext" class="assign-btn" type="button" aria-label="Next day">▶</button><button id="adminSessionToday" class="assign-btn" type="button">TODAY</button><button id="adminSessionRefresh" class="assign-btn" type="button">REFRESH</button></div></div><div class="admin-session-summary"><div class="admin-session-metric"><span>Sessions started</span><strong id="adminSessionStarted">0</strong></div><div class="admin-session-metric"><span>Sessions terminated</span><strong id="adminSessionTerminated">0</strong></div><div class="admin-session-metric"><span>Unique users</span><strong id="adminSessionUsers">0</strong></div><div class="admin-session-metric"><span>Active at day end</span><strong id="adminSessionActive">0</strong></div><div class="admin-session-metric"><span>Tracked time</span><strong id="adminSessionTime">0m</strong></div></div><div id="adminDailySessionMessage" role="status" aria-live="polite">Choose a day to load session activity.</div><div class="admin-session-table-wrap"><table class="admin-session-table" aria-label="Daily field session starts and terminations"><thead><tr><th>User</th><th>Started</th><th>Terminated</th><th>Duration</th><th>Status / reason</th></tr></thead><tbody id="adminSessionRows"></tbody></table></div>`;
      const cards=dashboard.querySelector(':scope>.cards');
      if(cards)cards.insertAdjacentElement('afterend',panel);else dashboard.prepend(panel);

      const input=byId('adminSessionDate'),today=pacificDate();input.value=today;input.max=today;
      input.addEventListener('change',()=>loadDate(input.value,true));
      byId('adminSessionPrevious').addEventListener('click',()=>{input.value=addDays(input.value||today,-1);loadDate(input.value,true);});
      byId('adminSessionNext').addEventListener('click',()=>{const next=addDays(input.value||today,1);if(next>today)return;input.value=next;loadDate(input.value,true);});
      byId('adminSessionToday').addEventListener('click',()=>{input.value=today;loadDate(today,true);});
      byId('adminSessionRefresh').addEventListener('click',()=>loadDate(input.value||today,true));
    }
    return true;
  }

  function setSummary(summary={}){
    byId('adminSessionStarted').textContent=String(summary.sessions_started||0);
    byId('adminSessionTerminated').textContent=String(summary.sessions_terminated||0);
    byId('adminSessionUsers').textContent=String(summary.unique_users||0);
    byId('adminSessionActive').textContent=String(summary.active_sessions||0);
    byId('adminSessionTime').textContent=formatDuration(summary.tracked_seconds||0);
  }

  function renderRows(rows=[]){
    const body=byId('adminSessionRows');body.replaceChildren();
    if(!rows.length){
      const row=document.createElement('tr'),cell=document.createElement('td');cell.colSpan=5;cell.textContent='No sessions started, ended, or remained active on this day.';row.appendChild(cell);body.appendChild(row);return;
    }
    for(const item of rows){
      const row=document.createElement('tr');
      const user=document.createElement('td'),name=document.createElement('div'),email=document.createElement('div');name.className='admin-session-user';name.textContent=item.user_name||item.user_email||'User';email.className='admin-session-email';email.textContent=item.user_email||'—';user.append(name,email);row.appendChild(user);
      const started=document.createElement('td');started.textContent=formatTime(item.started_at);row.appendChild(started);
      const ended=document.createElement('td');ended.textContent=item.ended_at?formatTime(item.ended_at):'—';row.appendChild(ended);
      const duration=document.createElement('td');duration.textContent=formatDuration(item.duration_seconds);row.appendChild(duration);
      const statusCell=document.createElement('td'),status=document.createElement('span');status.className=`admin-session-status ${item.status==='active'?'active':'terminated'}`;status.textContent=item.status==='active'?'ACTIVE':item.termination_label||'TERMINATED';statusCell.appendChild(status);if(item.termination_source){const source=document.createElement('div');source.className='admin-session-email';source.textContent=String(item.termination_source).replaceAll('_',' ');statusCell.appendChild(source);}row.appendChild(statusCell);
      body.appendChild(row);
    }
  }

  async function loadDate(date,force=false){
    if(state.busy||!date)return;
    if(!force&&state.loadedDate===date)return;
    state.busy=true;
    const message=byId('adminDailySessionMessage'),refresh=byId('adminSessionRefresh');
    refresh.disabled=true;refresh.textContent='LOADING…';message.textContent=`Loading session activity for ${date}…`;
    try{
      const {data,error}=await sb.functions.invoke('admin-session-history',{body:{date}});
      if(error||!data?.ok)throw error||new Error(data?.error||'session_history_failed');
      state.loadedDate=date;setSummary(data.summary);renderRows(data.sessions||[]);
      message.textContent=`${data.summary?.sessions_started||0} started · ${data.summary?.sessions_terminated||0} terminated · Pacific time`;
    }catch(error){
      console.error('Daily session activity failed',error);setSummary({});renderRows([]);message.textContent=error?.message||'Unable to load daily session activity.';
    }finally{state.busy=false;refresh.disabled=false;refresh.textContent='REFRESH';}
  }

  function activate(){
    if(!ensurePanel())return;
    const panel=byId('adminDailySessionPanel');
    const isAdmin=window.MCCOY_ACCESS?.access?.active&&window.MCCOY_ACCESS?.access?.role==='admin';
    panel.hidden=!isAdmin;
    if(!isAdmin)return;
    const input=byId('adminSessionDate'),today=pacificDate();input.max=today;if(!input.value)input.value=today;
    loadDate(input.value,false);
  }

  function scheduleRefresh(){
    clearTimeout(state.refreshTimer);state.refreshTimer=setTimeout(()=>{
      const selected=byId('adminSessionDate')?.value;
      if(selected===pacificDate())loadDate(selected,true);
    },350);
  }

  window.addEventListener('mccoy-access-ready',activate);
  window.addEventListener('mccoy-field-session-started',scheduleRefresh);
  window.addEventListener('mccoy-field-session-ended',scheduleRefresh);
  document.addEventListener('click',event=>{if(event.target?.closest?.('.nav-btn[data-view="dashboard"]'))setTimeout(activate,0);},true);
  [0,250,800,1600].forEach(delay=>setTimeout(activate,delay));
})();