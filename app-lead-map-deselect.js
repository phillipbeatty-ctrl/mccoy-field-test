(function mapDeselectApp(){
  function resetSelectedLeadDetails(){
    const detail=document.getElementById('mapLeadDetail');
    if(detail)detail.innerHTML='<div class="muted small">Select a lead from the list or map to view details.</div>';
    const legacy=document.getElementById('mapLeadInfo');
    if(legacy)legacy.innerHTML='<span class="muted">Select a real lead.</span>';
    const correction=document.getElementById('leadCorrectionPanel');
    if(correction)correction.style.display='none';
    const message=document.getElementById('mapAssignMsg');
    if(message)message.textContent='';
  }
  function clearMapSelection(){
    window.MCCOY_MAP_MANUAL_VIEWPORT_HOLD=true;
    window.dispatchEvent(new CustomEvent('mccoy-map-manual-viewport-hold-changed',{detail:{held:true,source:'map_background_deselect'}}));
    document.getElementById('clearMapSelectionBtn')?.click();
    resetSelectedLeadDetails();
  }
  document.addEventListener('click',event=>{
    const canvas=event.target?.closest?.('#leadMapFrame');
    if(!canvas)return;
    if(window.MCCOY_MAP_MOVE_PIN_ACTIVE||window.MCCOY_LASSO_ACTIVE||Date.now()<Number(window.MCCOY_LASSO_IGNORE_MAP_CLEAR_UNTIL||0))return;
    if(event.target.closest?.('.lead-house-icon,.mccoy-lead-cluster,.leaflet-control'))return;
    const lasso=document.getElementById('lassoSelectBtn');
    if(lasso&&lasso.textContent!=='LASSO SELECT')return;
    clearMapSelection();
  },true);
  document.addEventListener('click',event=>{
    if(event.target?.closest?.('#clearMapSelectionBtn'))setTimeout(resetSelectedLeadDetails,0);
  });
})();
