// Event-driven repair for cases where the legacy detail renderer rebuilds a selected pin panel.
// No document-wide observer is used.
(function(){
  if(window.MCCOY_LEAD_POOL_INDEPENDENT_REFRESH)return;
  window.MCCOY_LEAD_POOL_INDEPENDENT_REFRESH=true;

  let repairTimer=null;
  function repair(){
    clearTimeout(repairTimer);
    repairTimer=setTimeout(()=>{
      const detail=document.getElementById('mapLeadDetail');
      if(!detail)return;
      const selectedId=detail.dataset.independentLeadId;
      const legacyActions=detail.querySelector('.map-pin-disposition-actions');
      if(!selectedId||!legacyActions||document.getElementById('mapPinKnockBtn'))return;
      delete detail.dataset.independentLeadId;
      window.dispatchEvent(new CustomEvent('mccoy-map-lead-selected',{detail:{leadId:selectedId,source:'independent_panel_repair'}}));
    },70);
  }

  for(const eventName of [
    'mccoy-door-visit-started',
    'mccoy-door-visit-completed',
    'mccoy-real-leads-loaded',
    'mccoy-lead-owners-updated',
    'mccoy-lead-pool-disposition-saved'
  ])window.addEventListener(eventName,repair);
  document.addEventListener('click',event=>{
    if(event.target.closest?.('.map-pick,.lead-house-icon'))repair();
  },true);
  window.addEventListener('beforeunload',()=>clearTimeout(repairTimer));
})();
