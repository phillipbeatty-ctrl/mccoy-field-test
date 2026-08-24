// Rep pay progress + company leaders + Admin/Accounting-only compensation controls.
(function(){
  const css=document.createElement('style');css.textContent=`
  .pay-progress-card,.leaders-card{border:1px solid #e5e7eb;border-radius:12px;padding:12px;background:#fff;margin:12px 0}#field .field-session-top-grid{grid-template-columns:repeat(3,minmax(0,1fr));align-items:stretch}#field .field-session-top-grid>#payProgressCard{margin:0;height:100%;padding:20px}@media(max-width:900px){#field .field-session-top-grid{grid-template-columns:1fr}}.pay-progress-main{font-size:14px;font-weight:700;margin-top:6px}.pay-progress-sub{font-size:12px;color:#6b7280;margin-top:4px}.leaders-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-top:8px}.leader-tile{border:1px solid #eef0f2;border-radius:10px;padding:9px}.leader-tile span{display:block;font-size:11px;color:#6b7280}.leader-tile strong{display:block;font-size:13px;margin-top:3px}.leader-tile small{display:block;color:#6b7280;margin-top:2px}@media(max-width:720px){.leaders-grid{grid-template-columns:1fr 1fr}.leader-tile:last-child{grid-column:1/-1}}
  .rep-rankings-card{margin-bottom:18px}.rep-rankings-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;flex-wrap:wrap}.rep-rankings-head h2{margin:0}.rep-rankings-head p{margin:5px 0 0;color:#6b7280;font-size:13px}.rep-ranking-controls{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.rep-ranking-controls select{border:1px solid #d1d5db;border-radius:8px;background:#fff;padding:9px 11px;color:#111827}.rep-ranking-summary{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:12px;margin:18px 0}.rep-ranking-stat{border:1px solid #e5e7eb;border-radius:12px;padding:12px;background:#fafbfc}.rep-ranking-stat span{display:block;color:#6b7280;font-size:12px}.rep-ranking-stat strong{display:block;margin-top:6px;font-size:23px;color:#111827}.rep-ranking-stat:first-child{background:#111827;border-color:#111827}.rep-ranking-stat:first-child span,.rep-ranking-stat:first-child strong{color:#fff}.rep-records-title{margin:2px 0 9px;font-size:14px}.rep-record-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:16px}.rep-record-stat{border:1px solid #dbeafe;border-radius:12px;padding:11px;background:#f8fbff}.rep-record-stat span{display:block;color:#4b5563;font-size:11px}.rep-record-stat strong{display:block;margin-top:4px;font-size:21px;color:#1d4ed8}.rep-record-stat small,.rep-ranking-record small{display:block;margin-top:3px;color:#6b7280;font-size:10px;white-space:nowrap}.rep-ranking-record strong{display:block;color:#1d4ed8}.rep-ranking-person{font-size:12px;color:#6b7280;margin:0 0 12px}.rep-ranking-table-wrap,.pay-scale-wrap{overflow-x:auto}.rep-ranking-table,.pay-scale-table{width:100%;border-collapse:collapse;min-width:1280px}.rep-ranking-table th,.rep-ranking-table td,.pay-scale-table th,.pay-scale-table td{text-align:left;padding:11px 10px;border-bottom:1px solid #eef0f2;font-size:13px}.rep-ranking-table th,.pay-scale-table th{color:#6b7280;font-weight:600}.rep-ranking-table tbody tr.current-rep{background:#eff6ff}.rep-ranking-table tbody tr.current-rep td:first-child{font-weight:700;color:#1d4ed8}.rep-ranking-you{display:inline-block;margin-left:7px;padding:2px 7px;border-radius:999px;background:#dbeafe;color:#1d4ed8;font-size:10px;font-weight:600}.rep-ranking-empty{padding:15px 0;color:#6b7280;font-size:13px}@media(max-width:1100px){.rep-ranking-summary{grid-template-columns:repeat(3,minmax(0,1fr))}}@media(max-width:900px){.rep-record-grid{grid-template-columns:1fr 1fr}}@media(max-width:720px){.rep-ranking-summary{grid-template-columns:1fr 1fr}.rep-ranking-stat:first-child{grid-column:1/-1}.rep-rankings-head{align-items:stretch}.rep-ranking-controls{width:100%}.rep-ranking-controls select{flex:1}}
  .ghost-ranking-admin{margin:14px 0 4px;padding:13px;border:1px solid #c4b5fd;border-radius:12px;background:#faf5ff}.ghost-ranking-admin strong{display:block}.ghost-ranking-admin p{margin:4px 0 10px;color:#6b7280;font-size:12px}.ghost-goal-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}.ghost-goal-grid label{font-size:11px;color:#4b5563}.ghost-goal-grid input{display:block;width:100%;box-sizing:border-box;margin-top:4px;padding:8px;border:1px solid #cbd5e1;border-radius:8px}.ghost-ranking-actions{display:flex;align-items:center;gap:10px;margin-top:10px}.ghost-ranking-actions span{font-size:12px;color:#6b7280}.ghost-ranking-row{background:#faf5ff}.ghost-ranking-badge{display:inline-block;margin-left:7px;padding:2px 7px;border-radius:999px;background:#ede9fe;color:#6d28d9;font-size:10px;font-weight:700}@media(max-width:720px){.ghost-goal-grid{grid-template-columns:1fr 1fr}}
  #compBtn{position:fixed;left:14px;bottom:14px;z-index:2500;display:none;border:0;border-radius:999px;padding:9px 13px;background:#111827;color:#fff;font-size:12px;cursor:pointer}
  #compPanel{position:fixed;inset:0;z-index:130000;background:rgba(17,24,39,.78);display:none;align-items:center;justify-content:center;padding:16px}#compPanel.show{display:flex}.comp-card{width:min(760px,100%);max-height:92vh;overflow:auto;background:#fff;border-radius:16px;padding:20px}.comp-section{border-top:1px solid #e5e7eb;margin-top:16px;padding-top:14px}.comp-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 0;border-bottom:1px solid #f0f2f4}.comp-row input[type=number]{width:90px;padding:7px}.comp-muted{font-size:12px;color:#6b7280}.comp-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:16px}.override-choice{display:inline-flex;gap:4px;padding:3px;border:1px solid #d1d5db;border-radius:10px;background:#f9fafb}.override-choice button{min-width:58px;padding:7px 10px;border:0;border-radius:7px;background:transparent;color:#4b5563;font-weight:800;cursor:pointer}.override-choice button.active.on{background:#dcfce7;color:#166534}.override-choice button.active.off{background:#fee2e2;color:#991b1b}.override-choice button:disabled{cursor:not-allowed;opacity:.7}.sale-approval-list{display:grid;gap:10px;margin-top:10px}.sale-approval-row{padding:12px;border:1px solid #dbeafe;border-radius:10px;background:#f8fbff}.sale-approval-title{font-weight:800}.sale-approval-row textarea{width:100%;box-sizing:border-box;margin-top:8px;padding:8px;border:1px solid #cbd5e1;border-radius:8px;resize:vertical}.sale-approval-buttons{display:flex;gap:8px;margin-top:8px}.sale-approval-buttons button{flex:1;min-height:40px}@media(max-width:560px){.sale-approval-buttons{flex-direction:column}.comp-row{align-items:flex-start;flex-direction:column}.override-choice{width:100%;box-sizing:border-box}.override-choice button{flex:1}}
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

  function recordPeriodLabel(period,value){
    const match=/^(\d{4})-(\d{2})-(\d{2})/.exec(String(value||''));
    if(!match)return 'No completed sales yet';
    const date=new Date(Number(match[1]),Number(match[2])-1,Number(match[3]),12);
    if(period==='year')return String(match[1]);
    if(period==='month')return date.toLocaleDateString('en-US',{month:'long',year:'numeric'});
    if(period==='week'){
      const end=new Date(date);end.setDate(end.getDate()+6);
      return date.toLocaleDateString('en-US',{month:'short',day:'numeric'})+'–'+end.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
    }
    return date.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
  }

  function createRecordCell(row,rep,period){
    const record=rep?.personal_records?.[period]||{},cell=document.createElement('td'),count=document.createElement('strong'),when=document.createElement('small');
    const ghostPeriod=period==='day'?'today':period,state=rep?.ghost_visibility?.[ghostPeriod];
    cell.className='rep-ranking-record';
    if(rep?.is_ghost&&state?.revealed===false){count.textContent='Hidden';when.textContent='Reveals automatically when a real user overtakes Ghost';}
    else{count.textContent=String(Number(record.count||0));when.textContent=rep?.is_ghost?'Verified Ghost-account record':recordPeriodLabel(period,record.period_start);}
    cell.append(count,when);row.appendChild(cell);return cell;
  }

  function ghostPeriodState(rep,period){return rep?.is_ghost?rep?.ghost_visibility?.[period]||null:null;}
  function ghostVisibleFor(){return true;}
  function rankingMetric(rep,period){
    const state=ghostPeriodState(rep,period);
    if(rep?.is_ghost&&state?.revealed===false)return 'Hidden';
    return String(Number(rep?.[period+'_sales']||0));
  }

  function salesPerHourMetric(rep){
    if(rep?.is_ghost)return {rate:'Excluded',rank:'—',hours:'Ghost is excluded from sales/hour.'};
    const metric=rep?.sales_per_hour||{},rate=Number(metric.rate),hours=Number(metric.tracked_hours),rank=Number(metric.rank);
    const minimum=Number(metric.minimum_tracked_hours)||1,provisional=metric.provisional===true||!Number.isFinite(hours)||hours<minimum;
    const suffix=provisional?' · Provisional':'';
    if(!Number.isFinite(hours)||hours<=0)return {rate:'0.00'+suffix,rank:rank>0?'#'+rank:'—',hours:`Provisional until ${minimum.toFixed(0)} tracked field hour under the Sales/Hour workday model. No eligible McCoy workday time is recorded this week.`};
    if(!Number.isFinite(rate))return {rate:'0.00'+suffix,rank:rank>0?'#'+rank:'—',hours:`Provisional until ${minimum.toFixed(0)} tracked field hour under the Sales/Hour workday model. Tracked time exists, but the rate is unavailable.`};
    return {rate:rate.toFixed(2)+suffix,rank:rank>0?'#'+rank:'—',hours:`${hours.toFixed(2)} Sales/Hour workday hour${hours===1?'':'s'} this week · authenticated session/area model · one lunch hour excluded per day${provisional?` · Provisional until ${minimum.toFixed(0)} hour`:''}`};
  }

  function velocityTitle(rep,period){
    if(rep?.is_ghost&&ghostPeriodState(rep,period)?.revealed===false)return 'Ghost is #1; this total is private until a real user overtakes it.';
    const metric=rep?.ranking_velocity?.[period]||{},seconds=Number(metric.elapsed_seconds);
    if(!Number.isFinite(seconds))return 'No tie-speed window is available for this period.';
    const hours=seconds/3600;
    return `Tie speed: ${hours<1?(seconds/60).toFixed(1)+' minutes':hours.toFixed(2)+' hours'} from first to latest qualifying sale. Faster accumulation wins equal totals.`;
  }

  function renderGhostAdminSettings(data){
    const root=document.getElementById('ghostRankingAdminSettings'),settings=data?.ghost_admin_settings;
    if(!root)return;
    root.replaceChildren();
    root.hidden=!settings;
    if(!settings)return;
    root.className='ghost-ranking-admin';
    const minimums=settings.minimums||{};
    root.innerHTML='<strong>👻 Ghost Ranking Records · Admin Controlled</strong><p>Overtake comparison stays active. Ghost test sales remain available for testing and accounting, but Admin-set records control Ghost\'s day, week, month, and year rankings.</p><div class="ghost-goal-grid"><label>Best Day<input id="ghostDayGoal" type="number" inputmode="numeric"></label><label>Best Week<input id="ghostWeekGoal" type="number" inputmode="numeric"></label><label>Best Month<input id="ghostMonthGoal" type="number" inputmode="numeric"></label><label>Best Year<input id="ghostYearGoal" type="number" inputmode="numeric"></label></div><div class="ghost-ranking-actions"><button id="saveGhostRankingGoals" class="primary" type="button">Save Ghost Records</button><span id="ghostRankingSaveStatus" role="status" aria-live="polite"></span></div>';
    const fields=[
      ['ghostDayGoal','day_goal',minimums.day||3],
      ['ghostWeekGoal','week_goal',minimums.week||15],
      ['ghostMonthGoal','month_goal',minimums.month||30],
      ['ghostYearGoal','year_goal',minimums.year||600]
    ];
    for(const [id,key,minimum] of fields){const input=document.getElementById(id);input.min=String(minimum);input.max=key==='year_goal'?'100000':key==='month_goal'?'20000':key==='week_goal'?'5000':'1000';input.value=String(Number(settings[key]||minimum));}
    const save=document.getElementById('saveGhostRankingGoals'),status=document.getElementById('ghostRankingSaveStatus');
    save.disabled=settings.can_edit!==true;
    save.onclick=async()=>{
      save.disabled=true;status.textContent='Saving…';
      try{
        const values=Object.fromEntries(fields.map(([id,key,minimum])=>[key,Math.trunc(Number(document.getElementById(id).value)||minimum)]));
        const {data,error}=await sb.rpc('admin_set_ghost_ranking_goals',{
          p_day_goal:values.day_goal,p_week_goal:values.week_goal,
          p_month_goal:values.month_goal,p_year_goal:values.year_goal
        });
        if(error)throw error;
        status.textContent='Ghost ranking records saved.';
        await loadLeaders();
      }catch(error){
        console.error('Ghost record update failed',error);
        status.textContent=error?.message||'Unable to save Ghost records.';
      }finally{save.disabled=settings.can_edit!==true;}
    };
  }

  function ensureDashboardRankings(){
    const dashboard=document.getElementById('dashboard');
    if(!dashboard)return null;
    let card=document.getElementById('dashboardRepRankings');
    if(card)return card;
    card=document.createElement('div');
    card.className='card rep-rankings-card';
    card.id='dashboardRepRankings';
    card.innerHTML='<div class="rep-rankings-head"><div><h2>Sales Rankings</h2><p>Every active McCoy user, regardless of role, ranked by provider-verified eligible sales.</p><p id="rankingAuthorityStatus" class="rep-ranking-person">Loading authoritative rankings…</p></div><div class="rep-ranking-controls"><select id="repRankingPeriod" aria-label="Choose ranking period"><option value="today">Today</option><option value="week" selected>This Week</option><option value="month">This Month</option><option value="year">This Year</option></select><button id="repRankingsRefresh" class="assign-btn">Refresh</button></div></div><div id="ghostRankingAdminSettings" hidden></div><div class="rep-ranking-summary"><div class="rep-ranking-stat"><span id="repPersonalRankLabel">Your Rank</span><strong id="repPersonalRank">—</strong></div><div class="rep-ranking-stat"><span>Sales Today</span><strong id="repPersonalToday">0</strong></div><div class="rep-ranking-stat"><span>Sales This Week</span><strong id="repPersonalWeek">0</strong></div><div class="rep-ranking-stat"><span>Sales This Month</span><strong id="repPersonalMonth">0</strong></div><div class="rep-ranking-stat"><span>Sales This Year</span><strong id="repPersonalYear">0</strong></div><div class="rep-ranking-stat"><span>Sales / Hour This Week</span><strong id="repPersonalSalesPerHour">—</strong></div></div><h3 class="rep-records-title">Personal Sales Records</h3><div class="rep-record-grid"><div class="rep-record-stat"><span>Best Day</span><strong id="repRecordDay">0</strong><small id="repRecordDayWhen">No verified sales yet</small></div><div class="rep-record-stat"><span>Best Week</span><strong id="repRecordWeek">0</strong><small id="repRecordWeekWhen">No verified sales yet</small></div><div class="rep-record-stat"><span>Best Month</span><strong id="repRecordMonth">0</strong><small id="repRecordMonthWhen">No verified sales yet</small></div><div class="rep-record-stat"><span>Best Year</span><strong id="repRecordYear">0</strong><small id="repRecordYearWhen">No verified sales yet</small></div></div><p id="repRankingPerson" class="rep-ranking-person"></p><div class="rep-ranking-table-wrap"><table class="rep-ranking-table" aria-label="Individual user sales rankings, weekly sales per hour, and personal records"><thead><tr><th scope="col">Rank</th><th scope="col">User</th><th scope="col">Today</th><th scope="col">This Week</th><th scope="col">This Month</th><th scope="col">This Year</th><th scope="col">Sales/Hr (Week)</th><th scope="col">SPH Rank</th><th scope="col">Best Day</th><th scope="col">Best Week</th><th scope="col">Best Month</th><th scope="col">Best Year</th></tr></thead><tbody id="repRankingRows"><tr><td colspan="12">Loading user rankings…</td></tr></tbody></table></div>';
    const rankingIntro=card.querySelector('.rep-rankings-head p');
    if(rankingIntro)rankingIntro.textContent='Every active McCoy user, regardless of role, ranked immediately from completed McCoy sales. Later cancellations affect accounting only and do not remove ranking credit.';
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
    renderGhostAdminSettings(data);
    const allRankings=Array.isArray(data.rankings)?data.rankings.slice():[];
    const rankings=allRankings.filter(rep=>ghostVisibleFor(rep,selectedRankingPeriod));
    rankings.sort((left,right)=>(left.ranks?.[selectedRankingPeriod]||Number.MAX_SAFE_INTEGER)-(right.ranks?.[selectedRankingPeriod]||Number.MAX_SAFE_INTEGER));
    const personal=data.current_rep||rankings.find(rep=>rep.is_current_user)||null;
    const highlighted=personal||rankings[0]||null;
    const title=document.getElementById('repPersonalRankLabel');
    if(title)title.textContent=personal?'Your Rank':'Top Rep Rank';
    const rank=document.getElementById('repPersonalRank');
    const movement=Number(highlighted?.rank_movement?.[selectedRankingPeriod]||0),movementLabel=movement>0?` ↑${movement}`:movement<0?` ↓${Math.abs(movement)}`:'';
    const highlightedRank=highlighted?.ranks?.[selectedRankingPeriod];
    if(rank)rank.textContent=highlighted?(highlightedRank?'#'+highlightedRank+movementLabel:'Hidden'):'—';
    for(const [period,id] of [['today','repPersonalToday'],['week','repPersonalWeek'],['month','repPersonalMonth'],['year','repPersonalYear']]){
      const stat=document.getElementById(id);
      if(stat)stat.textContent=highlighted?rankingMetric(highlighted,period):'0';
    }
    const personalSph=document.getElementById('repPersonalSalesPerHour'),sph=salesPerHourMetric(highlighted);
    if(personalSph){personalSph.textContent=sph.rate;personalSph.title=sph.hours;}
    for(const [period,countId,whenId] of [['day','repRecordDay','repRecordDayWhen'],['week','repRecordWeek','repRecordWeekWhen'],['month','repRecordMonth','repRecordMonthWhen'],['year','repRecordYear','repRecordYearWhen']]){
      const record=highlighted?.personal_records?.[period]||{},count=document.getElementById(countId),when=document.getElementById(whenId);
      const ghostPeriod=period==='day'?'today':period,state=ghostPeriodState(highlighted,ghostPeriod);
      if(count)count.textContent=highlighted?.is_ghost&&state?.revealed===false?'Hidden':String(Number(record.count||0));
      if(when)when.textContent=highlighted?.is_ghost?(state?.revealed===false?'Reveals when a real user overtakes Ghost':'Verified Ghost-account record'):recordPeriodLabel(period,record.period_start);
    }
    const person=document.getElementById('repRankingPerson');
    if(person)person.textContent=highlighted?(highlighted.is_ghost?'Ghost is always ranked from verified Ghost-account sales. Its total is public only while a real user holds #1 for this period.':(personal?'Your sales · ':'Leading rep: '+highlighted.rep_name+' · ')+'Ranked by '+rankingLabels[selectedRankingPeriod]+'. '+Number(highlighted.pending_review_sales||0)+' pending review.'):'No active representatives are available.';
    const authority=document.getElementById('rankingAuthorityStatus');
    if(authority){const updated=data.generated_at?new Date(data.generated_at).toLocaleString():'now';const pending=Number(data.pending_review_sales||0);authority.textContent=`Official database ranking · Updated ${updated} · Completed McCoy sales rank immediately · ${pending} excluded record${pending===1?'':'s'} (abandoned, incomplete, rejected, or not-a-sale) · Provider verification remains separate for accounting · Sales/Hr is provisional below 1 tracked field hour and generated from authenticated McCoy workday sessions · Equal totals: faster accumulation wins.`;}
    const body=document.getElementById('repRankingRows');
    if(!body)return;
    body.replaceChildren();
    if(!rankings.length){
      const empty=document.createElement('tr'),cell=document.createElement('td');
      cell.colSpan=12;cell.className='rep-ranking-empty';cell.textContent='No active representatives yet.';empty.appendChild(cell);body.appendChild(empty);
      return;
    }
    for(const rep of rankings){
      const row=document.createElement('tr');
      if(rep.is_current_user)row.classList.add('current-rep');if(rep.is_ghost)row.classList.add('ghost-ranking-row');
      const change=Number(rep.rank_movement?.[selectedRankingPeriod]||0),changeLabel=change>0?` ↑${change}`:change<0?` ↓${Math.abs(change)}`:'';
      const rankCell=createRankingCell(row,'#'+rep.ranks[selectedRankingPeriod]+changeLabel);rankCell.title=velocityTitle(rep,selectedRankingPeriod);
      const name=createRankingCell(row,rep.rep_name||'Rep');
      if(rep.is_current_user){const badge=document.createElement('span');badge.className='rep-ranking-you';badge.textContent='You';name.appendChild(badge);}
      if(rep.is_ghost){const badge=document.createElement('span');badge.className='ghost-ranking-badge';badge.textContent='GHOST';name.appendChild(badge);}
      for(const period of ['today','week','month','year'])createRankingCell(row,rankingMetric(rep,period));
      const repSph=salesPerHourMetric(rep),sphCell=createRankingCell(row,repSph.rate),sphRankCell=createRankingCell(row,repSph.rank);sphCell.title=repSph.hours;sphRankCell.title=repSph.hours;
      for(const period of ['day','week','month','year'])createRecordCell(row,rep,period);
      body.appendChild(row);
    }
  }

  ensureDashboardRankings();

  async function invoke(name,body){const {data,error}=await sb.functions.invoke(name,body?{body}:undefined);if(error)throw error;return data;}
  async function loadPayProgress(){try{const d=await invoke('pay-progress');if(!d?.ok)return;const main=document.getElementById('payProgressMain'),sub=document.getElementById('payProgressSub');if(!main||!sub)return;const estimate=Number(d.estimated_weekly_commission||0).toLocaleString('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}),weekLabel=recordPeriodLabel('week',d.week_start),dateRule=`Current week: ${weekLabel}, based on order entry date.`;if(!d.pay_level_assigned){main.textContent=`${d.weekly_sales} sales this week — pay level not assigned`;sub.textContent=`${dateRule} Ask an Admin to assign your commission pay level before the next sale. Verified sales remain recorded, but an exact commission estimate is unavailable.`;return;}const progress=d.next_threshold==null?'highest extra-pay tier reached':`${d.sales_needed_for_next} more to reach ${d.next_threshold}`;main.textContent=`${d.pay_level_label} · ${d.weekly_sales} sales · ${progress}`;sub.textContent=`${dateRule} Estimated qualifying commission: ${estimate}. Current production increase: +$${d.current_increase_per_sale}/sale.${d.unpriced_sales?` ${d.unpriced_sales} sale${d.unpriced_sales===1?'':'s'} need Accounting review.`:''} ISP verification, Admin approval when required, installs, provider payment, and chargebacks control final pay.`;}catch(e){console.error('Pay progress failed',e);}}

  async function loadLeaders(){
    try{
      const data=await invoke('company-leaders');
      if(!data?.ok)return;
      const map=[['today','leadToday','leadTodayCount'],['week','leadWeek','leadWeekCount'],['month','leadMonth','leadMonthCount'],['year','leadYear','leadYearCount'],['all_time','leadAll','leadAllCount']];
      for(const [key,nameId,countId] of map){
        const leader=data.leaders?.[key],name=document.getElementById(nameId),count=document.getElementById(countId);
        if(name)name.textContent=leader?.name||'No sales yet';
        if(count)count.textContent=leader?(leader.hidden||leader.count==null?'Hidden':leader.count+' sale'+(leader.count===1?'':'s')):'';
      }
      renderDashboardRankings(data);
    }catch(error){
      console.error('Company leaders failed',error);
      const rows=document.getElementById('repRankingRows');
      if(rows){rows.replaceChildren();const row=document.createElement('tr'),cell=document.createElement('td');cell.colSpan=12;cell.textContent='Unable to load rankings right now. Please refresh.';row.appendChild(cell);rows.appendChild(row);}
    }
  }

  const btn=document.createElement('button');btn.id='compBtn';btn.textContent='Compensation Controls';document.body.appendChild(btn);
  const panel=document.createElement('div');panel.id='compPanel';panel.innerHTML='<div class="comp-card"><h2>Compensation & Sale Controls</h2><div class="comp-muted">Only Admin and authorized Accounting can view this panel. Only Admin can change settings or approve outside-system sales.</div><div id="compContent" style="margin-top:12px">Loading…</div><div class="comp-actions"><button id="compClose" class="assign-btn">Close</button></div></div>';document.body.appendChild(panel);
  document.getElementById('compClose').onclick=()=>panel.classList.remove('show');

  async function authFetch(method='GET',body=null){const {data:{session}}=await sb.auth.getSession();if(!session)throw new Error('not_signed_in');const r=await fetch(SUPABASE_URL+'/functions/v1/compensation-settings',{method,headers:{Authorization:'Bearer '+session.access_token,apikey:SUPABASE_PUBLISHABLE_KEY,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'request_failed');return d;}
  async function probe(){try{await authFetch();btn.style.display='block';}catch{btn.style.display='none';}}
  btn.onclick=async()=>{panel.classList.add('show');await loadControls();};

  function checkbox(id,on,disabled){return `<label><input id="${id}" type="checkbox" ${on?'checked':''} ${disabled?'disabled':''}> ${on?'On':'Off'}</label>`;}
  function overrideButtons(id,on,disabled){return `<div class="override-choice" role="group" aria-label="Manager override authority"><button id="${id}On" type="button" class="${on?'active on':''}" aria-pressed="${on?'true':'false'}" ${disabled?'disabled':''}>ON</button><button id="${id}Off" type="button" class="${on?'':'active off'}" aria-pressed="${on?'false':'true'}" ${disabled?'disabled':''}>OFF</button></div>`;}
  function esc(value){return String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));}
  function money(value){return Number.isFinite(Number(value))?'$'+Number(value).toLocaleString('en-US'):'—';}
  function payScaleMarkup(scale){if(!scale)return '<div class="comp-muted">Pay scale is unavailable.</div>';const levels=scale.levels||[];const row=(label,values)=>`<tr><td>${label}</td>${levels.map(level=>`<td>${money(values?.[level.key])}</td>`).join('')}</tr>`;return `<div class="pay-scale-wrap"><table class="pay-scale-table"><thead><tr><th>Product / speed</th>${levels.map(level=>`<th>${level.label}</th>`).join('')}</tr></thead><tbody>${row('Quantum',scale.quantum)}${row('Brightspeed below 1 Gig',scale.brightspeed?.below_1_gig)}${row('Brightspeed 1 Gig',scale.brightspeed?.['1_gig'])}${row('Brightspeed 2+ Gig',scale.brightspeed?.['2_gig'])}${row('AT&T Fiber below 1 Gig',scale.att?.fiber_below_1_gig)}${row('AT&T Fiber 1+ Gig',scale.att?.fiber_1_gig)}</tbody></table></div><div class="comp-muted" style="margin-top:8px">AT&T Internet Air: ${money(scale.att?.internet_air)} · AT&T Mobile: ${money(scale.att?.mobile_first_line)} first line + ${money(scale.att?.mobile_additional_line)} each additional line. DIRECTV and Vivint remain unconfigured pending exact service payouts.</div>`;}
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
        <div class="comp-section" style="border-top:0;margin-top:0;padding-top:0"><strong>100% Commission Pay Scale</strong><div class="comp-muted">Base commission is captured from the rep's assigned pay level when each sale is submitted.</div>${payScaleMarkup(d.pay_scale)}</div>
        <div class="comp-section"><strong>Manager Overrides — Master Switch</strong><div class="comp-row"><div><div>All manager overrides</div><div class="comp-muted">Off disables every manager override regardless of lower-level settings.</div></div>${checkbox('globalOverride',d.global_manager_overrides_enabled,!edit)}</div></div>
        <div class="comp-section"><strong>Weekly Production Pay Thresholds</strong><div class="comp-muted">Only ISP-verified sales count. Outside-system sales must also be approved by an Admin.</div><div class="comp-row"><span>+$${t1.increase_per_sale}/sale begins at</span><span><input id="tier1Min" type="number" min="1" value="${t1.min_sales}" ${edit?'':'disabled'}> sales</span></div><div class="comp-row"><span>+$${t2.increase_per_sale}/sale begins at</span><span><input id="tier2Min" type="number" min="2" value="${t2.min_sales}" ${edit?'':'disabled'}> sales</span></div>${edit?'<button id="saveThresholds" class="primary" style="margin-top:8px">Save Thresholds</button>':''}</div>
        ${edit?'<div class="comp-section"><strong>Outside-System Sale Approvals</strong><div class="comp-muted">Approve a sale only after checking it against the appropriate ISP seller dashboard. Approval does not bypass ISP verification.</div><div id="outsideSaleApprovals">Loading pending sales…</div></div>':''}
        <div class="comp-section"><strong>Manager / Trainer Override Authority</strong><div class="comp-muted">Admin can activate or deactivate override credit for each Manager or Trainer. The setting is keyed to the team lead's login email and every change is audited.</div><div id="mgrRows"></div><div id="managerOverrideMessage" class="comp-muted" role="status" aria-live="polite"></div></div><div class="comp-section"><strong>Per Assigned Rep</strong><div class="comp-muted">Effective only if the master switch, team-lead switch, and rep switch are all on.</div><div id="repRows"></div></div>`;
      document.getElementById('mgrRows').innerHTML=(d.managers||[]).map((m,i)=>`<div class="comp-row"><div><strong>${esc(m.manager_name||m.manager_email||'Manager')}</strong>${m.manager_email?`<div class="comp-muted">${esc(m.manager_email)}</div>`:''}<div class="comp-muted">Override authority: ${m.overrides_enabled?'On':'Off'}</div></div>${overrideButtons('mgr'+i,m.overrides_enabled,!edit)}</div>`).join('')||'<div class="comp-muted">No active managers are available.</div>';
      document.getElementById('repRows').innerHTML=(d.reps||[]).map((r,i)=>`<div class="comp-row"><div><strong>${esc(r.display_name)}</strong><div class="comp-muted">Manager: ${esc(r.manager_name||r.manager_email||'Unassigned')} · Effective: ${r.effective_overrides_enabled?'On':'Off'}</div></div>${checkbox('rep'+i,r.overrides_enabled,!edit)}</div>`).join('')||'<div class="comp-muted">No assigned reps yet.</div>';
      if(edit){
        document.getElementById('globalOverride').onchange=async event=>{await authFetch('POST',{action:'set_global_manager_overrides',enabled:event.target.checked});await loadControls();};
        (d.managers||[]).forEach((manager,index)=>{for(const [suffix,enabled] of [['On',true],['Off',false]])document.getElementById('mgr'+index+suffix).onclick=async event=>{const row=event.currentTarget.closest('.override-choice'),buttons=[...row.querySelectorAll('button')],message=document.getElementById('managerOverrideMessage');buttons.forEach(button=>button.disabled=true);message.textContent=`Saving ${manager.manager_name||manager.manager_email}…`;try{await authFetch('POST',{action:'set_manager_override',manager_email:manager.manager_email,overrides_enabled:enabled});await loadControls();document.getElementById('managerOverrideMessage').textContent=`Manager override authority turned ${enabled?'On':'Off'} for ${manager.manager_name||manager.manager_email}.`;}catch(error){buttons.forEach(button=>button.disabled=false);message.textContent=error?.message||'Unable to update manager override authority.';}};});
        (d.reps||[]).forEach((rep,index)=>{document.getElementById('rep'+index).onchange=async event=>{await authFetch('POST',{action:'set_rep_override',rep_email:rep.email,overrides_enabled:event.target.checked});await loadControls();};});
        document.getElementById('saveThresholds').onclick=async()=>{await authFetch('POST',{action:'set_weekly_thresholds',tier1_min_sales:Number(document.getElementById('tier1Min').value),tier2_min_sales:Number(document.getElementById('tier2Min').value)});await loadControls();await loadPayProgress();};
        await loadSaleApprovals();
      }
    }catch(error){root.textContent='Unable to load compensation controls.';console.error(error);}
  }

  const poll=setInterval(()=>{if(!window.MCCOY_ACCESS?.user)return;clearInterval(poll);loadPayProgress();loadLeaders();probe();setInterval(()=>{loadPayProgress();loadLeaders();},60000);},400);
  window.MCCOY_REFRESH_RANKINGS=()=>Promise.all([loadPayProgress(),loadLeaders()]);
  window.addEventListener('mccoy-sale-saved',()=>{loadPayProgress();loadLeaders();});
  window.addEventListener('mccoy-live-sales-changed',()=>{loadPayProgress();loadLeaders();});
  document.querySelector('.nav-btn[data-view="dashboard"]')?.addEventListener('click',()=>{if(window.MCCOY_ACCESS?.user)loadLeaders();});
})();
