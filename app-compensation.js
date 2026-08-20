// Rep pay progress + company leaders + Admin/Accounting-only compensation controls.
(function(){
  const css=document.createElement('style');css.textContent=`
  .pay-progress-card,.leaders-card{border:1px solid #e5e7eb;border-radius:12px;padding:12px;background:#fff;margin:12px 0}#field .field-session-top-grid{grid-template-columns:repeat(3,minmax(0,1fr));align-items:stretch}#field .field-session-top-grid>#payProgressCard{margin:0;height:100%;padding:20px}@media(max-width:900px){#field .field-session-top-grid{grid-template-columns:1fr}}.pay-progress-main{font-size:14px;font-weight:700;margin-top:6px}.pay-progress-sub{font-size:12px;color:#6b7280;margin-top:4px}.leaders-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-top:8px}.leader-tile{border:1px solid #eef0f2;border-radius:10px;padding:9px}.leader-tile span{display:block;font-size:11px;color:#6b7280}.leader-tile strong{display:block;font-size:13px;margin-top:3px}.leader-tile small{display:block;color:#6b7280;margin-top:2px}@media(max-width:720px){.leaders-grid{grid-template-columns:1fr 1fr}.leader-tile:last-child{grid-column:1/-1}}
  .rep-rankings-card{margin-bottom:18px}.rep-rankings-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;flex-wrap:wrap}.rep-rankings-head h2{margin:0}.rep-rankings-head p{margin:5px 0 0;color:#6b7280;font-size:13px}.rep-ranking-controls{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.rep-ranking-controls select{border:1px solid #d1d5db;border-radius:8px;background:#fff;padding:9px 11px;color:#111827}.rep-ranking-summary{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;margin:18px 0}.rep-ranking-stat{border:1px solid #e5e7eb;border-radius:12px;padding:12px;background:#fafbfc}.rep-ranking-stat span{display:block;color:#6b7280;font-size:12px}.rep-ranking-stat strong{display:block;margin-top:6px;font-size:23px;color:#111827}.rep-ranking-stat:first-child{background:#111827;border-color:#111827}.rep-ranking-stat:first-child span,.rep-ranking-stat:first-child strong{color:#fff}.rep-ranking-person{font-size:12px;color:#6b7280;margin:0 0 12px}.rep-ranking-table-wrap{overflow-x:auto}.rep-ranking-table{width:100%;border-collapse:collapse;min-width:610px}.rep-ranking-table th,.rep-ranking-table td{text-align:left;padding:11px 10px;border-bottom:1px solid #eef0f2;font-size:13px}.rep-ranking-table th{color:#6b7280;font-weight:600}.rep-ranking-table tbody tr.current-rep{background:#eff6ff}.rep-ranking-table tbody tr.current-rep td:first-child{font-weight:700;color:#1d4ed8}.rep-ranking-you{display:inline-block;margin-left:7px;padding:2px 7px;border-radius:999px;background:#dbeafe;color:#1d4ed8;font-size:10px;font-weight:600}.rep-ranking-empty{padding:15px 0;color:#6b7280;font-size:13px}@media(max-width:720px){.rep-ranking-summary{grid-template-columns:1fr 1fr}.rep-ranking-stat:first-child{grid-column:1/-1}.rep-rankings-head{align-items:stretch}.rep-ranking-controls{width:100%}.rep-ranking-controls select{flex:1}}
  #compBtn{position:fixed;left:14px;bottom:14px;z-index:2500;display:none;border:0;border-radius:999px;padding:9px 13px;background:#111827;color:#fff;font-size:12px;cursor:pointer}
  #compPanel{position:fixed;inset:0;z-index:130000;background:rgba(17,24,39,.78);display:none;align-items:center;justify-content:center;padding:16px}#compPanel.show{display:flex}.comp-card{width:min(760px,100%);max-height:92vh;overflow:auto;background:#fff;border-radius:16px;padding:20px}.comp-section{border-top:1px solid #e5e7eb;margin-top:16px;padding-top:14px}.comp-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 0;border-bottom:1px solid #f0f2f4}.comp-row input[type=number]{width:90px;padding:7px}.comp-muted{font-size:12px;color:#6b7280}.comp-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:16px}.sale-approval-list{display:grid;gap:10px;margin-top:10px}.sale-approval-row{padding:12px;border:1px solid #dbeafe;border-radius:10px;background:#f8fbff}.sale-approval-title{font-weight:800}.sale-approval-row textarea{width:100%;box-sizing:border-box;margin-top:8px;padding:8px;border:1px solid #cbd5e1;border-radius:8px;resize:vertical}.sale-approval-buttons{display:flex;gap:8px;margin-top:8px}.sale-approval-buttons button{flex:1;min-height:40px}@media(max-width:560px){.sale-approval-buttons{flex-direction:column}}
  `;document.head.appendChild(css);

  const field=document.getElementById('fieldLeadSelect');
  if(field){
    const pay=document.createElement('div');pay.className='pay-progress-card';pay.id='payProgressCard';pay.innerHTML='<strong>Weekly Pay Progress</strong><div id="payProgressMain" class="pay-progress-main">Loading…</div><div id="payProgressSub" class="pay-progress-sub"></div>';const fieldPage=document.getElementById('field'),sessionBox=fieldPage?.querySelector('.grid-2');if(sessionBox){sessionBox.classList.add('field-session-top-grid');sessionBox.insertBefore(pay,sessionBox.children[1]||null);}else field.parentNode?.insertBefore(pay,field);
    const leaders=document.createElement('div');leaders.className='leaders-card';leaders.innerHTML='<strong>🏆 Company Leaders</strong><div class="leaders-grid"><div class="leader-tile"><span>Today</span><strong id="leadToday">—</strong><small id="leadTodayCount"></small></div><div class="leader-tile"><span>This Week</span><strong id="leadWeek">—</strong><small id="leadWeekCount"></small></div><div class="leader-tile"><span>This Month</span><strong id="leadMonth">—</strong><small id="leadMonthCount"></small></div><div class="leader-tile"><span>This Year</span><strong id="leadYear">—</strong><small id="leadYearCount"></small></div><div class="leader-tile"><span>All Time</span><strong id="leadAll">—</strong><small id="leadAllCount"></small></div></div>';const coachCard=document.getElementById('coachMetrics');if(coachCard)coachCard.insertAdjacentElement('afterend',leaders);else field.parentNode?.insertBefore(leaders,field);
  }


  const rankingLabels={today:'Today',week:'This Week',month:'This Month',year:'This Year'};
  let currentRankingData=null;
  let selectedRankingPeriod='week';

  function createRankingCell(row,value,className){
    const cell=document.createElement('td');
    if(className)cell.className=className;
    cell.textContent=String(value);
    row.appendChild(cell);
    return cell;
  }

  function ensureDashboardRankings(){
    const dashboard=document.getElementById('dashboard');
    if(!dashboard)return null;
    let card=document.getElementById('dashboardRepRankings');
    if(card)return card;
    card=document.createElement('div');
    card.className='card rep-rankings-card';
    card.id='dashboardRepRankings';
    card.innerHTML='<div class="rep-rankings-head"><div><h2>Rep Sales Rankings</h2><p>Every active rep and manager, ranked by ISP-verified eligible sales.</p></div><div class="rep-ranking-controls"><select id="repRankingPeriod" aria-label="Choose ranking period"><option value="today">Today</option><option value="week" selected>This Week</option><option value="month">This Month</option><option value="year">This Year</option></select><button id="repRankingsRefresh" class="assign-btn">Refresh</button></div></div><div class="rep-ranking-summary"><div class="rep-ranking-stat"><span id="repPersonalRankLabel">Your Rank</span><strong id="repPersonalRank">—</strong></div><div class="rep-ranking-stat"><span>Sales Today</span><strong id="repPersonalToday">0</strong></div><div class="rep-ranking-stat"><span>Sales This Week</span><strong id="repPersonalWeek">0</strong></div><div class="rep-ranking-stat"><span>Sales This Month</span><strong id="repPersonalMonth">0</strong></div><div class="rep-ranking-stat"><span>Sales This Year</span><strong id="repPersonalYear">0</strong></div></div><p id="repRankingPerson" class="rep-ranking-person"></p><div class="rep-ranking-table-wrap"><table class="rep-ranking-table" aria-label="Individual representative sales rankings"><thead><tr><th scope="col">Rank</th><th scope="col">Representative</th><th scope="col">Today</th><th scope="col">This Week</th><th scope="col">This Month</th><th scope="col">This Year</th></tr></thead><tbody id="repRankingRows"><tr><td colspan="6">Loading rep rankings…</td></tr></tbody></table></div>';
    dashboard.insertBefore(card,dashboard.firstChild);
    document.getElementById('repRankingPeriod').onchange=function(){
      selectedRankingPeriod=rankingLabels[this.value]?this.value:'week';
      renderDashboardRankings(currentRankingData);
    };
    document.getElementById('repRankingsRefresh').onclick=async function(){
      this.disabled=true;
      card.setAttribute('aria-busy','true');
      try{await loadLeaders();}finally{this.disabled=false;card.removeAttribute('aria-busy');}
    };
    return card;
  }

  function renderDashboardRankings(data){
    const card=ensureDashboardRankings();
    if(!card||!data?.ok)return;
    currentRankingData=data;
    const rankings=Array.isArray(data.rankings)?data.rankings.slice():[];
    rankings.sort((left,right)=>(left.ranks?.[selectedRankingPeriod]||Number.MAX_SAFE_INTEGER)-(right.ranks?.[selectedRankingPeriod]||Number.MAX_SAFE_INTEGER));
    const personal=data.current_rep||rankings.find(rep=>rep.is_current_user)||null;
    const highlighted=personal||rankings[0]||null;
    const title=document.getElementById('repPersonalRankLabel');
    if(title)title.textContent=personal?'Your Rank':'Top Rep Rank';
    const rank=document.getElementById('repPersonalRank');
    if(rank)rank.textContent=highlighted?'#'+highlighted.ranks[selectedRankingPeriod]:'—';
    for(const [period,id] of [['today','repPersonalToday'],['week','repPersonalWeek'],['month','repPersonalMonth'],['year','repPersonalYear']]){
      const stat=document.getElementById(id);
      if(stat)stat.textContent=String(Number(highlighted?.[period+'_sales']||0));
    }
    const person=document.getElementById('repRankingPerson');
    if(person)person.textContent=highlighted?(personal?'Your sales · ':'Leading rep: '+highlighted.rep_name+' · ')+'Ranked by '+rankingLabels[selectedRankingPeriod]+'.':'No active representatives are available.';
    const body=document.getElementById('repRankingRows');
    if(!body)return;
    body.replaceChildren();
    if(!rankings.length){
      const empty=document.createElement('tr'),cell=document.createElement('td');
      cell.colSpan=6;cell.className='rep-ranking-empty';cell.textContent='No active representatives yet.';empty.appendChild(cell);body.appendChild(empty);
      return;
    }
    for(const rep of rankings){
      const row=document.createElement('tr');
      if(rep.is_current_user)row.className='current-rep';
      createRankingCell(row,'#'+rep.ranks[selectedRankingPeriod]);
      const name=createRankingCell(row,rep.rep_name||'Rep');
      if(rep.is_current_user){const badge=document.createElement('span');badge.className='rep-ranking-you';badge.textContent='You';name.appendChild(badge);}
      for(const period of ['today','week','month','year'])createRankingCell(row,Number(rep[period+'_sales']||0));
      body.appendChild(row);
    }
  }

  ensureDashboardRankings();

  async function invoke(name,body){const {data,error}=await sb.functions.invoke(name,body?{body}:undefined);if(error)throw error;return data;}
  async function loadPayProgress(){try{const d=await invoke('pay-progress');if(!d?.ok)return;const main=document.getElementById('payProgressMain'),sub=document.getElementById('payProgressSub');if(!main||!sub)return;if(d.next_threshold==null){main.textContent=`${d.weekly_sales} sales this week — highest extra-pay tier reached`;sub.textContent=`Current weekly production increase: +$${d.current_increase_per_sale} per qualifying sale. Only ISP-verified eligible sales count.`;}else{main.textContent=`${d.weekly_sales} sales this week — ${d.sales_needed_for_next} more to reach ${d.next_threshold}`;sub.textContent=`At ${d.next_threshold} weekly sales, the current schedule adds $${d.next_increase_per_sale} per qualifying sale. Current increase: +$${d.current_increase_per_sale}. Only ISP-verified eligible sales count.`;}}catch(e){console.error('Pay progress failed',e);}}

  async function loadLeaders(){
    try{
      const data=await invoke('company-leaders');
      if(!data?.ok)return;
      const map=[['today','leadToday','leadTodayCount'],['week','leadWeek','leadWeekCount'],['month','leadMonth','leadMonthCount'],['year','leadYear','leadYearCount'],['all_time','leadAll','leadAllCount']];
      for(const [key,nameId,countId] of map){
        const leader=data.leaders?.[key],name=document.getElementById(nameId),count=document.getElementById(countId);
        if(name)name.textContent=leader?.name||'No sales yet';
        if(count)count.textContent=leader?leader.count+' sale'+(leader.count===1?'':'s'):'';
      }
      renderDashboardRankings(data);
    }catch(error){
      console.error('Company leaders failed',error);
      const rows=document.getElementById('repRankingRows');
      if(rows){rows.replaceChildren();const row=document.createElement('tr'),cell=document.createElement('td');cell.colSpan=6;cell.textContent='Unable to load rankings right now. Please refresh.';row.appendChild(cell);rows.appendChild(row);}
    }
  }

  const btn=document.createElement('button');btn.id='compBtn';btn.textContent='Compensation Controls';document.body.appendChild(btn);
  const panel=document.createElement('div');panel.id='compPanel';panel.innerHTML='<div class="comp-card"><h2>Compensation & Sale Controls</h2><div class="comp-muted">Only Admin and authorized Accounting can view this panel. Only Admin can change settings or approve outside-system sales.</div><div id="compContent" style="margin-top:12px">Loading…</div><div class="comp-actions"><button id="compClose" class="assign-btn">Close</button></div></div>';document.body.appendChild(panel);
  document.getElementById('compClose').onclick=()=>panel.classList.remove('show');

  async function authFetch(method='GET',body=null){const {data:{session}}=await sb.auth.getSession();if(!session)throw new Error('not_signed_in');const r=await fetch(SUPABASE_URL+'/functions/v1/compensation-settings',{method,headers:{Authorization:'Bearer '+session.access_token,apikey:SUPABASE_PUBLISHABLE_KEY,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'request_failed');return d;}
  async function probe(){try{await authFetch();btn.style.display='block';}catch{btn.style.display='none';}}
  btn.onclick=async()=>{panel.classList.add('show');await loadControls();};

  function checkbox(id,on,disabled){return `<label><input id="${id}" type="checkbox" ${on?'checked':''} ${disabled?'disabled':''}> ${on?'On':'Off'}</label>`;}
  async function loadSaleApprovals(){
    const root=document.getElementById('outsideSaleApprovals');if(!root)return;
    root.textContent='Loading pending sales…';
    try{
      const data=await invoke('sale-approvals',{action:'list'});
      if(!data?.ok)throw new Error(data?.error||'sale_approvals_failed');
      root.replaceChildren();root.className='sale-approval-list';
      const pending=Array.isArray(data.pending)?data.pending:[];
      if(!pending.length){const empty=document.createElement('div');empty.className='comp-muted';empty.textContent='No outside-system sales are waiting for approval.';root.appendChild(empty);return;}
      for(const sale of pending){
        const row=document.createElement('div');row.className='sale-approval-row';
        const title=document.createElement('div');title.className='sale-approval-title';title.textContent=`${sale.rep_name||sale.rep_email||'Rep'} · ${sale.isp||'Provider'}`;
        const address=document.createElement('div');address.className='comp-muted';address.textContent=sale.service_address||'No service address';
        const identifiers=document.createElement('div');identifiers.className='comp-muted';identifiers.textContent=`Order: ${sale.provider_order_number||'—'} · Account: ${sale.provider_account_number||'—'} · ISP verification: ${String(sale.verification_status||'pending').replace(/_/g,' ')}`;
        const created=document.createElement('div');created.className='comp-muted';created.textContent=new Date(sale.created_at).toLocaleString();
        const notes=document.createElement('textarea');notes.rows=2;notes.maxLength=1000;notes.placeholder='Admin approval notes (optional)';notes.setAttribute('aria-label',`Approval notes for ${sale.rep_name||sale.rep_email||'sale'}`);
        const actions=document.createElement('div');actions.className='sale-approval-buttons';
        const approve=document.createElement('button');approve.type='button';approve.className='primary';approve.textContent='APPROVE SALE';
        const reject=document.createElement('button');reject.type='button';reject.className='assign-btn';reject.textContent='REJECT SALE';
        actions.append(approve,reject);row.append(title,address,identifiers,created,notes,actions);root.appendChild(row);
        const review=async decision=>{
          approve.disabled=true;reject.disabled=true;notes.disabled=true;
          try{const result=await invoke('sale-approvals',{action:'review',sale_id:sale.id,decision,notes:notes.value});if(!result?.ok)throw new Error(result?.error||'sale_review_failed');await Promise.all([loadSaleApprovals(),loadPayProgress(),loadLeaders()]);}
          catch(error){console.error('Outside-system sale review failed',error);approve.disabled=false;reject.disabled=false;notes.disabled=false;alert('Unable to review this sale right now. Please retry.');}
        };
        approve.onclick=()=>review('approved');reject.onclick=()=>review('rejected');
      }
    }catch(error){root.className='comp-muted';root.textContent='Unable to load pending outside-system sales.';console.error(error);}
  }

  async function loadControls(){
    const root=document.getElementById('compContent');root.textContent='Loading…';
    try{
      const d=await authFetch(),edit=!!d.can_edit,t1=d.tiers?.[0]||{min_sales:15,increase_per_sale:25},t2=d.tiers?.[1]||{min_sales:25,increase_per_sale:50};
      root.innerHTML=`
        <div class="comp-section" style="border-top:0;margin-top:0;padding-top:0"><strong>Manager Overrides — Master Switch</strong><div class="comp-row"><div><div>All manager overrides</div><div class="comp-muted">Off disables every manager override regardless of lower-level settings.</div></div>${checkbox('globalOverride',d.global_manager_overrides_enabled,!edit)}</div></div>
        <div class="comp-section"><strong>Weekly Production Pay Thresholds</strong><div class="comp-muted">Only ISP-verified sales count. Outside-system sales must also be approved by an Admin.</div><div class="comp-row"><span>+$${t1.increase_per_sale}/sale begins at</span><span><input id="tier1Min" type="number" min="1" value="${t1.min_sales}" ${edit?'':'disabled'}> sales</span></div><div class="comp-row"><span>+$${t2.increase_per_sale}/sale begins at</span><span><input id="tier2Min" type="number" min="2" value="${t2.min_sales}" ${edit?'':'disabled'}> sales</span></div>${edit?'<button id="saveThresholds" class="primary" style="margin-top:8px">Save Thresholds</button>':''}</div>
        ${edit?'<div class="comp-section"><strong>Outside-System Sale Approvals</strong><div class="comp-muted">Approve a sale only after checking it against the appropriate ISP seller dashboard. Approval does not bypass ISP verification.</div><div id="outsideSaleApprovals">Loading pending sales…</div></div>':''}
        <div class="comp-section"><strong>Per Manager</strong><div id="mgrRows"></div></div><div class="comp-section"><strong>Per Assigned Rep</strong><div class="comp-muted">Effective only if the master switch, manager switch, and rep switch are all on.</div><div id="repRows"></div></div>`;
      document.getElementById('mgrRows').innerHTML=(d.managers||[]).map((m,i)=>`<div class="comp-row"><div><strong>${m.manager_name}</strong>${m.manager_email?`<div class="comp-muted">${m.manager_email}</div>`:''}</div>${checkbox('mgr'+i,m.overrides_enabled,!edit)}</div>`).join('')||'<div class="comp-muted">No managers configured.</div>';
      document.getElementById('repRows').innerHTML=(d.reps||[]).map((r,i)=>`<div class="comp-row"><div><strong>${r.display_name}</strong><div class="comp-muted">Manager: ${r.manager_name||r.manager_email||'Unassigned'} · Effective: ${r.effective_overrides_enabled?'On':'Off'}</div></div>${checkbox('rep'+i,r.overrides_enabled,!edit)}</div>`).join('')||'<div class="comp-muted">No assigned reps yet.</div>';
      if(edit){
        document.getElementById('globalOverride').onchange=async event=>{await authFetch('POST',{action:'set_global_manager_overrides',enabled:event.target.checked});await loadControls();};
        (d.managers||[]).forEach((manager,index)=>{document.getElementById('mgr'+index).onchange=async event=>{await authFetch('POST',{action:'set_manager_override',manager_name:manager.manager_name,manager_email:manager.manager_email,overrides_enabled:event.target.checked});await loadControls();};});
        (d.reps||[]).forEach((rep,index)=>{document.getElementById('rep'+index).onchange=async event=>{await authFetch('POST',{action:'set_rep_override',rep_email:rep.email,overrides_enabled:event.target.checked});await loadControls();};});
        document.getElementById('saveThresholds').onclick=async()=>{await authFetch('POST',{action:'set_weekly_thresholds',tier1_min_sales:Number(document.getElementById('tier1Min').value),tier2_min_sales:Number(document.getElementById('tier2Min').value)});await loadControls();await loadPayProgress();};
        await loadSaleApprovals();
      }
    }catch(error){root.textContent='Unable to load compensation controls.';console.error(error);}
  }

  const poll=setInterval(()=>{if(!window.MCCOY_ACCESS?.user)return;clearInterval(poll);loadPayProgress();loadLeaders();probe();setInterval(()=>{loadPayProgress();loadLeaders();},60000);},400);
  window.addEventListener('mccoy-sale-saved',()=>{loadPayProgress();loadLeaders();});
  document.querySelector('.nav-btn[data-view="dashboard"]')?.addEventListener('click',()=>{if(window.MCCOY_ACCESS?.user)loadLeaders();});
})();
