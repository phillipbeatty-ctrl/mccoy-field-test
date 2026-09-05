(()=>{
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  let activating=false;
  let filterTouched=false;
  let lastVisible=false;
  let accessReplaySent=false;

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

  function showListWorkspace(){
    if(typeof state!=='undefined')state.leadView='list';
    const panel=document.getElementById('leadMapPanel');
    const table=document.getElementById('leadsTable');
    const pager=document.getElementById('leadPager');
    const mapButton=document.getElementById('leadMapView');
    const listButton=document.getElementById('leadListView');
    if(panel)panel.style.display='none';
    if(table)table.style.display='block';
    if(pager)pager.style.display='flex';
    if(mapButton)mapButton.className='assign-btn';
    if(listButton)listButton.className='primary';
    document.querySelector('#leads>.card')?.classList.remove('lead-pool-map-workspace');
    lastVisible=false;
  }

  function ensureLeadMapVisible(){
    const leads=document.getElementById('leads');
    const panel=document.getElementById('leadMapPanel');
    if(!leads?.classList.contains('active')||!panel||state.leadView!=='map')return false;
    panel.style.display='block';
    const table=document.getElementById('leadsTable');
    const pager=document.getElementById('leadPager');
    if(table)table.style.display='none';
    if(pager)pager.style.display='none';
    return true;
  }

  function reportMapPopulation(){
    const status=document.getElementById('mapSelectionStatus');
    if(!status)return;
    const total=(state.realLeads||[]).length;
    const mapped=mappedLeads().length;
    const filtered=filteredMappedLeads().length;
    const domPins=document.querySelectorAll('#leadMapFrame .lead-house-icon,#leadMapFrame .mccoy-lead-cluster').length;
    const scope=state.leadAccessScope?.scope||'unknown';
    const reason=state.leadAccessScope?.assignmentReason||'none';
    status.textContent=`Lead data: ${total.toLocaleString()} loaded · ${mapped.toLocaleString()} mapped · ${filtered.toLocaleString()} in current filters · ${domPins.toLocaleString()} visible pin/cluster elements · scope ${scope} · assignment reason ${reason}.`;
  }

  function rebuildVisibleMarkers(){
    if(!Array.isArray(state.realLeads)||!state.realLeads.length)return;
    state.realLeads=state.realLeads.slice();
    if(state.leadMode==='real')state.leads=state.realLeads;
    window.MCCOY_LEAD_MAP?.map?.invalidateSize?.({pan:false});
    window.MCCOY_RENDER_LEAD_MAP?.(true);
  }

  async function activateLeadMap({forceRebuild=false}={}){
    if(activating||state.leadView!=='map')return;
    activating=true;
    try{
      await sleep(40);
      if(!ensureLeadMapVisible())return;

      const blockedByAssignment=Boolean(state.leadAccessScope?.assignmentReason);
      if((!Array.isArray(state.realLeads)||state.realLeads.length===0)&&!blockedByAssignment){
        await window.loadMcCoyLeads?.();
      }

      for(let i=0;i<4&&!state.leadAccessScope?.assignmentReason&&(!Array.isArray(state.realLeads)||state.realLeads.length===0);i++)await sleep(120);
      clearUntouchedStaleFilters();

      const nowVisible=ensureLeadMapVisible();
      window.MCCOY_LEAD_MAP?.map?.invalidateSize?.({pan:false});
      if(nowVisible&&(forceRebuild||!lastVisible))rebuildVisibleMarkers();
      else if(nowVisible)window.MCCOY_RENDER_LEAD_MAP?.(true);
      lastVisible=nowVisible;

      if(nowVisible){
        setTimeout(()=>{window.MCCOY_LEAD_MAP?.map?.invalidateSize?.({pan:false});reportMapPopulation();},120);
        setTimeout(reportMapPopulation,700);
      }
    }catch(e){
      console.error('Lead map activation failed',e);
    }finally{
      activating=false;
    }
  }

  function replayVerifiedAccessAfterPageLoad(){
    if(accessReplaySent)return;
    const access=window.MCCOY_ACCESS?.access;
    const organization=window.FIELD_COACH_ORGANIZATION_ACCESS;
    if(!access?.active||organization?.access_allowed!==true)return;
    accessReplaySent=true;
    window.dispatchEvent(new CustomEvent('mccoy-access-ready',{detail:{organization_access_verified:true,bootstrap_replay:true,organization_access:organization}}));
  }

  window.MCCOY_ACTIVATE_LEAD_MAP=activateLeadMap;

  for(const eventName of ['input','change'])document.addEventListener(eventName,e=>{
    if(e.isTrusted&&e.target?.matches?.('#teamFilter,#leadOwnerFilter,#leadSearch'))filterTouched=true;
  },true);

  document.addEventListener('click',e=>{
    if(e.target?.closest?.('#leadMapView'))setTimeout(()=>activateLeadMap({forceRebuild:true}),0);
    if(e.target?.closest?.('#leadListView'))setTimeout(showListWorkspace,0);
    if(e.target?.closest?.('.nav-btn[data-view="leads"]')){
      lastVisible=false;
      setTimeout(()=>{
        const listButton=document.getElementById('leadListView');
        if(listButton)listButton.click();
        else showListWorkspace();
      },0);
    }
  },true);

  window.addEventListener('mccoy-real-leads-loaded',()=>{
    if(state.leadView==='map'&&document.getElementById('leadMapPanel')?.style.display!=='none')setTimeout(()=>activateLeadMap({forceRebuild:true}),30);
  });

  window.addEventListener('load',()=>{
    setTimeout(replayVerifiedAccessAfterPageLoad,0);
    setTimeout(replayVerifiedAccessAfterPageLoad,800);
  });
})();