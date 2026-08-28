// Corrected Sales Hub placement requested after physical iPad review.
// Left stack order: Field Session, Sales / Hour Workday, Live Session Stats,
// Weekly Pay Progress. Door Workflow occupies the full right column.
// Field Coach remains below the top grid. Explicit events and bounded retries only.
(function(){
  if(window.MCCOY_FIELDCOACH_WORKDAY_LAYOUT)return;
  window.MCCOY_FIELDCOACH_WORKDAY_LAYOUT=true;

  const byId=id=>document.getElementById(id);
  const style=document.createElement('style');
  style.id='salesHubFieldCoachWorkdayLayoutStyles';
  style.textContent=`
    #salesHubTopGrid{
      display:grid!important;
      grid-template-columns:minmax(280px,.72fr) minmax(430px,1.28fr)!important;
      grid-template-areas:"left door"!important;
      gap:6px!important;
      align-items:stretch!important;
      min-width:0!important;
      margin-bottom:6px!important
    }
    #salesHubLeftStack{
      grid-area:left;
      display:grid;
      grid-template-columns:minmax(0,1fr);
      grid-template-rows:auto auto auto minmax(0,1fr);
      gap:6px;
      min-width:0;
      min-height:0;
      height:100%;
      align-self:stretch
    }
    #salesHubLeftStack>.card{
      width:100%;
      min-width:0;
      margin:0!important;
      border-radius:12px;
      overflow:hidden
    }
    #salesHubLeftStack .sales-hub-field-session{
      grid-area:auto!important;
      min-height:0!important;
      height:auto!important;
      align-self:start!important
    }
    #salesHubLeftStack .sales-hub-workday{
      grid-area:auto!important;
      width:100%!important;
      min-width:0!important;
      min-height:0!important;
      height:auto!important;
      margin:0!important;
      padding:8px 10px!important;
      align-self:stretch!important
    }
    #salesHubLeftStack .sales-hub-workday .sph-workday-summary{min-height:34px!important;gap:8px!important}
    #salesHubLeftStack .sales-hub-workday .sph-workday-copy{gap:2px!important}
    #salesHubLeftStack .sales-hub-workday .sph-workday-title{font-size:9px!important;line-height:1.15!important}
    #salesHubLeftStack .sales-hub-workday #sphHomeAddressDisplay{font-size:11px!important;line-height:1.25!important;white-space:normal!important}
    #salesHubLeftStack .sales-hub-workday #sphEditHome{min-width:52px!important;min-height:30px!important;padding:6px 9px!important;font-size:10px!important}
    #salesHubLeftStack .sales-hub-live-stats{
      grid-area:auto!important;
      min-height:0!important;
      height:auto!important;
      margin:0!important;
      padding:12px!important
    }
    #salesHubLeftStack .sales-hub-live-stats .mini-stats{
      display:grid!important;
      grid-template-columns:repeat(2,minmax(0,1fr))!important;
      gap:6px!important
    }
    #salesHubLeftStack .sales-hub-live-stats .mini-stats>div{min-width:0;padding:8px!important;border-radius:8px}
    #salesHubLeftStack .sales-hub-live-stats .mini-stats span{font-size:9px!important;line-height:1.15}
    #salesHubLeftStack .sales-hub-live-stats .mini-stats strong{font-size:17px!important;line-height:1.1;margin-top:3px}
    #salesHubLeftStack #payProgressCard{
      grid-area:auto!important;
      min-height:0!important;
      height:100%!important;
      margin:0!important;
      padding:12px!important;
      display:flex!important;
      flex-direction:column;
      align-self:stretch!important
    }
    #salesHubLeftStack #payProgressCard .pay-progress-main{font-size:15px!important;line-height:1.25;margin:6px 0 3px!important}
    #salesHubLeftStack #payProgressCard .pay-progress-sub{font-size:10px!important;line-height:1.35;margin-top:3px!important}
    #salesHubTopGrid .sales-hub-door-workflow{
      grid-area:door!important;
      min-width:0!important;
      min-height:100%!important;
      height:100%!important;
      align-self:stretch!important;
      margin:0!important
    }
    #salesHubTopGrid .sales-hub-background-button-only{
      display:block!important;
      margin:0!important;
      padding:0!important;
      border:0!important;
      background:transparent!important;
      box-shadow:none!important
    }
    #salesHubTopGrid .sales-hub-background-button-only #backgroundModeToggle{
      display:block!important;
      width:100%!important;
      min-height:36px!important;
      margin:0!important;
      padding:8px 10px!important;
      border-radius:8px!important;
      font-size:10px!important;
      text-align:center!important
    }
    #field>.sales-hub-field-coach-below{
      width:100%;
      min-width:0;
      min-height:0;
      height:auto;
      margin:6px 0!important;
      padding:12px 14px!important
    }
    #field>.sales-hub-field-coach-below .card-head{margin-bottom:7px!important}
    #field>.sales-hub-field-coach-below #fieldPerformanceLabel{margin-bottom:6px!important}
    #field>.sales-hub-field-coach-below #coachMetricsBody{font-size:10px;line-height:1.35}
    #field>#saleHubActivity,#field>.leaders-card,#field>#salesToCompleteCard{margin-top:6px!important;margin-bottom:6px!important}

    @media(max-width:980px){
      #salesHubTopGrid{
        grid-template-columns:minmax(0,1fr)!important;
        grid-template-areas:"left" "door"!important;
        gap:6px!important
      }
      #salesHubLeftStack{height:auto;grid-template-rows:auto;gap:6px}
      #salesHubLeftStack #payProgressCard{height:auto!important}
      #salesHubTopGrid .sales-hub-door-workflow{min-height:0!important;height:auto!important}
    }
    @media(max-width:560px){
      #salesHubLeftStack .sales-hub-workday{padding:7px 8px!important}
      #salesHubLeftStack .sales-hub-live-stats .mini-stats{grid-template-columns:repeat(2,minmax(0,1fr))!important}
    }
  `;
  document.head.appendChild(style);

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

  function mount(){
    const field=byId('field');
    const top=byId('salesHubTopGrid');
    const fieldSession=byId('startKnockingBtn')?.closest('.card');
    const liveStats=byId('elapsed')?.closest('.card');
    const pay=byId('payProgressCard');
    const door=byId('fieldLeadSelect')?.closest('.card');
    const workday=byId('sphWorkdayControl');
    const coach=byId('coachMetrics');
    if(!field||!top||!fieldSession||!workday||!liveStats||!pay||!door)return false;

    let left=byId('salesHubLeftStack');
    if(!left){
      left=document.createElement('div');
      left.id='salesHubLeftStack';
      left.setAttribute('aria-label','Field Session and workday statistics');
    }

    fieldSession.classList.add('sales-hub-field-session');
    workday.classList.add('sales-hub-workday');
    liveStats.classList.add('sales-hub-live-stats');
    pay.classList.add('sales-hub-pay-progress');
    door.classList.add('sales-hub-door-workflow');

    makeBackgroundButtonOnly(fieldSession);

    left.replaceChildren(fieldSession,workday,liveStats,pay);
    top.replaceChildren(left,door);

    const middle=byId('salesHubMiddleStack');
    if(middle&&middle!==left&&!middle.children.length)middle.remove();

    if(coach){
      coach.classList.remove('sales-hub-field-coach');
      coach.classList.add('sales-hub-field-coach-below');
      if(top.nextElementSibling!==coach)top.insertAdjacentElement('afterend',coach);
    }

    const order=[...left.children].map(item=>item.id||item.querySelector('.card-head h2')?.textContent.trim()||'');
    const ready=left.parentElement===top&&door.parentElement===top&&order[0]===fieldSession.id&&order[1]===workday.id&&order[2]===liveStats.id&&order[3]===pay.id;
    window.dispatchEvent(new CustomEvent('mccoy-sales-hub-fieldcoach-workday-layout-ready',{detail:{
      ready,
      order:['Field Session','Sales / Hour Workday','Live Session Stats','Weekly Pay Progress'],
      doorWorkflowColumn:'right'
    }}));
    return ready;
  }

  function schedule(){[0,80,220,500,900,1500,2800,4500,7000].forEach(delay=>setTimeout(mount,delay));}
  document.addEventListener('click',event=>{if(event.target?.closest?.('.nav-btn[data-view="field"]'))schedule();},true);
  for(const name of ['mccoy-access-ready','mccoy-sale-saved','mccoy-sph-workday-ready','mccoy-background-mode-ready','mccoy-background-mode-changed','mccoy-sales-hub-layout-ready'])window.addEventListener(name,schedule);
  schedule();
})();
