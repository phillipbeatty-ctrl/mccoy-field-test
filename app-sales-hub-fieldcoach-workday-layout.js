// Final Sales Hub placement override for the approved compact preview.
// Sales / Hour Workday sits directly beneath Background Mode inside Field Session.
// Field Coach occupies the former Workday row beneath the first two columns.
// Explicit events and bounded retries only; no DOM observer.
(function(){
  if(window.MCCOY_FIELDCOACH_WORKDAY_LAYOUT)return;
  window.MCCOY_FIELDCOACH_WORKDAY_LAYOUT=true;

  const byId=id=>document.getElementById(id);
  const style=document.createElement('style');
  style.id='salesHubFieldCoachWorkdayLayoutStyles';
  style.textContent=`
    #salesHubTopGrid{
      grid-template-areas:"field middle door" "coach coach door"!important
    }
    #salesHubTopGrid .sales-hub-field-session .sales-hub-workday{
      grid-area:auto!important;grid-column:1/-1!important;
      width:100%!important;min-width:0!important;min-height:0!important;height:auto!important;
      margin:0!important;padding:7px 8px!important;align-self:stretch!important;
      border-radius:8px!important;box-shadow:none!important;background:#f8fafc!important
    }
    #salesHubTopGrid .sales-hub-field-session .sales-hub-workday .sph-workday-summary{min-height:29px!important;gap:7px!important}
    #salesHubTopGrid .sales-hub-field-session .sales-hub-workday .sph-workday-copy{gap:1px!important}
    #salesHubTopGrid .sales-hub-field-session .sales-hub-workday .sph-workday-title{font-size:8px!important}
    #salesHubTopGrid .sales-hub-field-session .sales-hub-workday #sphHomeAddressDisplay{font-size:10px!important;line-height:1.2!important}
    #salesHubTopGrid .sales-hub-field-session .sales-hub-workday #sphEditHome{min-width:48px!important;min-height:28px!important;padding:5px 8px!important;font-size:9px!important}
    #salesHubTopGrid .sales-hub-field-coach{
      grid-area:coach!important;min-width:0;min-height:116px;height:auto;
      margin:0!important;padding:12px 14px!important;align-self:stretch
    }
    #salesHubTopGrid .sales-hub-field-coach .card-head{margin-bottom:7px!important}
    #salesHubTopGrid .sales-hub-field-coach #fieldPerformanceLabel{margin-bottom:6px!important}
    #salesHubTopGrid .sales-hub-field-coach #coachMetricsBody{font-size:10px;line-height:1.35}
    @media(max-width:900px){
      #salesHubTopGrid{grid-template-areas:"field" "coach" "door" "middle"!important}
      #salesHubTopGrid .sales-hub-field-coach{min-height:auto}
      #salesHubTopGrid .sales-hub-field-session #sphWorkdayControl{grid-column:1/-1!important}
    }
    @media(max-width:560px){
      #salesHubTopGrid .sales-hub-field-session .sales-hub-workday{padding:7px!important}
      #salesHubTopGrid .sales-hub-field-session .sales-hub-workday #sphHomeAddressDisplay{white-space:normal!important}
    }
  `;
  document.head.appendChild(style);

  function mount(){
    const top=byId('salesHubTopGrid');
    const fieldSession=byId('startKnockingBtn')?.closest('.card');
    const middle=byId('salesHubMiddleStack');
    const door=byId('fieldLeadSelect')?.closest('.card');
    const workday=byId('sphWorkdayControl');
    const coach=byId('coachMetrics');
    const controls=fieldSession?.querySelector('.field-controls');
    if(!top||!fieldSession||!middle||!door||!workday||!coach||!controls)return false;

    workday.classList.add('sales-hub-workday','sales-hub-workday-inline');
    coach.classList.add('sales-hub-field-coach');

    const background=byId('backgroundModePanel');
    if(background&&controls.contains(background)){
      if(background.nextElementSibling!==workday)background.insertAdjacentElement('afterend',workday);
    }else if(workday.parentElement!==controls){
      controls.appendChild(workday);
    }

    if(coach.parentElement!==top)top.appendChild(coach);
    top.replaceChildren(fieldSession,middle,door,coach);

    const directlyBelow=!background||!controls.contains(background)||background.nextElementSibling===workday;
    window.dispatchEvent(new CustomEvent('mccoy-sales-hub-fieldcoach-workday-layout-ready',{detail:{directlyBelow,fieldCoachReady:true}}));
    return workday.parentElement===controls&&coach.parentElement===top&&directlyBelow;
  }

  function schedule(){[0,80,220,500,900,1500,2800,4500,7000].forEach(delay=>setTimeout(mount,delay));}
  document.addEventListener('click',event=>{if(event.target?.closest?.('.nav-btn[data-view="field"]'))schedule();},true);
  for(const name of ['mccoy-access-ready','mccoy-sale-saved','mccoy-sph-workday-ready','mccoy-background-mode-ready','mccoy-background-mode-changed'])window.addEventListener(name,schedule);
  window.addEventListener('mccoy-sales-hub-layout-ready',()=>setTimeout(mount,0));
  schedule();
})();
