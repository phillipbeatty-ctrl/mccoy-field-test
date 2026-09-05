(()=>{
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  let activating=false;
  let filterTouched=false;
  let lastVisible=false;

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

  function ensureLeadMapVisible(){
    const leads=document.getElementById('leads');
    const panel=document.getElementById('leadMapPanel');
    if(!leads?.classList.contains('active')||!panel)return false;
    if(state.leadView==='map'){
      panel.style.display='block';
      const table=document.getElementById('leadsTable');
      const pager=document.getElementById('leadPager');
      if(table)table.style.display='none';
      if(pager)pager.style.display='none';
    }
    return panel.style.display!=='none'&&state.leadView==='map';
  }

  function reportMapPopulation(){
    const status=document.getElementById('mapSelectionStatus');
    if(!status)return;
    const total=(state.realLeads||[]).length;
    const mapped=mappedLeads().length;
    const filtered=filteredMappedLeads().length;
    const domPins=document.querySelectorAll('#leadMapFrame .lead-house-icon,#leadMapFrame .mccoy-lead-cluster').length;
    status.textContent=`Lead data: ${total.toLocaleString()} loaded · ${mapped.toLocaleString()} mapped · ${filtered.toLocaleString()} in current filters · ${domPins.toLocaleString()} visible pin/cluster elements.`;
  }

  function rebuildVisibleMarkers(){
    if(!Array.isArray(state.realLeads)||!state.realLeads.length)return;
    // renderPins caches by lead-array identity. A fresh array reference forces exactly
    // one clean layer rebuild after the map transitions from hidden to visible.
    state.realLeads=state.realLeads.slice();
    if(state.leadMode==='real')state.leads=state.realLeads;
    window.MCCOY_LEAD_MAP?.map?.invalidateSize?.({pan:false});
    window.MCCOY_RENDER_LEAD_MAP?.(true);
  }

  async function activateLeadMap({forceRebuild=false}={}){
    if(activating)return;
    activating=true;
    try{
      await sleep(40);
      const visible=ensureLeadMapVisible();

      if((!Array.isArray(state.realLeads)||state.realLeads.length===0)&&!state.leadAccessScope?.assignmentRequired){
        await window.loadMcCoyLeads?.();
      }

      for(let i=0;i<4&&!state.leadAccessScope?.assignmentRequired&&(!Array.isArray(state.realLeads)||state.realLeads.length===0);i++)await sleep(120);
      clearUntouchedStaleFilters();

      const nowVisible=ensureLeadMapVisible();
      window.MCCOY_LEAD_MAP?.map?.invalidateSize?.({pan:false});
      if(nowVisible&&(forceRebuild||!lastVisible))rebuildVisibleMarkers();
      else window.MCCOY_RENDER_LEAD_MAP?.(true);
      lastVisible=nowVisible;

      setTimeout(()=>{window.MCCOY_LEAD_MAP?.map?.invalidateSize?.({pan:false});reportMapPopulation();},120);
      setTimeout(reportMapPopulation,700);
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
    if(e.target?.closest?.('#leadMapView'))setTimeout(()=>activateLeadMap({forceRebuild:true}),0);
    if(e.target?.closest?.('.nav-btn[data-view="leads"]')){
      lastVisible=false;
      setTimeout(()=>activateLeadMap({forceRebuild:true}),60);
    }
  },true);

  window.addEventListener('mccoy-real-leads-loaded',()=>{
    const panel=document.getElementById('leadMapPanel');
    if(panel&&panel.style.display!=='none')setTimeout(()=>activateLeadMap({forceRebuild:true}),30);
  });

  window.addEventListener('mccoy-field-session-started',()=>{
    if(document.getElementById('leads')?.classList.contains('active'))setTimeout(()=>activateLeadMap({forceRebuild:true}),60);
  });
})();