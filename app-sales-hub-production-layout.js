// Production Sales Hub layout: Field Session | wide Door Workflow | compact metrics stack.
// The metrics stack contains Live Session Stats, Weekly Pay Progress, and Sales / Hour Workday.
// Explicit events and bounded retries only; no document-wide DOM observer.
(function(){
  if(window.MCCOY_SALES_HUB_PRODUCTION_LAYOUT)return;
  window.MCCOY_SALES_HUB_PRODUCTION_LAYOUT=true;

  const byId=id=>document.getElementById(id);

  const style=document.createElement('style');
  style.id='salesHubProductionLayoutStyles';
  style.textContent=`
    #field.view.active{padding:12px 14px 22px;overflow-x:hidden}
    #salesHubProductionGrid{
      display:grid;
      grid-template-columns:clamp(250px,20vw,330px) minmax(0,1fr) clamp(220px,16vw,280px);
      grid-template-areas:"field door metrics";
      gap:6px;
      align-items:stretch;
      margin:0 0 6px;
      min-width:0
    }
    #salesHubProductionGrid>.card,
    #salesHubMetricsStack>.card{min-width:0;margin:0!important;border-radius:12px;padding:12px;overflow:hidden}
    #salesHubProductionGrid .sales-hub-field-session{grid-area:field;height:100%;align-self:stretch}
    #salesHubProductionGrid .sales-hub-door-workflow{grid-area:door;height:100%;align-self:stretch;padding:12px}
    #salesHubMetricsStack{
      grid-area:metrics;
      display:grid;
      grid-template-columns:minmax(0,1fr);
      grid-template-rows:auto minmax(0,1fr) auto;
      gap:6px;
      min-width:0;
      min-height:0;
      height:100%;
      align-self:stretch
    }
    #salesHubMetricsStack .sales-hub-live-stats{grid-row:1;min-height:0}
    #salesHubMetricsStack #payProgressCard{grid-row:2;min-height:0;height:100%;display:flex;flex-direction:column}
    #salesHubMetricsStack .sales-hub-workday{grid-row:3;min-height:0}

    #salesHubProductionGrid .card-head{margin-bottom:8px;gap:8px}
    #salesHubProductionGrid .card-head h2{font-size:14px;line-height:1.2}
    #salesHubProductionGrid .card-head p{font-size:9px;line-height:1.3;margin:2px 0 0}

    #salesHubProductionGrid .sales-hub-field-session .field-controls{gap:7px}
    #salesHubProductionGrid .sales-hub-field-session .field-state{font-size:18px;line-height:1.2;margin-bottom:0}
    #salesHubProductionGrid .sales-hub-field-session .big{min-height:36px;padding:9px 10px}
    #salesHubProductionGrid .sales-hub-field-session .geo-box,
    #salesHubProductionGrid .sales-hub-field-session .gps-quality{padding:8px 9px;border-radius:8px;font-size:10px;line-height:1.25}

    #salesHubProductionGrid .sales-hub-background-button-only{
      display:block!important;
      margin:0!important;
      padding:0!important;
      border:0!important;
      background:transparent!important;
      box-shadow:none!important
    }
    #salesHubProductionGrid .sales-hub-background-button-only #backgroundModeToggle{
      display:block!important;
      width:100%!important;
      min-height:36px!important;
      margin:0!important;
      padding:8px 10px!important;
      border-radius:8px!important;
      font-size:10px!important;
      text-align:center!important
    }

    #salesHubMetricsStack .sales-hub-live-stats .mini-stats{
      display:grid!important;
      grid-template-columns:repeat(2,minmax(0,1fr))!important;
      gap:6px!important
    }
    #salesHubMetricsStack .sales-hub-live-stats .mini-stats>div{min-width:0;padding:7px;border-radius:8px}
    #salesHubMetricsStack .sales-hub-live-stats .mini-stats span{font-size:8px;line-height:1.15}
    #salesHubMetricsStack .sales-hub-live-stats .mini-stats strong{font-size:16px;line-height:1.1;margin-top:3px}
    #salesHubMetricsStack #payProgressCard{padding:11px!important}
    #salesHubMetricsStack #payProgressCard>strong{font-size:14px;line-height:1.2}
    #salesHubMetricsStack #payProgressCard .pay-progress-main{font-size:14px;line-height:1.25;margin:6px 0 3px}
    #salesHubMetricsStack #payProgressCard .pay-progress-sub{font-size:9px;line-height:1.35;margin-top:3px}

    #salesHubMetricsStack .sales-hub-workday{padding:9px 10px!important}
    #salesHubMetricsStack .sales-hub-workday .sph-workday-summary{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:34px}
    #salesHubMetricsStack .sales-hub-workday .sph-workday-copy{display:grid;gap:2px;min-width:0}
    #salesHubMetricsStack .sales-hub-workday .sph-workday-title{font-size:8px!important;line-height:1.15}
    #salesHubMetricsStack .sales-hub-workday #sphHomeAddressDisplay{font-size:10px!important;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    #salesHubMetricsStack .sales-hub-workday #sphEditHome{flex:0 0 auto;min-width:48px;min-height:30px;padding:6px 8px;font-size:9px}

    #salesHubProductionGrid .sales-hub-provider-bar{display:grid;grid-template-columns:auto minmax(0,1fr);align-items:center;gap:7px;margin:0 0 6px;padding:7px 8px;border-radius:8px;font-size:9px}
    #salesHubProductionGrid .sales-hub-provider-bar strong{font-size:9px;white-space:nowrap}
    #salesHubProductionGrid .sales-hub-provider-bar select{margin:0!important;min-width:0;padding:7px 8px!important;font-size:10px}
    #salesHubProductionGrid #closestDoorAddress{margin:0 0 6px!important;padding:7px 8px!important;font-size:9px!important;border-radius:8px!important}
    #salesHubDoorPrimary{display:flex;min-width:0;gap:6px;align-items:flex-end}
    #salesHubDoorPrimary label{display:grid;gap:3px;flex:1;min-width:0;font-size:9px;font-weight:800}
    #salesHubDoorPrimary label>span{display:block}
    #salesHubDoorPrimary #fieldLeadSelect{width:100%;min-width:0;max-width:100%;margin:0;padding:8px;border-radius:7px;font-size:10px}
    #salesHubDoorPrimary #arriveDoorBtn{flex:0 0 94px;width:94px;min-width:0;height:36px;padding:7px 8px;font-size:10px}
    #salesHubDoorStatusRow{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px;margin-top:6px}
    #salesHubDoorStatusRow #doorVisitStatus{margin:0;padding:8px;border-radius:8px;font-size:9px}
    #salesHubDoorStatusRow .door-timer{display:flex;align-items:center;gap:7px;margin:0;padding:8px 10px;border-radius:8px}
    #salesHubDoorStatusRow .door-timer span{font-size:8px}
    #salesHubDoorStatusRow .door-timer strong{font-size:17px}
    #salesHubProductionGrid .sales-hub-door-workflow .door-visit-panel{display:none!important}
    #salesHubProductionGrid .sales-hub-door-workflow .spotio-disposition-panel{margin-top:8px;padding:0;border:0;background:transparent}
    #salesHubProductionGrid .sales-hub-door-workflow .spotio-disposition-head{margin-bottom:6px}
    #salesHubProductionGrid .sales-hub-door-workflow .spotio-disposition-head strong{font-size:11px}
    #salesHubProductionGrid .sales-hub-door-workflow .spotio-disposition-head .muted{display:none}
    #salesHubProductionGrid .sales-hub-door-workflow .pin-disposition-current{font-size:9px;padding:5px 7px}
    #salesHubProductionGrid .sales-hub-door-workflow .spotio-disposition-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}
    #salesHubProductionGrid .sales-hub-door-workflow .spotio-disposition-grid label{gap:3px;font-size:9px}
    #salesHubProductionGrid .sales-hub-door-workflow .spotio-disposition-grid select{width:100%;min-width:0;max-width:100%;padding:8px;border-radius:7px;font-size:10px}
    #salesHubProductionGrid .sales-hub-door-workflow .pin-disposition-preview{padding:7px 8px;margin-top:7px;border-radius:8px;font-size:9px}
    #salesHubProductionGrid .sales-hub-door-workflow .spotio-disposition-actions{display:flex;min-width:0;gap:6px;margin-top:8px}
    #salesHubProductionGrid .sales-hub-door-workflow .spotio-disposition-actions button{flex:1 1 0;min-width:0;min-height:36px;padding:8px 6px;border-radius:8px;font-size:10px;line-height:1.05;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    #salesHubProductionGrid .sales-hub-door-workflow #stageSalePhotoBtn{background:#0f766e!important;color:#fff!important;border:0!important}
    #salesHubProductionGrid .sales-hub-door-workflow #salePhotoStageStatus{display:flex;align-items:center;justify-content:flex-end;gap:7px;min-height:15px;margin-top:5px;font-size:8px;color:#6b7280;text-align:right}
    #salesHubProductionGrid .sales-hub-door-workflow #salePhotoStageStatus button{border:0;background:transparent;color:#0f766e;padding:0;font-size:8px;font-weight:900;cursor:pointer}
    #salesHubProductionGrid .sales-hub-door-workflow details.sales-hub-door-tools,
    #salesHubProductionGrid .sales-hub-door-workflow details.sales-hub-door-details{margin-top:7px;border-top:1px solid #e5e7eb;padding-top:6px}
    #salesHubProductionGrid .sales-hub-door-workflow details>summary{font-size:9px;color:#64748b;font-weight:800;cursor:pointer}
    #field>#coachMetrics,#field>#saleHubActivity,#field>.leaders-card,#field>#salesToCompleteCard{margin-top:6px!important;margin-bottom:6px!important}

    @media(max-width:1100px) and (min-width:761px){
      #salesHubProductionGrid{
        grid-template-columns:minmax(240px,.72fr) minmax(0,1.28fr);
        grid-template-areas:"field door" "metrics door"
      }
      #salesHubMetricsStack{grid-template-rows:auto auto auto;height:auto}
      #salesHubMetricsStack #payProgressCard{height:auto}
    }

    @media(max-width:760px){
      body.field-coach .sidebar{position:static!important;width:100%!important;min-height:0!important;height:auto!important;padding:10px 12px!important;display:block!important}
      body.field-coach .sidebar .brand{margin:0 0 8px!important}
      body.field-coach .sidebar nav{display:flex!important;gap:6px!important;overflow-x:auto!important;padding-bottom:2px!important;scrollbar-width:thin}
      body.field-coach .sidebar nav>*{flex:0 0 auto!important;width:auto!important;white-space:nowrap!important}
      body.field-coach .sidebar-footer{display:none!important}
      body.field-coach .main{margin-left:0!important;width:100%!important;min-width:0!important}
      body.field-coach .topbar{height:auto!important;min-height:62px!important;padding:12px 14px!important;gap:8px!important;align-items:flex-start!important}
      body.field-coach .topbar h1{font-size:21px!important}
      body.field-coach #pageSubtitle{white-space:normal!important;font-size:11px!important}
      #field.view.active{padding:7px!important}
      #salesHubProductionGrid{grid-template-columns:minmax(0,1fr);grid-template-areas:"field" "door" "metrics";gap:6px;width:100%;max-width:100%}
      #salesHubProductionGrid>.card,#salesHubMetricsStack>.card{width:100%;max-width:100%;min-width:0}
      #salesHubMetricsStack{grid-template-rows:auto;gap:6px;height:auto}
      #salesHubMetricsStack .sales-hub-live-stats,#salesHubMetricsStack #payProgressCard,#salesHubMetricsStack .sales-hub-workday{grid-row:auto;height:auto}
      #salesHubProductionGrid .sales-hub-field-session{height:auto}
      #salesHubProductionGrid .sales-hub-door-workflow{height:auto}
      #salesHubProductionGrid .sales-hub-door-workflow .card-head p{display:none}
      #salesHubProductionGrid .sales-hub-door-workflow #salePhotoStageStatus{justify-content:flex-start;text-align:left}
      #salesHubProductionGrid .sales-hub-workday #sphHomeAddressDisplay{white-space:normal}
    }

    @media(max-width:500px){
      #salesHubProductionGrid .sales-hub-door-workflow .spotio-disposition-grid{grid-template-columns:1fr}
      #salesHubDoorPrimary{display:grid;grid-template-columns:minmax(0,1fr) 86px;align-items:end}
      #salesHubDoorPrimary #arriveDoorBtn{width:86px;flex-basis:86px}
      #salesHubProductionGrid .sales-hub-door-workflow .spotio-disposition-actions button{font-size:9px;padding:8px 4px}
    }
  `;
  document.head.appendChild(style);

  function cardWithTitle(root,title){
    return [...root.querySelectorAll('.card')].find(card=>card.querySelector('.card-head h2')?.textContent.trim()===title)||null;
  }

  function makeBackgroundButtonOnly(fieldSession){
    const panel=byId('backgroundModePanel');
    const toggle=byId('backgroundModeToggle');
    if(!panel||!toggle||!fieldSession.contains(panel))return;
    if(toggle.parentElement!==panel)panel.appendChild(toggle);
    [...panel.children].forEach(child=>{if(child!==toggle)child.hidden=true;});
    panel.classList.add('sales-hub-background-button-only');
    toggle.hidden=false;
    toggle.removeAttribute('hidden');
  }

  function compactDoorWorkflow(doorCard){
    if(!doorCard)return;
    doorCard.classList.add('sales-hub-door-workflow');

    const providerBar=byId('sessionIsp')?.closest('.sales-card');
    if(providerBar&&doorCard.contains(providerBar))providerBar.classList.add('sales-hub-provider-bar');

    const select=byId('fieldLeadSelect');
    const arrive=byId('arriveDoorBtn');
    if(select&&arrive&&!byId('salesHubDoorPrimary')){
      const primary=document.createElement('div');
      primary.id='salesHubDoorPrimary';
      const label=document.createElement('label');
      const caption=document.createElement('span');
      caption.textContent='Selected address';
      select.parentNode?.insertBefore(primary,select);
      label.append(caption,select);
      primary.append(label,arrive);
    }

    const status=byId('doorVisitStatus');
    const timer=byId('doorElapsed')?.closest('.door-timer');
    if(status&&timer&&!byId('salesHubDoorStatusRow')){
      const row=document.createElement('div');
      row.id='salesHubDoorStatusRow';
      const primary=byId('salesHubDoorPrimary');
      primary?.insertAdjacentElement('afterend',row);
      row.append(status,timer);
    }

    const calibration=doorCard.querySelector('.calibration-panel');
    if(calibration&&!byId('salesHubDoorTools')){
      const details=document.createElement('details');
      details.id='salesHubDoorTools';
      details.className='sales-hub-door-tools';
      const summary=document.createElement('summary');
      summary.textContent='Address reference tools';
      calibration.parentNode?.insertBefore(details,calibration);
      details.append(summary,calibration);
    }

    const activity=byId('activityLog');
    const efficiency=byId('efficiencySummary');
    if((activity||efficiency)&&!byId('salesHubDoorDetails')){
      const details=document.createElement('details');
      details.id='salesHubDoorDetails';
      details.className='sales-hub-door-details';
      const summary=document.createElement('summary');
      summary.textContent='Visit & efficiency details';
      details.append(summary);
      const modal=byId('saleModal');
      if(modal&&modal.parentElement===doorCard)doorCard.insertBefore(details,modal);
      else doorCard.appendChild(details);
      if(activity)details.appendChild(activity);
      if(efficiency)details.appendChild(efficiency);
    }

    const save=byId('savePinDispositionBtn');
    if(save){
      save.textContent='SAVE';
      save.title='Save disposition';
      save.setAttribute('aria-label','Save disposition');
    }
  }

  function removeEmptyLegacyWrappers(field,grid){
    [...field.querySelectorAll(':scope>.grid-2')].forEach(wrapper=>{
      if(wrapper===grid)return;
      if(!wrapper.children.length)wrapper.remove();
    });
  }

  function mount(){
    const field=byId('field');
    if(!field)return false;

    const fieldSession=byId('startKnockingBtn')?.closest('.card');
    const liveStats=byId('elapsed')?.closest('.card')||cardWithTitle(field,'Live Session Stats');
    const door=byId('fieldLeadSelect')?.closest('.card');
    const pay=byId('payProgressCard');
    const workday=byId('sphWorkdayControl');
    if(!fieldSession||!liveStats||!door)return false;

    let grid=byId('salesHubProductionGrid');
    if(!grid){
      grid=document.createElement('div');
      grid.id='salesHubProductionGrid';
      field.insertBefore(grid,field.firstElementChild);
    }

    let metrics=byId('salesHubMetricsStack');
    if(!metrics){
      metrics=document.createElement('div');
      metrics.id='salesHubMetricsStack';
    }

    fieldSession.classList.add('sales-hub-field-session');
    liveStats.classList.add('sales-hub-live-stats');
    if(workday)workday.classList.add('sales-hub-workday');

    if(fieldSession.parentElement!==grid)grid.appendChild(fieldSession);
    if(door.parentElement!==grid)grid.appendChild(door);
    if(metrics.parentElement!==grid)grid.appendChild(metrics);
    if(liveStats.parentElement!==metrics)metrics.appendChild(liveStats);
    if(pay&&pay.parentElement!==metrics)metrics.appendChild(pay);
    if(workday&&workday.parentElement!==metrics)metrics.appendChild(workday);

    makeBackgroundButtonOnly(fieldSession);
    compactDoorWorkflow(door);
    removeEmptyLegacyWrappers(field,grid);

    const ready=fieldSession.parentElement===grid&&door.parentElement===grid&&liveStats.parentElement===metrics&&(!pay||pay.parentElement===metrics)&&(!workday||workday.parentElement===metrics);
    window.dispatchEvent(new CustomEvent('mccoy-sales-hub-layout-ready',{detail:{ready,layout:'wide-door-compact-metrics',metricsTwoByTwo:true}}));
    return ready;
  }

  function schedule(){
    [0,60,160,320,600,1000,1600,2600,4200,7000].forEach(delay=>setTimeout(mount,delay));
  }

  document.addEventListener('click',event=>{
    if(event.target?.closest?.('.nav-btn[data-view="field"]'))schedule();
  },true);

  for(const name of [
    'mccoy-access-ready',
    'mccoy-sale-saved',
    'mccoy-sale-credit-changed',
    'mccoy-sale-details-updated',
    'mccoy-sph-workday-ready',
    'mccoy-background-mode-ready',
    'mccoy-background-mode-changed'
  ])window.addEventListener(name,schedule);

  schedule();
})();
