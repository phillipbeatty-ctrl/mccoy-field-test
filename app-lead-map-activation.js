(()=>{
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  let activating=false;
  let filterTouched=false;

  function mappedLeads(){
    return (state.realLeads||[]).filter(lead=>Number.isFinite(Number(lead.lat))&&Number.isFinite(Number(lead.lng)));
  }

  function filteredMappedLeads(){
    return mappedLeads().filter(lead=>!window.MCCOY_LEAD_MATCHES_FILTER||window.MCCOY_LEAD_MATCHES_FILTER(lead));
  }

  function clearUntouchedStaleFilters(){
    if(filterTouched)return false;
    const team=document.getElementById('teamFilter');
    const owner=document.getElementById('leadOwnerFilter');
    const search=document.getElementById('leadSearch');
    const hasFilter=Boolean(team?.value||owner?.value||String(search?.value||'').trim());
    if(!hasFilter||filteredMappedLeads().length||!mappedLeads().length)return false;
    if(team)team.value='';
    if(owner)owner.value='';
    if(search)search.value='';
    window.dispatchEvent(new CustomEvent('mccoy-lead-map-stale-filters-cleared'));
    return true;
  }

  function reportMapPopulation(){
    const status=document.getElementById('mapSelectionStatus');
    if(!status)return;
    const total=(state.realLeads||[]).length;
    const mapped=mappedLeads().length;
    const filtered=filteredMappedLeads().length;
    const existing=String(status.textContent||'').replace(/^Lead data: .*?\.\s*/,'');
    status.textContent=`Lead data: ${total.toLocaleString()} loaded · ${mapped.toLocaleString()} mapped · ${filtered.toLocaleString()} in current filters. ${existing}`;
  }

  async function activateLeadMap(){
    if(activating)return;
    activating=true;
    try{
      // Let the Lead Pool switch the panel from hidden to visible first.
      await sleep(40);

      // Always recover the real lead pool when MAP / ASSIGN is opened directly.
      if((!Array.isArray(state.realLeads)||state.realLeads.length===0)&&!state.leadAccessScope?.assignmentRequired){
        await window.loadMcCoyLeads?.();
      }

      // Managers and reps with no assigned pool should not wait for leads that cannot arrive.
      for(let i=0;i<4&&!state.leadAccessScope?.assignmentRequired&&(!Array.isArray(state.realLeads)||state.realLeads.length===0);i++)await sleep(120);

      // Mobile browsers may restore old form values after reload. If those untouched
      // values exclude every mapped lead, return to the documented default filters.
      clearUntouchedStaleFilters();

      // Marker rendering is cached and batched, so one visible redraw is sufficient.
      window.MCCOY_RENDER_LEAD_MAP?.(true);
      setTimeout(reportMapPopulation,80);
      setTimeout(reportMapPopulation,500);
    }catch(e){
      console.error('Lead map activation failed',e);
    }finally{
      activating=false;
    }
  }

  window.MCCOY_ACTIVATE_LEAD_MAP=activateLeadMap;

  for(const eventName of ['input','change'])document.addEventListener(eventName,e=>{
    if(e.isTrusted&&e.target?.matches?.('#teamFilter,#leadOwnerFilter,#leadSearch'))filterTouched=true;
  },true);

  document.addEventListener('click',e=>{
    const btn=e.target?.closest?.('#leadMapView');
    if(btn)setTimeout(activateLeadMap,0);
  });

  // If real leads arrive while the map is already open, populate it immediately.
  window.addEventListener('mccoy-real-leads-loaded',()=>{
    const panel=document.getElementById('leadMapPanel');
    if(panel&&panel.style.display!=='none')setTimeout(activateLeadMap,30);
  });
})();