// Rep-only dashboard summary and shared company sales activity.
(()=>{
  const byId=id=>document.getElementById(id);
  const isRep=()=>['rep','tester'].includes(String(window.MCCOY_ACCESS?.access?.role||'').toLowerCase());
  let initialized=false,refreshTimer=null,salesChannel=null;

  const css=document.createElement('style');
  css.textContent=`
    .rep-dashboard-summary,.rep-dashboard-main-row,.rep-dashboard-live-wins{display:none}
    .rep-dashboard-summary{grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;margin-bottom:18px}
    .rep-dashboard-main-row{grid-template-columns:minmax(0,1.2fr) minmax(280px,.8fr);gap:14px;margin-bottom:14px;align-items:stretch}
    .rep-dashboard-main-row>.card{margin:0;min-width:0}
    .rep-dashboard-main-row h2,.rep-dashboard-live-wins h2{margin:0}
    .rep-dashboard-sale-activity{display:grid;gap:12px}
    .rep-dashboard-live-wins{width:100%;box-sizing:border-box;margin-bottom:18px}
    .rep-dashboard-live-wins .sales-feed{max-height:360px}
    body.blind-tester #dashboard>#repDashboardSummary{display:grid!important}
    body.blind-tester #dashboard>#repDashboardMainRow{display:grid!important}
    body.blind-tester #dashboard>#repDashboardLiveWins{display:block!important}
    @media(max-width:900px){body.blind-tester #dashboard>#repDashboardSummary,body.blind-tester #dashboard>#repDashboardMainRow{grid-template-columns:1fr!important}}
  `;
  document.head.appendChild(css);

  function ensureDashboard(){
    if(!isRep())return null;
    const dashboard=byId('dashboard');if(!dashboard)return null;
    let summary=byId('repDashboardSummary');
    if(!summary){
      summary=document.createElement('div');summary.id='repDashboardSummary';summary.className='rep-dashboard-summary';
      summary.innerHTML='<div class="card stat"><span>Total Leads</span><strong id="repDashboardLeadTotal">0</strong></div><div class="card stat"><span>Region</span><strong id="repDashboardRegion">Unassigned</strong></div><div class="card stat"><span>Manager</span><strong id="repDashboardManager">Unassigned</strong></div>';
      const ranking=byId('dashboardRepRankings');dashboard.insertBefore(summary,ranking||dashboard.firstChild);
    }
    let mainRow=byId('repDashboardMainRow');
    if(!mainRow){
      mainRow=document.createElement('div');mainRow.id='repDashboardMainRow';mainRow.className='rep-dashboard-main-row';
      mainRow.innerHTML='<div class="card"><div class="card-head"><h2>🏆 Company Leaders</h2></div><div class="leaders-grid"><div class="leader-tile"><span>Today</span><strong id="repLeadToday">—</strong><small id="repLeadTodayCount"></small></div><div class="leader-tile"><span>This Week</span><strong id="repLeadWeek">—</strong><small id="repLeadWeekCount"></small></div><div class="leader-tile"><span>This Month</span><strong id="repLeadMonth">—</strong><small id="repLeadMonthCount"></small></div><div class="leader-tile"><span>This Year</span><strong id="repLeadYear">—</strong><small id="repLeadYearCount"></small></div><div class="leader-tile"><span>All Time</span><strong id="repLeadAll">—</strong><small id="repLeadAllCount"></small></div></div></div><div class="card rep-dashboard-sale-activity"><div class="card-head"><h2>Sale Activity</h2><button type="button" id="repDashboardSalesRefresh" class="assign-btn">Refresh Sales</button></div><div><strong>🏆 Monthly Sales</strong><div id="dashboardMonthlyLeaders" style="margin-top:8px">Loading…</div></div></div>';
      const ranking=byId('dashboardRepRankings');(ranking||summary).insertAdjacentElement('afterend',mainRow);
    }
    let liveWins=byId('repDashboardLiveWins');
    if(!liveWins){
      liveWins=document.createElement('div');liveWins.id='repDashboardLiveWins';liveWins.className='card rep-dashboard-live-wins';
      liveWins.innerHTML='<div class="card-head"><h2>🎉 Live Wins</h2></div><div id="dashboardSalesFeed" class="sales-feed">Loading…</div>';
      mainRow.insertAdjacentElement('afterend',liveWins);
    }
    return dashboard;
  }

  function renderSummary(){
    if(!ensureDashboard())return;
    const access=window.MCCOY_ACCESS?.access||{},leadState=typeof state!=='undefined'?state:null;
    const leads=Array.isArray(leadState?.realLeads)?leadState.realLeads:Array.isArray(leadState?.leads)?leadState.leads:[];
    byId('repDashboardLeadTotal').textContent=leads.length.toLocaleString();
    byId('repDashboardRegion').textContent=access.team_name||leadState?.leadAccessScope?.assignedTeam||'Unassigned';
    byId('repDashboardManager').textContent=access.assigned_manager_name||access.assigned_manager_email||'Unassigned';
  }

  async function loadCompanyLeaders(){
    const {data,error}=await sb.functions.invoke('company-leaders');if(error)throw error;if(!data?.ok)throw new Error(data?.error||'company_leaders_failed');
    const targets={today:['repLeadToday','repLeadTodayCount'],week:['repLeadWeek','repLeadWeekCount'],month:['repLeadMonth','repLeadMonthCount'],year:['repLeadYear','repLeadYearCount'],all_time:['repLeadAll','repLeadAllCount']};
    for(const [period,[nameId,countId]] of Object.entries(targets)){
      const leader=data.leaders?.[period];byId(nameId).textContent=leader?.name||'No sales yet';byId(countId).textContent=leader?leader.count+' sale'+(leader.count===1?'':'s'):'';
    }
  }

  function renderMonthlySales(rows){
    const root=byId('dashboardMonthlyLeaders');if(!root)return;root.replaceChildren();
    const totals=new Map();
    for(const row of rows){const key=row.rep_user_id||row.rep_name,x=totals.get(key)||{name:row.rep_name||'Rep',sales:0,mobile:0,directv:0,vivint:0};x.sales++;x.mobile+=Number(row.att_mobile_lines||0);x.directv+=row.directv?1:0;x.vivint+=row.vivint?1:0;totals.set(key,x);}
    const leaders=[...totals.values()].sort((left,right)=>right.sales-left.sales).slice(0,10);
    if(!leaders.length){const empty=document.createElement('div');empty.className='muted small';empty.textContent='No monthly totals yet.';root.appendChild(empty);return;}
    leaders.forEach((leader,index)=>{const line=document.createElement('div');line.className='leader-row';const name=document.createElement('span'),count=document.createElement('strong');name.textContent=`${index+1}. ${leader.name}`;count.textContent=`${leader.sales} sale${leader.sales===1?'':'s'}`;line.append(name,count);const detail=document.createElement('div');detail.className='muted small';detail.textContent=`${leader.mobile} mobile lines · ${leader.directv} DIRECTV · ${leader.vivint} Vivint`;root.append(line,detail);});
  }

  function renderLiveWins(rows){
    const root=byId('dashboardSalesFeed');if(!root)return;root.replaceChildren();
    const wins=rows.slice(0,20);
    if(!wins.length){const empty=document.createElement('div');empty.className='muted small';empty.textContent='No sales posted this month yet.';root.appendChild(empty);return;}
    for(const win of wins){const item=document.createElement('div');item.className='feed-item';const message=document.createElement('strong'),time=document.createElement('div');message.textContent=win.message||`${win.rep_name||'A rep'} logged a sale`;time.className='muted small';time.textContent=new Date(win.created_at).toLocaleString();item.append(message,time);root.appendChild(item);}
  }

  async function loadSales(){
    const start=new Date();start.setDate(1);start.setHours(0,0,0,0);
    const {data,error}=await sb.from('sales_feed').select('created_at,rep_user_id,rep_name,isp,directv,att_mobile_lines,vivint,message').gte('created_at',start.toISOString()).order('created_at',{ascending:false}).limit(100);if(error)throw error;
    const rows=data||[];renderMonthlySales(rows);renderLiveWins(rows);
  }

  async function refresh(){
    if(!isRep()||!ensureDashboard())return;
    const button=byId('repDashboardSalesRefresh');if(button){button.disabled=true;button.textContent='Refreshing…';}
    try{await Promise.all([loadCompanyLeaders(),loadSales()]);}
    catch(error){console.error('Rep dashboard refresh failed',error);}
    finally{if(button){button.disabled=false;button.textContent='Refresh Sales';}}
  }

  function initialize(){
    if(initialized||!isRep())return;initialized=true;ensureDashboard();renderSummary();byId('repDashboardSalesRefresh').onclick=refresh;refresh();
    refreshTimer=setInterval(refresh,60000);
    salesChannel=sb.channel('mccoy-rep-dashboard-sales-feed').on('postgres_changes',{event:'INSERT',schema:'public',table:'sales_feed'},()=>loadSales().catch(error=>console.error('Rep Live Wins refresh failed',error))).subscribe();
  }

  window.addEventListener('mccoy-access-ready',initialize);
  window.addEventListener('mccoy-real-leads-progress',renderSummary);
  window.addEventListener('mccoy-real-leads-loaded',renderSummary);
  window.addEventListener('mccoy-sale-saved',refresh);
  const accessPoll=setInterval(()=>{if(window.MCCOY_ACCESS?.access){clearInterval(accessPoll);initialize();}},300);
  window.addEventListener('beforeunload',()=>{if(refreshTimer)clearInterval(refreshTimer);if(salesChannel)sb.removeChannel(salesChannel);});
})();
