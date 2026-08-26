(()=>{
  const WIDE_IPAD_MIN=900;
  let resizeTimer=null;
  let panelObserver=null;

  function isIPadClassDevice(){
    const ua=String(navigator.userAgent||'');
    return /iPad/i.test(ua)||(navigator.platform==='MacIntel'&&Number(navigator.maxTouchPoints)>1);
  }

  function ensureStyles(){
    if(document.getElementById('fieldCoachIPadStyles'))return;
    const style=document.createElement('style');
    style.id='fieldCoachIPadStyles';
    style.textContent=`
      body.field-coach-ipad{--fc-tablet-touch:48px}
      body.field-coach-ipad button,body.field-coach-ipad select,body.field-coach-ipad input{min-height:var(--fc-tablet-touch)}
      body.field-coach-ipad #field>.grid-2{align-items:stretch}
      body.field-coach-ipad #field>.grid-2>.card{min-width:0}
      body.field-coach-ipad #leadMapFrame{min-height:56vh}
      body.field-coach-ipad #mapLeadList{max-height:30vh;overflow:auto}
      body.field-coach-ipad #mapLeadDetail{padding-top:10px}
      body.field-coach-ipad-wide #field>.grid-2{grid-template-columns:minmax(0,1fr) minmax(320px,.72fr)!important}
      body.field-coach-ipad-wide #leadMapPanel.lead-map-expanded>.grid-2{grid-template-columns:minmax(0,1.65fr) minmax(320px,.85fr)!important;align-items:stretch}
      body.field-coach-ipad-wide #leadMapPanel.lead-map-expanded>.grid-2>.card:first-child{grid-column:auto!important;width:auto!important;max-width:none!important}
      body.field-coach-ipad-wide #leadMapPanel.lead-map-expanded>.grid-2>.card:nth-child(2){display:block!important;min-width:0!important;max-height:calc(100dvh - 170px);overflow:auto}
      body.field-coach-ipad-wide #leadMapPanel.lead-map-expanded #leadMapFrame{min-height:calc(100dvh - 220px)}
      body.field-coach-ipad-wide #mapLeadList{max-height:34vh;overflow:auto}
      body.field-coach-ipad-wide #mapLeadDetail{position:relative;display:block!important;min-width:0}
      body.field-coach-ipad-wide .field-controls{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
      body.field-coach-ipad-wide .field-controls #fieldState,body.field-coach-ipad-wide .field-controls #geoBox,body.field-coach-ipad-wide .field-controls #gpsQualityBox,body.field-coach-ipad-wide .field-controls #doorPresenceBox,body.field-coach-ipad-wide .field-controls #telemetryStatus{grid-column:1/-1}
      @media(max-width:899px){body.field-coach-ipad #leadMapFrame{min-height:52vh}}
    `;
    document.head.appendChild(style);
  }

  function sideCard(){
    return document.getElementById('mapLeadList')?.closest('.card')||document.getElementById('bulkAssignMapBtn')?.closest('.card')||null;
  }

  function applyTabletLayout(){
    ensureStyles();
    const ipad=isIPadClassDevice();
    const wide=ipad&&window.innerWidth>=WIDE_IPAD_MIN;
    document.body.classList.toggle('field-coach-ipad',ipad);
    document.body.classList.toggle('field-coach-ipad-wide',wide);
    if(!ipad)return;

    const panel=document.getElementById('leadMapPanel');
    const side=sideCard();
    const expanded=Boolean(panel?.classList.contains('lead-map-expanded'));
    if(expanded&&side){
      if(wide){
        side.removeAttribute('inert');
        side.setAttribute('aria-hidden','false');
      }else{
        side.setAttribute('inert','');
        side.setAttribute('aria-hidden','true');
      }
    }
    setTimeout(()=>window.MCCOY_INVALIDATE_LEAD_MAP?.(),40);
    window.dispatchEvent(new CustomEvent('mccoy-ipad-layout-changed',{detail:{ipad,wide,width:window.innerWidth}}));
  }

  function observePanel(){
    const panel=document.getElementById('leadMapPanel');
    if(!panel||panelObserver)return;
    panelObserver=new MutationObserver(()=>applyTabletLayout());
    panelObserver.observe(panel,{attributes:true,attributeFilter:['class','style','hidden']});
  }

  function scheduleApply(){
    clearTimeout(resizeTimer);
    resizeTimer=setTimeout(()=>{observePanel();applyTabletLayout();},60);
  }

  document.addEventListener('DOMContentLoaded',scheduleApply);
  window.addEventListener('load',scheduleApply);
  window.addEventListener('resize',scheduleApply);
  window.addEventListener('orientationchange',scheduleApply);
  window.addEventListener('mccoy-access-ready',scheduleApply);
  window.addEventListener('mccoy-real-leads-loaded',scheduleApply);
  window.addEventListener('mccoy-lead-pool-position-changed',scheduleApply);
  window.addEventListener('mccoy-map-lead-selected',scheduleApply);
  setTimeout(scheduleApply,1200);
})();
