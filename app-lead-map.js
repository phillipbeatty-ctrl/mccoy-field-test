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
  controls.innerHTML=`<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><button id="geocodeRealLeadsBtn" class="primary">GEOCODE REAL LEADS</button><button id="fitAllPinsBtn" class="assign-btn">FIT ALL PINS</button><button id="lassoSelectBtn" class="assign-btn">LASSO SELECT</button><button id="clearMapSelectionBtn" class="assign-btn">CLEAR SELECTION</button><button id="selectVisiblePinsBtn" class="assign-btn">SELECT CURRENT VIEW</button></div><div id="geocodeProgress" class="muted small" style="margin-top:8px">Checking geocode status…</div><div id="mapSelectionStatus" class="muted small" style="margin-top:4px">No geographic selection yet.</div>`;
  leftCard?.insertBefore(controls,canvas);

  const rightCard=document.getElementById('mapAssignBtn')?.closest('.card');
  if(rightCard){
    const bulk=document.createElement('button');bulk.id='bulkAssignMapBtn';bulk.className='primary';bulk.style.cssText='width:100%;margin-top:8px';bulk.textContent='ASSIGN SELECTED MAP AREA';document.getElementById('mapAssignBtn')?.insertAdjacentElement('afterend',bulk);
    const edit=document.createElement('div');edit.id='leadCorrectionPanel';edit.style.cssText='display:none;margin-top:12px;padding-top:10px;border-top:1px solid #e5e7eb';
    edit.innerHTML=`<div style="font-weight:700;margin-bottom:5px">Correct Lead</div><div class="muted small" style="margin-bottom:7px">Click a map pin. Drag the larger correction pin to save its exact location, or edit the address below.</div><label class="small">Street address</label><input id="editLeadAddress1" style="width:100%;padding:7px;margin:3px 0 6px"><label class="small">Unit / Address 2</label><input id="editLeadAddress2" style="width:100%;padding:7px;margin:3px 0 6px"><div style="display:grid;grid-template-columns:1fr 54px 70px;gap:5px"><div><label class="small">City</label><input id="editLeadCity" style="width:100%;padding:7px;margin-top:3px"></div><div><label class="small">State</label><input id="editLeadState" maxlength="2" style="width:100%;padding:7px;margin-top:3px;text-transform:uppercase"></div><div><label class="small">ZIP</label><input id="editLeadZip" style="width:100%;padding:7px;margin-top:3px"></div></div><button id="saveLeadAddressBtn" class="assign-btn" style="margin-top:7px;width:100%">SAVE ADDRESS</button><div id="leadCorrectionMsg" class="muted small" style="margin-top:6px"></div>`;
    bulk.insertAdjacentElement('afterend',edit);
  }

  const map=L.map(canvas,{preferCanvas:true,zoomControl:true});
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:20,attribution:'&copy; OpenStreetMap contributors'}).addTo(map);
  const renderer=L.canvas({padding:.5});
  const layer=L.layerGroup().addTo(map);
  const markerByLead=new Map();
  let selectedIds=new Set(),firstFit=true,lassoMode=false,lassoDrawing=false,lassoPoints=[],lassoPreview=null,lassoPolygon=null,lastLassoPoint=null,lassoStartPoint=null;
  let correctionLead=null,correctionMarker=null;

  function currentRealFiltered(){
    const team=document.getElementById('teamFilter')?.value||'';
    const q=(document.getElementById('leadSearch')?.value||'').toLowerCase();
    return (state.realLeads||[]).filter(l=>Number.isFinite(Number(l.lat))&&Number.isFinite(Number(l.lng))&&(!team||l.team===team)&&(!q||`${l.address} ${l.city||''} ${l.stateCode||''} ${l.zip||''} ${l.rep||''}`.toLowerCase().includes(q)));
  }
  function markerStyle(selected=false){return selected?{renderer,radius:6,weight:2,fillOpacity:.9}:{renderer,radius:4,weight:1,fillOpacity:.55};}
  function updateSelectionStatus(prefix=''){const leads=currentRealFiltered();const base=`${leads.length.toLocaleString()} mapped leads in current filters · ${selectedIds.size.toLocaleString()} selected for bulk assignment.`;document.getElementById('mapSelectionStatus').textContent=prefix?`${prefix} · ${base}`:base;}
  function renderPins(fit=false){
    layer.clearLayers();markerByLead.clear();const leads=currentRealFiltered(),bounds=[];
    for(const l of leads){const selected=selectedIds.has(l.dbId),m=L.circleMarker([Number(l.lat),Number(l.lng)],markerStyle(selected));m.bindTooltip(`${l.address}${l.rep?' · '+l.rep:''}`);m.on('click',e=>{if(lassoMode){L.DomEvent.stopPropagation(e);return;}selectCorrectionLead(l)});m.addTo(layer);markerByLead.set(l.dbId,m);bounds.push([Number(l.lat),Number(l.lng)]);}
    updateSelectionStatus();if(bounds.length&&(fit||firstFit)){map.fitBounds(bounds,{padding:[18,18],maxZoom:16});firstFit=false;}
  }
  window.MCCOY_RENDER_LEAD_MAP=renderPins;

  function correctionMsg(text){const el=document.getElementById('leadCorrectionMsg');if(el)el.textContent=text;}
  function fillCorrectionForm(l){document.getElementById('editLeadAddress1').value=l.address1||l.address||'';document.getElementById('editLeadAddress2').value=l.address2||'';document.getElementById('editLeadCity').value=l.city||'';document.getElementById('editLeadState').value=l.stateCode||'';document.getElementById('editLeadZip').value=l.zip||'';}
  function selectCorrectionLead(l){
    if(window.MCCOY_ACCESS?.access?.role!=='admin')return;
    correctionLead=l;document.getElementById('leadCorrectionPanel').style.display='block';fillCorrectionForm(l);correctionMsg('Drag the large pin to correct its map location.');
    if(correctionMarker)map.removeLayer(correctionMarker);
    correctionMarker=L.marker([Number(l.lat),Number(l.lng)],{draggable:true,autoPan:true,title:'Drag to correct lead location'}).addTo(map);
    correctionMarker.bindTooltip('DRAG TO CORRECT LOCATION',{permanent:false,direction:'top'}).openTooltip();
    correctionMarker.on('dragstart',()=>correctionMsg('Move the pin to the correct property, then release to save.'));
    correctionMarker.on('dragend',async()=>{const p=correctionMarker.getLatLng();correctionMsg('Saving corrected location…');try{const {data,error}=await sb.functions.invoke('lead-admin',{body:{action:'update_lead',lead_id:l.dbId,latitude:p.lat,longitude:p.lng}});if(error||!data?.ok)throw error||new Error(data?.detail||data?.error||'location_save_failed');l.lat=data.lead.latitude;l.lng=data.lead.longitude;markerByLead.get(l.dbId)?.setLatLng([l.lat,l.lng]);correctionMsg('Corrected map location saved.');}catch(e){console.error(e);correctionMsg('Unable to save corrected location.');correctionMarker.setLatLng([Number(l.lat),Number(l.lng)]);}});
  }
  window.MCCOY_SELECT_MAP_LEAD=id=>{const l=(state.realLeads||[]).find(x=>x.id===id||x.dbId===id);if(l)selectCorrectionLead(l)};
  async function saveAddress(){
    if(!correctionLead)return;const btn=document.getElementById('saveLeadAddressBtn');btn.disabled=true;correctionMsg('Saving address…');
    const patch={action:'update_lead',lead_id:correctionLead.dbId,address1:document.getElementById('editLeadAddress1').value,address2:document.getElementById('editLeadAddress2').value,city:document.getElementById('editLeadCity').value,state:document.getElementById('editLeadState').value,zip:document.getElementById('editLeadZip').value};
    try{const {data,error}=await sb.functions.invoke('lead-admin',{body:patch});if(error||!data?.ok)throw error||new Error(data?.detail||data?.error||'address_save_failed');const r=data.lead;correctionLead.address1=r.address1||'';correctionLead.address2=r.address2||'';correctionLead.address=[r.address1,r.address2].filter(Boolean).join(' ');correctionLead.city=r.city||'';correctionLead.stateCode=r.state||'';correctionLead.zip=r.zip||'';correctionLead.fullAddress=[[r.address1,r.address2].filter(Boolean).join(' '),r.city,r.state,r.zip].filter(Boolean).join(', ');markerByLead.get(correctionLead.dbId)?.setTooltipContent(correctionLead.address);correctionMsg('Lead address saved.');if(typeof window.renderLeads==='function')window.renderLeads();}catch(e){console.error(e);correctionMsg('Unable to save lead address.');}finally{btn.disabled=false;}
  }

  function clearLassoShape(){if(lassoPreview){map.removeLayer(lassoPreview);lassoPreview=null;}if(lassoPolygon){map.removeLayer(lassoPolygon);lassoPolygon=null;}lassoPoints=[];lastLassoPoint=null;lassoStartPoint=null;}
  function clearSelection(){selectedIds.clear();clearLassoShape();renderPins(false);updateSelectionStatus('Selection cleared');}
  function selectVisible(){clearLassoShape();const b=map.getBounds();selectedIds=new Set(currentRealFiltered().filter(l=>b.contains([Number(l.lat),Number(l.lng)])).map(l=>l.dbId));renderPins(false);updateSelectionStatus('Current map view selected');}
  function pointInPolygon(lat,lng,poly){let inside=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const yi=poly[i].lat,xi=poly[i].lng,yj=poly[j].lat,xj=poly[j].lng;const crosses=((yi>lat)!==(yj>lat))&&(lng<(xj-xi)*(lat-yi)/((yj-yi)||1e-12)+xi);if(crosses)inside=!inside;}return inside;}
  function setLassoMode(on){lassoMode=on;const btn=document.getElementById('lassoSelectBtn');if(on){if(correctionMarker){map.removeLayer(correctionMarker);correctionMarker=null;}clearLassoShape();btn.textContent='DRAW LASSO…';btn.className='primary';canvas.style.cursor='crosshair';map.dragging.disable();map.doubleClickZoom.disable();map.boxZoom.disable();updateSelectionStatus('Hold the mouse button and drag around the leads, then release');}else{lassoDrawing=false;btn.textContent='LASSO SELECT';btn.className='assign-btn';canvas.style.cursor='';map.dragging.enable();map.doubleClickZoom.enable();map.boxZoom.enable();}}
  function beginLasso(e){if(!lassoMode)return;const oe=e.originalEvent;if(oe&&typeof oe.button==='number'&&oe.button!==0)return;lassoDrawing=true;lassoPoints=[e.latlng];lastLassoPoint=e.containerPoint;lassoStartPoint=e.containerPoint;if(lassoPreview)map.removeLayer(lassoPreview);lassoPreview=L.polyline(lassoPoints,{weight:2,dashArray:'6 4',interactive:false}).addTo(map);oe?.preventDefault?.();oe?.stopPropagation?.();}
  function extendLasso(e){if(!lassoMode||!lassoDrawing)return;const p=e.containerPoint;if(lastLassoPoint&&p.distanceTo(lastLassoPoint)<3)return;lastLassoPoint=p;lassoPoints.push(e.latlng);lassoPreview?.setLatLngs(lassoPoints);}
  function finishLasso(e){if(!lassoMode||!lassoDrawing)return;lassoDrawing=false;const endPoint=e?.containerPoint||lastLassoPoint,dragDistance=(lassoStartPoint&&endPoint)?lassoStartPoint.distanceTo(endPoint):0;if(lassoPreview){map.removeLayer(lassoPreview);lassoPreview=null;}if(lassoPoints.length<3||dragDistance<12){lassoPoints=[];lastLassoPoint=null;lassoStartPoint=null;updateSelectionStatus('Lasso is still active — hold the mouse button and drag a shape around the leads');return;}if(lassoPolygon){map.removeLayer(lassoPolygon);lassoPolygon=null;}lassoPolygon=L.polygon(lassoPoints,{weight:2,fillOpacity:.12,interactive:false}).addTo(map);selectedIds=new Set(currentRealFiltered().filter(l=>pointInPolygon(Number(l.lat),Number(l.lng),lassoPoints)).map(l=>l.dbId));setLassoMode(false);renderPins(false);updateSelectionStatus(`Lasso selected ${selectedIds.size.toLocaleString()} leads`);}
  map.on('mousedown',beginLasso);map.on('mousemove',extendLasso);map.on('mouseup',finishLasso);

  async function geocodeStatus(){if(window.MCCOY_ACCESS?.access?.role!=='admin'){document.getElementById('geocodeRealLeadsBtn').style.display='none';document.getElementById('geocodeProgress').textContent='Lead coordinates are managed by Admin.';return null;}try{const {data,error}=await sb.functions.invoke('lead-geocode',{body:{action:'status'}});if(error)throw error;document.getElementById('geocodeProgress').textContent=`Mapped ${Number(data.geocoded||0).toLocaleString()} of ${Number(data.total||0).toLocaleString()} · ${Number(data.unmatched||0).toLocaleString()} unmatched · ${Number(data.remaining||0).toLocaleString()} not processed.`;return data;}catch(e){console.error(e);document.getElementById('geocodeProgress').textContent='Unable to read geocode status.';return null;}}
  async function geocodeAll(){const btn=document.getElementById('geocodeRealLeadsBtn');if(window.MCCOY_ACCESS?.access?.role!=='admin')return;btn.disabled=true;btn.textContent='GEOCODING…';try{let loops=0;while(loops++<20){const {data,error}=await sb.functions.invoke('lead-geocode',{body:{action:'geocode_next',limit:750}});if(error||!data?.ok)throw error||new Error(data?.error||'geocode_failed');document.getElementById('geocodeProgress').textContent=`Processed ${Number(data.attempted||0).toLocaleString()} / ${Number(data.total||0).toLocaleString()} · mapped ${Number(data.geocoded||0).toLocaleString()} · unmatched ${Number(data.unmatched||0).toLocaleString()} · remaining ${Number(data.remaining||0).toLocaleString()}.`;if(data.complete||!data.processed)break;}await window.loadMcCoyLeads?.();setTimeout(()=>renderPins(true),250);}catch(e){console.error(e);document.getElementById('geocodeProgress').textContent='Geocoding stopped because of an error. You can safely press GEOCODE REAL LEADS again to resume.';}btn.disabled=false;btn.textContent='GEOCODE REAL LEADS';await geocodeStatus();}
  async function bulkAssign(){const msg=document.getElementById('mapAssignMsg');if(window.MCCOY_ACCESS?.access?.role!=='admin'){msg.textContent='Only Admin can bulk-assign real leads.';return;}if(!selectedIds.size){msg.textContent='Select a geographic area first.';return;}const repEmail=document.getElementById('mapRepSelect').value,ids=[...selectedIds];msg.textContent=`Assigning ${ids.length.toLocaleString()} leads…`;try{for(let i=0;i<ids.length;i+=500){const {data,error}=await sb.functions.invoke('lead-admin',{body:{action:'assign_leads',lead_ids:ids.slice(i,i+500),rep_email:repEmail}});if(error||!data?.ok)throw error||new Error(data?.detail||data?.error||'bulk_assign_failed');}msg.textContent=`${ids.length.toLocaleString()} leads assigned successfully.`;selectedIds.clear();clearLassoShape();await window.loadMcCoyLeads?.();setTimeout(()=>renderPins(false),250);}catch(e){console.error(e);msg.textContent=`Bulk assignment failed${e?.message?': '+e.message:''}.`;}}

  document.getElementById('geocodeRealLeadsBtn').onclick=geocodeAll;document.getElementById('fitAllPinsBtn').onclick=()=>renderPins(true);document.getElementById('lassoSelectBtn').onclick=()=>setLassoMode(!lassoMode);document.getElementById('clearMapSelectionBtn').onclick=clearSelection;document.getElementById('selectVisiblePinsBtn').onclick=selectVisible;document.getElementById('bulkAssignMapBtn').onclick=bulkAssign;document.getElementById('saveLeadAddressBtn').onclick=saveAddress;
  document.getElementById('teamFilter')?.addEventListener('change',()=>{selectedIds.clear();clearLassoShape();setTimeout(()=>renderPins(true),0)});document.getElementById('leadSearch')?.addEventListener('input',()=>{selectedIds.clear();clearLassoShape();setTimeout(()=>renderPins(true),100)});window.addEventListener('mccoy-real-leads-loaded',()=>setTimeout(()=>{renderPins(true);geocodeStatus();},200));
  const obs=new MutationObserver(()=>{if(panel.style.display!=='none')setTimeout(()=>{map.invalidateSize();renderPins(firstFit);},50)});obs.observe(panel,{attributes:true,attributeFilter:['style']});setTimeout(()=>{map.setView([39.5,-98.35],4);renderPins(true);geocodeStatus();},800);
})();