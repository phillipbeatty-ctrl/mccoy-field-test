// Approved compact Sales Hub layout:
// Field Session | (Live Stats over Pay) | Door Workflow, with the compact
// Sales / Hour Workday spanning beneath the first two columns.
// Uses bounded retries and explicit events only; no DOM observer.
(function(){
  if(window.MCCOY_SALES_HUB_COMPACT_LAYOUT)return;
  window.MCCOY_SALES_HUB_COMPACT_LAYOUT=true;

  const byId=id=>document.getElementById(id);
  const style=document.createElement('style');
  style.id='salesHubCompactLayoutStyles';
  style.textContent=`
    #field.view.active{padding:14px 16px 24px}
    #salesHubTopGrid{
      display:grid;min-width:0;
      grid-template-columns:minmax(250px,.94fr) minmax(230px,.78fr) minmax(390px,1.28fr);
      grid-template-areas:"field middle door" "workday workday door";
      gap:8px;align-items:stretch;margin:0 0 8px
    }
    #salesHubTopGrid>.card,#salesHubMiddleStack>.card{min-width:0;overflow:hidden;border-radius:12px;padding:14px}
    #salesHubTopGrid .sales-hub-field-session{grid-area:field;min-height:330px;height:100%}
    #salesHubMiddleStack{grid-area:middle;display:grid;grid-template-rows:minmax(0,1fr) minmax(0,1fr);gap:8px;min-width:0}
    #salesHubTopGrid .sales-hub-door-workflow{grid-area:door;min-height:404px;height:100%;padding:13px}
    #salesHubTopGrid .sales-hub-workday{grid-area:workday;min-height:58px;height:auto;margin:0!important;padding:9px 12px!important;align-self:stretch}
    #salesHubTopGrid .sales-hub-workday .sph-workday-summary{min-height:38px}
    #salesHubTopGrid .sales-hub-workday #sphHomeAddressDisplay{font-size:13px}
    #salesHubTopGrid .sales-hub-workday #sphEditHome{min-height:32px;padding:6px 10px}
    #salesHubMiddleStack .sales-hub-live-stats,#salesHubMiddleStack #payProgressCard{min-height:161px;height:100%;margin:0!important;padding:14px!important}
    #salesHubTopGrid .card-head{margin-bottom:10px}
    #salesHubTopGrid .card-head h2{font-size:15px}
    #salesHubTopGrid .card-head p{font-size:10px;line-height:1.3;margin:3px 0 0}
    #salesHubTopGrid .sales-hub-field-session .field-controls{gap:8px}
    #salesHubTopGrid .sales-hub-field-session .field-state{font-size:18px;margin-bottom:1px}
    #salesHubTopGrid .sales-hub-field-session .big{padding:9px 11px;min-height:34px}
    #salesHubTopGrid .sales-hub-field-session .geo-box,#salesHubTopGrid .sales-hub-field-session .gps-quality{padding:8px 9px;border-radius:8px;font-size:10px}
    #salesHubTopGrid .sales-hub-field-session #backgroundModePanel{gap:5px!important;margin-top:0!important;padding:8px!important}
    #salesHubTopGrid .sales-hub-field-session #backgroundModePanel>div:first-child{gap:6px!important}
    #salesHubTopGrid .sales-hub-field-session #backgroundModePanel strong{font-size:9px}
    #salesHubTopGrid .sales-hub-field-session #backgroundModePanel .muted{font-size:8px;line-height:1.25}
    #salesHubTopGrid .sales-hub-field-session #backgroundModeToggle{padding:7px 9px;font-size:9px}
    #salesHubTopGrid .sales-hub-live-stats .mini-stats{gap:7px}
    #salesHubTopGrid .sales-hub-live-stats .mini-stats>div{padding:8px;border-radius:8px}
    #salesHubTopGrid .sales-hub-live-stats .mini-stats span{font-size:9px}
    #salesHubTopGrid .sales-hub-live-stats .mini-stats strong{font-size:17px;margin-top:3px}
    #salesHubMiddleStack #payProgressCard .pay-progress-main{font-size:16px;margin:7px 0 3px}
    #salesHubMiddleStack #payProgressCard .pay-progress-sub{font-size:10px;margin-top:4px}
    #salesHubMiddleStack #payProgressCard .card-head{margin-bottom:7px}
    #salesHubTopGrid .sales-hub-provider-bar{display:grid;grid-template-columns:auto minmax(0,1fr);align-items:center;gap:8px;margin:0 0 7px;padding:7px 8px;border-radius:8px;font-size:10px}
    #salesHubTopGrid .sales-hub-provider-bar strong{font-size:10px;white-space:nowrap}
    #salesHubTopGrid .sales-hub-provider-bar select{margin:0!important;min-width:0;padding:7px 8px!important;font-size:10px}
    #salesHubTopGrid #closestDoorAddress{margin:0 0 7px!important;padding:7px 8px!important;font-size:9px!important;border-radius:8px!important}
    #salesHubDoorPrimary{display:flex;min-width:0;gap:7px;align-items:flex-end}
    #salesHubDoorPrimary label{display:grid;gap:3px;flex:1;min-width:0;font-size:9px;font-weight:800}
    #salesHubDoorPrimary label>span{display:block}
    #salesHubDoorPrimary #fieldLeadSelect{width:100%;min-width:0;max-width:100%;margin:0;padding:7px 8px;border-radius:7px;font-size:10px}
    #salesHubDoorPrimary #arriveDoorBtn{flex:0 0 92px;width:92px;min-width:0;height:34px;padding:7px 8px;font-size:10px}
    #salesHubDoorStatusRow{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:7px;margin-top:7px}
    #salesHubDoorStatusRow #doorVisitStatus{margin:0;padding:8px;border-radius:8px;font-size:9px}
    #salesHubDoorStatusRow .door-timer{display:flex;align-items:center;gap:7px;margin:0;padding:8px 10px;border-radius:8px}
    #salesHubDoorStatusRow .door-timer span{font-size:8px}
    #salesHubDoorStatusRow .door-timer strong{font-size:17px}
    #salesHubTopGrid .sales-hub-door-workflow .door-visit-panel{display:none!important}
    #salesHubTopGrid .sales-hub-door-workflow .spotio-disposition-panel{margin-top:9px;padding:0;border:0;background:transparent}
    #salesHubTopGrid .sales-hub-door-workflow .spotio-disposition-head{margin-bottom:6px}
    #salesHubTopGrid .sales-hub-door-workflow .spotio-disposition-head strong{font-size:11px}
    #salesHubTopGrid .sales-hub-door-workflow .spotio-disposition-head .muted{display:none}
    #salesHubTopGrid .sales-hub-door-workflow .pin-disposition-current{font-size:9px;padding:5px 7px}
    #salesHubTopGrid .sales-hub-door-workflow .spotio-disposition-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}
    #salesHubTopGrid .sales-hub-door-workflow .spotio-disposition-grid label{gap:3px;font-size:9px}
    #salesHubTopGrid .sales-hub-door-workflow .spotio-disposition-grid select{width:100%;min-width:0;max-width:100%;padding:7px 8px;border-radius:7px;font-size:10px}
    #salesHubTopGrid .sales-hub-door-workflow .pin-disposition-preview{padding:7px 8px;margin-top:7px;border-radius:8px;font-size:9px}
    #salesHubTopGrid .sales-hub-door-workflow .spotio-disposition-actions{display:flex;min-width:0;gap:6px;margin-top:8px}
    #salesHubTopGrid .sales-hub-door-workflow .spotio-disposition-actions button{flex:1 1 0;min-width:0;min-height:36px;padding:8px 7px;border-radius:8px;font-size:11px;line-height:1.05;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    #salesHubTopGrid .sales-hub-door-workflow #stageSalePhotoBtn{background:#0f766e!important;color:#fff!important;border:0!important}
    #salesHubTopGrid .sales-hub-door-workflow #salePhotoStageStatus{display:flex;align-items:center;justify-content:flex-end;gap:7px;min-height:15px;margin-top:5px;font-size:8px;color:#6b7280;text-align:right}
    #salesHubTopGrid .sales-hub-door-workflow #salePhotoStageStatus button{border:0;background:transparent;color:#0f766e;padding:0;font-size:8px;font-weight:900;cursor:pointer}
    #salesHubTopGrid .sales-hub-door-workflow details.sales-hub-door-tools,#salesHubTopGrid .sales-hub-door-workflow details.sales-hub-door-details{margin-top:7px;border-top:1px solid #e5e7eb;padding-top:6px}
    #salesHubTopGrid .sales-hub-door-workflow details>summary{font-size:9px;color:#64748b;font-weight:800;cursor:pointer}
    #salesHubTopGrid .sales-hub-door-workflow .calibration-panel{margin:7px 0 0;padding:8px;gap:7px}
    #salesHubTopGrid .sales-hub-door-workflow .activity-log,#salesHubTopGrid .sales-hub-door-workflow .efficiency-summary{margin-top:7px;padding-top:7px;font-size:9px}
    #salesHubTopGrid .sales-hub-door-workflow #saleModal{margin-top:9px}
    #salesHubTopGrid .sales-hub-door-workflow #saleModal .sale-form{padding:12px;border-radius:10px}
    #salesHubTopGrid .sales-hub-door-workflow #saleModal .sale-form h2{font-size:15px;margin-bottom:4px}
    #salesHubTopGrid .sales-hub-door-workflow #saleModal .sale-outcome-actions{gap:7px;margin-top:9px}
    #salesHubTopGrid .sales-hub-door-workflow #saleModal .sale-outcome-actions button{min-height:40px}
    #field>#coachMetrics,#field>#saleHubActivity,#field>.leaders-card,#field>#salesToCompleteCard{margin-top:8px!important;margin-bottom:8px!important}
    @media(max-width:1200px) and (min-width:901px){
      #salesHubTopGrid{grid-template-columns:minmax(225px,.9fr) minmax(205px,.72fr) minmax(340px,1.18fr)}
    }
    @media(max-width:900px){
      #field.view.active{padding:8px}
      #salesHubTopGrid{grid-template-columns:1fr;grid-template-areas:"field" "workday" "door" "middle";gap:7px}
      #salesHubTopGrid .sales-hub-field-session{min-height:auto}
      #salesHubTopGrid .sales-hub-workday{min-height:56px}
      #salesHubTopGrid .sales-hub-door-workflow{min-height:auto}
      #salesHubMiddleStack{grid-template-columns:1fr;grid-template-rows:auto;gap:7px}
      #salesHubMiddleStack .sales-hub-live-stats,#salesHubMiddleStack #payProgressCard{min-height:auto}
      #salesHubTopGrid .sales-hub-live-stats .mini-stats{grid-template-columns:repeat(4,minmax(0,1fr))}
      #salesHubTopGrid .sales-hub-live-stats .mini-stats>div{text-align:center;padding:7px 4px}
      #salesHubTopGrid .sales-hub-field-session .field-controls{grid-template-columns:1fr 1fr}
      #salesHubTopGrid .sales-hub-field-session .field-state,#salesHubTopGrid .sales-hub-field-session #startKnockingBtn,#salesHubTopGrid .sales-hub-field-session #stopKnockingBtn,#salesHubTopGrid .sales-hub-field-session #geoBox,#salesHubTopGrid .sales-hub-field-session #backgroundModePanel{grid-column:1/-1}
      #salesHubTopGrid .sales-hub-door-workflow .card-head p{display:none}
      #salesHubTopGrid .sales-hub-door-workflow #salePhotoStageStatus{justify-content:flex-start;text-align:left}
    }
    @media(max-width:560px){
      #salesHubTopGrid .sales-hub-workday{padding:8px 10px!important}
      #salesHubTopGrid .sales-hub-door-workflow .spotio-disposition-grid{grid-template-columns:1fr}
      #salesHubTopGrid .sales-hub-door-workflow .spotio-disposition-actions button{font-size:10px;padding:8px 4px}
      #salesHubDoorPrimary #arriveDoorBtn{flex-basis:84px;width:84px}
    }
  `;
  document.head.appendChild(style);

  function cardWithTitle(root,title){
    return [...root.querySelectorAll(':scope>.card,:scope>.grid-2>.card')].find(card=>card.querySelector('.card-head h2')?.textContent.trim()===title)||null;
  }

  function compactDoorWorkflow(doorCard){
    if(!doorCard)return;
    doorCard.classList.add('sales-hub-door-workflow');

    const providerBar=byId('sessionIsp')?.closest('.sales-card');
    if(providerBar&&doorCard.contains(providerBar))providerBar.classList.add('sales-hub-provider-bar');

    const select=byId('fieldLeadSelect');
    const arrive=byId('arriveDoorBtn');
    if(select&&arrive&&!byId('salesHubDoorPrimary')){
      const primary=document.createElement('div');primary.id='salesHubDoorPrimary';
      const label=document.createElement('label');
      const caption=document.createElement('span');caption.textContent='Selected address';
      select.parentNode?.insertBefore(primary,select);
      label.append(caption,select);primary.append(label,arrive);
    }

    const addressBox=byId('fieldLeadAddressInput')?.closest('.field-lead-combobox');
    const primary=byId('salesHubDoorPrimary');
    if(addressBox&&primary&&!primary.contains(addressBox)){
      const oldLabel=select.closest('label');
      primary.prepend(addressBox);addressBox.appendChild(select);oldLabel?.remove();
    }

    const status=byId('doorVisitStatus');
    const timer=byId('doorElapsed')?.closest('.door-timer');
    if(status&&timer&&!byId('salesHubDoorStatusRow')){
      const row=document.createElement('div');row.id='salesHubDoorStatusRow';
      const primary=byId('salesHubDoorPrimary');
      primary?.insertAdjacentElement('afterend',row);
      row.append(status,timer);
    }

    const calibration=doorCard.querySelector('.calibration-panel');
    if(calibration&&!byId('salesHubDoorTools')){
      const details=document.createElement('details');details.id='salesHubDoorTools';details.className='sales-hub-door-tools';
      const summary=document.createElement('summary');summary.textContent='Address reference tools';
      calibration.parentNode?.insertBefore(details,calibration);details.append(summary,calibration);
    }

    const activity=byId('activityLog'),efficiency=byId('efficiencySummary');
    if((activity||efficiency)&&!byId('salesHubDoorDetails')){
      const details=document.createElement('details');details.id='salesHubDoorDetails';details.className='sales-hub-door-details';
      const summary=document.createElement('summary');summary.textContent='Visit & efficiency details';details.append(summary);
      const modal=byId('saleModal');
      if(modal&&modal.parentElement===doorCard)doorCard.insertBefore(details,modal);else doorCard.appendChild(details);
      if(activity)details.appendChild(activity);if(efficiency)details.appendChild(efficiency);
    }

    const save=byId('savePinDispositionBtn');
    if(save){save.textContent='SAVE';save.title='Save disposition';save.setAttribute('aria-label','Save disposition');}
  }

  function mount(){
    const field=byId('field');if(!field)return false;
    const fieldSession=byId('startKnockingBtn')?.closest('.card');
    const liveStats=byId('elapsed')?.closest('.card')||cardWithTitle(field,'Live Session Stats');
    const pay=byId('payProgressCard');
    const door=byId('fieldLeadSelect')?.closest('.card');
    const workday=byId('sphWorkdayControl');
    if(!fieldSession||!liveStats||!door)return false;

    let top=byId('salesHubTopGrid');
    if(!top){
      top=field.querySelector(':scope>.grid-2');
      if(!top)return false;
      top.id='salesHubTopGrid';
      top.classList.remove('grid-2','field-session-top-grid');
      top.classList.add('sales-hub-top-grid');
    }

    let middle=byId('salesHubMiddleStack');
    if(!middle){middle=document.createElement('div');middle.id='salesHubMiddleStack';}
    fieldSession.classList.add('sales-hub-field-session');
    liveStats.classList.add('sales-hub-live-stats');
    if(pay)pay.classList.add('sales-hub-pay-progress');
    if(workday)workday.classList.add('sales-hub-workday');
    compactDoorWorkflow(door);

    if(fieldSession.parentElement!==top)top.appendChild(fieldSession);
    if(middle.parentElement!==top)top.appendChild(middle);
    if(door.parentElement!==top)top.appendChild(door);
    if(workday&&workday.parentElement!==top)top.appendChild(workday);
    if(liveStats.parentElement!==middle)middle.appendChild(liveStats);
    if(pay&&pay.parentElement!==middle)middle.appendChild(pay);
    top.replaceChildren(fieldSession,middle,door,...(workday?[workday]:[]));
    if(pay)middle.replaceChildren(liveStats,pay);else middle.replaceChildren(liveStats);

    window.dispatchEvent(new CustomEvent('mccoy-sales-hub-layout-ready',{detail:{workdayReady:!!workday}}));
    return !!pay&&!!workday;
  }

  function schedule(){[0,80,220,500,900,1500,2500].forEach(delay=>setTimeout(mount,delay));}
  document.addEventListener('click',event=>{if(event.target?.closest?.('.nav-btn[data-view="field"]'))schedule();},true);
  window.addEventListener('mccoy-access-ready',schedule);
  window.addEventListener('mccoy-sale-saved',schedule);
  window.addEventListener('mccoy-sph-workday-ready',schedule);
  schedule();
})();
