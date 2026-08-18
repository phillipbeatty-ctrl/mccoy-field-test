(()=>{
  const panel=document.getElementById('leadMapPanel');
  if(!panel||!window.L)return;
  const iframe=document.getElementById('leadMapFrame');
  if(!iframe)return;
  const canvas=document.createElement('div');canvas.id='leadMapFrame';canvas.style.cssText='width:100%;height:520px;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden';iframe.replaceWith(canvas);

  const leftCard=canvas.closest('.card');
  const controls=document.createElement('div');
  controls.id='leadGeoControls';
  controls.style.cssText='margin:10px 0;padding:10px;border:1px solid #e5e7eb;border-radius:10px';
  controls.innerHTML=`<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><button id="geocodeRealLeadsBtn" class="primary">GEOCODE REAL LEADS</button><button id="fitAllPinsBtn" class="assign-btn">FIT ALL PINS</button><button id="selectVisiblePinsBtn" class="assign-btn">SELECT LEADS IN CURRENT MAP VIEW</button></div><div id="geocodeProgress" class="muted small" style="margin-top:8px">Checking geocode status…</div><div id="mapSelectionStatus" class="muted small" style="margin-top:4px">No geographic selection yet.</div>`;
  leftCard?.insertBefore(controls,canvas);

  const rightCard=document.getElementById('mapAssignBtn')?.closest('.card');
  if(rightCard){
    const bulk=document.createElement('button');bulk.id='bulkAssignMapBtn';bulk.className='primary';bulk.style.cssText='width:100%;margin-top:8px';bulk.textContent='ASSIGN SELECTED MAP AREA';document.getElementById('mapAssignBtn')?.insertAdjacentElement('afterend',bulk);
  }

  const map=L.map(canvas,{preferCanvas:true,zoomControl:true});
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:20,attribution:'&copy; OpenStreetMap contributors'}).addTo(map);
  const renderer=L.canvas({padding:.5});
  const layer=L.layerGroup().addTo(map);
  const markerByLead=new Map();
  let selectedIds=new Set();
  let firstFit=true;

  function currentRealFiltered(){
    const team=document.getElementById('teamFilter')?.value||'';
    const q=(document.getElementById('leadSearch')?.value||'').toLowerCase();
    return (state.realLeads||[]).filter(l=>Number.isFinite(Number(l.lat))&&Number.isFinite(Number(l.lng))&&(!team||l.team===team)&&(!q||`${l.address} ${l.city||''} ${l.stateCode||''} ${l.zip||''} ${l.rep||''}`.toLowerCase().includes(q)));
  }
  function markerStyle(selected=false){return selected?{renderer,radius:6,weight:2,fillOpacity:.85}:{renderer,radius:4,weight:1,fillOpacity:.55};}
  function renderPins(fit=false){
    layer.clearLayers();markerByLead.clear();
    const leads=currentRealFiltered(),bounds=[];
    for(const l of leads){
      const selected=selectedIds.has(l.dbId);const m=L.circleMarker([Number(l.lat),Number(l.lng)],markerStyle(selected));
      m.bindTooltip(`${l.address}${l.rep?' · '+l.rep:''}`);m.on('click',()=>window.MCCOY_SELECT_MAP_LEAD?.(l.id));m.addTo(layer);markerByLead.set(l.dbId,m);bounds.push([Number(l.lat),Number(l.lng)]);
    }
    document.getElementById('mapSelectionStatus').textContent=`${leads.length.toLocaleString()} mapped leads visible in current filters · ${selectedIds.size.toLocaleString()} selected for bulk assignment.`;
    if(bounds.length&&(fit||firstFit)){map.fitBounds(bounds,{padding:[18,18],maxZoom:16});firstFit=false;}
  }
  window.MCCOY_RENDER_LEAD_MAP=renderPins;

  function selectVisible(){
    const b=map.getBounds();selectedIds=new Set(currentRealFiltered().filter(l=>b.contains([Number(l.lat),Number(l.lng)])).map(l=>l.dbId));renderPins(false);
  }

  async function geocodeStatus(){
    if(window.MCCOY_ACCESS?.access?.role!=='admin'){document.getElementById('geocodeRealLeadsBtn').style.display='none';document.getElementById('geocodeProgress').textContent='Lead coordinates are managed by Admin.';return null;}
    try{const {data,error}=await sb.functions.invoke('lead-geocode',{body:{action:'status'}});if(error)throw error;document.getElementById('geocodeProgress').textContent=`Mapped ${Number(data.geocoded||0).toLocaleString()} of ${Number(data.total||0).toLocaleString()} · ${Number(data.unmatched||0).toLocaleString()} unmatched · ${Number(data.remaining||0).toLocaleString()} not processed.`;return data;}catch(e){console.error(e);document.getElementById('geocodeProgress').textContent='Unable to read geocode status.';return null;}
  }

  async function geocodeAll(){
    const btn=document.getElementById('geocodeRealLeadsBtn');if(window.MCCOY_ACCESS?.access?.role!=='admin')return;btn.disabled=true;btn.textContent='GEOCODING…';
    try{
      let loops=0;
      while(loops++<20){
        const {data,error}=await sb.functions.invoke('lead-geocode',{body:{action:'geocode_next',limit:750}});if(error||!data?.ok)throw error||new Error(data?.error||'geocode_failed');
        document.getElementById('geocodeProgress').textContent=`Processed ${Number(data.attempted||0).toLocaleString()} / ${Number(data.total||0).toLocaleString()} · mapped ${Number(data.geocoded||0).toLocaleString()} · unmatched ${Number(data.unmatched||0).toLocaleString()} · remaining ${Number(data.remaining||0).toLocaleString()}.`;
        if(data.complete||!data.processed)break;
      }
      await window.loadMcCoyLeads?.();setTimeout(()=>renderPins(true),250);
    }catch(e){console.error(e);document.getElementById('geocodeProgress').textContent='Geocoding stopped because of an error. You can safely press GEOCODE REAL LEADS again to resume.';}
    btn.disabled=false;btn.textContent='GEOCODE REAL LEADS';await geocodeStatus();
  }

  async function bulkAssign(){
    const msg=document.getElementById('mapAssignMsg');if(window.MCCOY_ACCESS?.access?.role!=='admin'){msg.textContent='Only Admin can bulk-assign real leads.';return;}if(!selectedIds.size){msg.textContent='Select a geographic area first.';return;}
    const repEmail=document.getElementById('mapRepSelect').value;const ids=[...selectedIds];msg.textContent=`Assigning ${ids.length.toLocaleString()} leads…`;
    try{
      for(let i=0;i<ids.length;i+=500){const {data,error}=await sb.functions.invoke('lead-admin',{body:{action:'assign_leads',lead_ids:ids.slice(i,i+500),rep_email:repEmail}});if(error||!data?.ok)throw error||new Error(data?.error||'bulk_assign_failed');}
      msg.textContent=`${ids.length.toLocaleString()} leads assigned successfully.`;selectedIds.clear();await window.loadMcCoyLeads?.();setTimeout(()=>renderPins(false),250);
    }catch(e){console.error(e);msg.textContent='Bulk assignment failed. No browser-only assignment was substituted.';}
  }

  document.getElementById('geocodeRealLeadsBtn').onclick=geocodeAll;
  document.getElementById('fitAllPinsBtn').onclick=()=>renderPins(true);
  document.getElementById('selectVisiblePinsBtn').onclick=selectVisible;
  document.getElementById('bulkAssignMapBtn').onclick=bulkAssign;
  document.getElementById('teamFilter')?.addEventListener('change',()=>setTimeout(()=>renderPins(true),0));
  document.getElementById('leadSearch')?.addEventListener('input',()=>setTimeout(()=>renderPins(true),100));
  window.addEventListener('mccoy-real-leads-loaded',()=>setTimeout(()=>{renderPins(true);geocodeStatus();},200));
  const obs=new MutationObserver(()=>{if(panel.style.display!=='none')setTimeout(()=>{map.invalidateSize();renderPins(firstFit);},50)});obs.observe(panel,{attributes:true,attributeFilter:['style']});
  setTimeout(()=>{map.setView([39.5,-98.35],4);renderPins(true);geocodeStatus();},800);
})();