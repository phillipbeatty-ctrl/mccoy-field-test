(()=>{
  let checks=0;
  const MAX_CHECKS=80;

  function currentRole(){
    const access=window.MCCOY_ACCESS?.access;
    if(!access||access.active===false)return null;
    return String(access.role||'').toLowerCase();
  }

  function isManagerRole(role){return role==='manager'||role==='trainer';}
  function canAssign(role){return role==='admin'||isManagerRole(role);}

  function forceVisible(element,visible,display=''){
    if(!element)return;
    element.hidden=!visible;
    element.toggleAttribute('inert',!visible);
    element.setAttribute('aria-hidden',visible?'false':'true');
    if('disabled' in element)element.disabled=!visible;
    if(visible){
      element.style.removeProperty('display');
      if(display)element.style.setProperty('display',display,'important');
    }else element.style.setProperty('display','none','important');
  }

  function ensureStyles(){
    if(document.getElementById('leadPoolStrictRoleVisibility'))return;
    const style=document.createElement('style');
    style.id='leadPoolStrictRoleVisibility';
    style.textContent=`
      #mapRepSelect{width:100%!important;max-width:none!important;min-width:0!important}
      body.lead-pool-rep-layout #mapAssignLabel,
      body.lead-pool-rep-layout #mapRepSelect,
      body.lead-pool-rep-layout #mapAssignBtn,
      body.lead-pool-rep-layout #bulkAssignMapBtn,
      body.lead-pool-rep-layout #lassoSelectBtn,
      body.lead-pool-rep-layout #selectVisiblePinsBtn,
      body.lead-pool-rep-layout #leadListAssignmentBar,
      body.lead-pool-rep-layout #checkDuplicateLeadsBtn,
      body.lead-pool-rep-layout #leadCorrectionPanel{display:none!important}
    `;
    document.head.appendChild(style);
  }

  function syncRoleControls(){
    ensureStyles();
    window.MCCOY_APPLY_LEAD_ACCESS_CONTROLS?.();
    const role=currentRole();
    if(!role)return false;
    const assigner=canAssign(role);
    const admin=role==='admin';

    const select=document.getElementById('mapRepSelect');
    const label=document.getElementById('mapAssignLabel')||select?.previousElementSibling;
    if(label&&label.tagName==='LABEL'){
      label.textContent=admin?'Assign to manager or rep':'Assign Admin-provided lead to rep';
      label.style.margin='0 0 2px 0';
      forceVisible(label,assigner,'block');
    }
    forceVisible(select,assigner,'block');
    forceVisible(document.getElementById('mapAssignBtn'),false);
    forceVisible(document.getElementById('bulkAssignMapBtn'),assigner,'block');
    forceVisible(document.getElementById('lassoSelectBtn'),assigner,'inline-block');
    forceVisible(document.getElementById('selectVisiblePinsBtn'),assigner,'inline-block');
    forceVisible(document.getElementById('checkDuplicateLeadsBtn'),admin,'inline-block');
    forceVisible(document.getElementById('leadCorrectionPanel'),admin,'block');

    const listBar=document.getElementById('leadListAssignmentBar');
    const listVisible=assigner&&window.state?.leadView==='list'&&window.state?.leadMode==='real';
    forceVisible(listBar,listVisible,'flex');

    const sideCard=document.getElementById('mapLeadList')?.closest('.card')||select?.closest('.card');
    const heading=sideCard?.querySelector('h3');
    if(heading)heading.textContent=assigner?'Map Assignment':'Lead Details';

    const assignmentMessage=document.getElementById('mapAssignMsg');
    if(assignmentMessage&&!assigner){assignmentMessage.textContent='';forceVisible(assignmentMessage,false);}
    else forceVisible(assignmentMessage,true,'block');
    return true;
  }

  function syncGeocodeControl(){
    checks++;
    const roleReady=syncRoleControls();
    const btn=document.getElementById('geocodeRealLeadsBtn');
    const progress=document.getElementById('geocodeProgress');
    if(!btn){
      if(checks<MAX_CHECKS)setTimeout(syncGeocodeControl,350);
      return;
    }
    const access=window.MCCOY_ACCESS?.access;
    if(!access){
      forceVisible(btn,true,'inline-block');
      btn.disabled=true;
      btn.textContent='VERIFY NEXT 25 WITH GOOGLE';
      if(progress)progress.textContent='Waiting for account permissions…';
      if(checks<MAX_CHECKS)setTimeout(syncGeocodeControl,350);
      return;
    }
    if(access.active&&access.role==='admin'){
      forceVisible(btn,true,'inline-block');
      btn.disabled=btn.dataset.googleConfigured==='0';
      btn.textContent='VERIFY NEXT 25 WITH GOOGLE';
      if(progress&&/managed by Admin|Waiting for account permissions/i.test(progress.textContent||''))progress.textContent='Admin Google verification controls ready.';
    }else{
      forceVisible(btn,false);
      if(progress)progress.textContent='Lead coordinates are managed by Admin.';
    }
    if(!roleReady&&checks<MAX_CHECKS)setTimeout(syncGeocodeControl,350);
  }

  function resync(){checks=0;setTimeout(syncGeocodeControl,50);}
  document.addEventListener('DOMContentLoaded',()=>setTimeout(syncGeocodeControl,150));
  setTimeout(syncGeocodeControl,350);
  window.addEventListener('mccoy-access-ready',resync);
  window.addEventListener('mccoy-real-leads-loaded',resync);
  window.addEventListener('mccoy-lead-pool-position-changed',resync);
  document.addEventListener('click',event=>{
    if(event.target?.closest?.('[data-view="leads"],#leadMapView,#leadListView'))resync();
  });
})();