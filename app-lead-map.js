(()=>{
  const panel=document.getElementById('leadMapPanel');
  if(!panel||!window.L)return;
  const oldMap=document.getElementById('leadMapFrame');
  if(!oldMap)return;

  const style=document.createElement('style');
  style.textContent=`
    .lead-house-icon{background:transparent!important;border:0!important}
    .lead-house-icon .lead-house{position:relative;width:18px;height:18px;margin:3px auto 0;background:var(--mccoy-lead-color,#fbbf24);border:2px solid #111827;border-radius:50% 50% 50% 0;box-sizing:border-box;transform:rotate(-45deg);filter:drop-shadow(0 2px 2px rgba(0,0,0,.28))}
    .lead-house-icon .lead-house:before{content:none}
    .lead-house-icon .lead-house:after{content:"";position:absolute;left:50%;top:50%;width:6px;height:6px;border:0;border-radius:50%;background:#fff;transform:translate(-50%,-50%)}
    .lead-house-icon.selected .lead-house{border-width:3px;box-shadow:0 0 0 4px rgba(17,24,39,.24)}
    .lead-house-icon.correction .lead-house{width:24px;height:24px;margin:4px auto 0;border-width:3px;box-shadow:0 0 0 5px rgba(17,24,39,.22)}
    .lead-house-icon.correction .lead-house:after{width:8px;height:8px}
    .mccoy-lead-cluster{background:transparent!important;border:0!important}
    .mccoy-lead-cluster>div{width:38px;height:38px;border-radius:50%;background:#fbbf24;border:3px solid #fff;box-shadow:0 1px 5px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;font:800 13px/1 Arial,sans-serif;color:#111827;box-sizing:border-box}
    .mccoy-lead-cluster.cluster-medium>div{width:44px;height:44px;font-size:14px}
    .mccoy-lead-cluster.cluster-large>div{width:50px;height:50px;font-size:15px}
  `;
  document.head.appendChild(style);

  const canvas=document.createElement('div');
  canvas.id='leadMapFrame';
  canvas.style.cssText='width:100%;height:520px;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;cursor:grab';
  oldMap.replaceWith(canvas);

  const leftCard=canvas.closest('.card');
  const controls=document.createElement('div');
  controls.id='leadGeoControls';
  controls.style.cssText='margin:10px 0;padding:10px;border:1px solid #e5e7eb;border-radius:10px';
  controls.innerHTML=`<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><button id="geocodeRealLeadsBtn" class="primary">GEOCODE REAL LEADS</button><button id="fitAllPinsBtn" class="assign-btn">FIT ALL PINS</button><button id="lassoSelectBtn" class="assign-btn">LASSO SELECT</button><button id="clearMapSelectionBtn" class="assign-btn">CLEAR SELECTION</button><button id="selectVisiblePinsBtn" class="assign-btn">SELECT CURRENT VIEW</button></div><div id="geocodeProgress" class="muted small" style="margin-top:8px">Checking geocode status…</div><div id="mapSelectionStatus" class="muted small" style="margin-top:4px">No leads selected.</div>`;
  leftCard?.insertBefore(controls,canvas);

  const oldSingleAssign=document.getElementById('mapAssignBtn');
  const rightCard=oldSingleAssign?.closest('.card');
  if(oldSingleAssign){oldSingleAssign.style.display='none';oldSingleAssign.onclick=null;}
  if(rightCard){
    let assign=document.getElementById('bulkAssignMapBtn');
    if(!assign){assign=document.createElement('button');assign.id='bulkAssignMapBtn';assign.className='primary';assign.style.cssText='width:100%;margin-top:8px';oldSingleAssign?.insertAdjacentElement('afterend',assign);}
    assign.textContent='ASSIGN SELECTED LEADS';
    if(!document.getElementById('leadCorrectionPanel')){
      const edit=document.createElement('div');edit.id='leadCorrectionPanel';edit.style.cssText='display:none;margin-top:12px;padding-top:10px;border-top:1px solid #e5e7eb';
      edit.innerHTML=`<div style="font-weight:700;margin-bottom:5px">Correct Lead</div><div class="muted small" style="margin-bottom:7px">Click a pin to select it. Drag the larger correction pin to save its exact location, or edit the address below.</div><label class="small">Street address</label><input id="editLeadAddress1" style="width:100%;padding:7px;margin:3px 0 6px"><label class="small">Unit / Address 2</label><input id="editLeadAddress2" style="width:100%;padding:7px;margin:3px 0 6px"><div style="display:grid;grid-template-columns:1fr 54px 70px;gap:5px"><div><label class="small">City</label><input id="editLeadCity" style="width:100%;padding:7px;margin-top:3px"></div><div><label class="small">State</label><input id="editLeadState" maxlength="2" style="width:100%;padding:7px;margin-top:3px;text-transform:uppercase"></div><div><label class="small">ZIP</label><input id="editLeadZip" style="width:100%;padding:7px;margin-top:3px"></div></div><button id="saveLeadAddressBtn" class="assign-btn" style="margin-top:7px;width:100%">SAVE ADDRESS</button><div id="leadCorrectionMsg" class="muted small" style="margin-top:6px"></div>`;
      assign.insertAdjacentElement('afterend',edit);
    }
  }

  const map=L.map(canvas,{preferCanvas:true,zoomControl:true});
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:20,attribution:'&copy; OpenStreetMap contributors'}).addTo(map);

  const clusterIcon=cluster=>{
    const count=cluster.getChildCount();
    const size=count>=100?'cluster-large':count>=20?'cluster-medium':'';
    const px=count>=100?50:count>=20?44:38;
    return L.divIcon({html:`<div>${count.toLocaleString()}</div>`,className:`mccoy-lead-cluster ${size}`,iconSize:L.point(px,px)});
  };
  const leadLayer=typeof L.markerClusterGroup==='function'
    ?L.markerClusterGroup({maxClusterRadius:45,disableClusteringAtZoom:19,showCoverageOnHover:false,zoomToBoundsOnClick:true,spiderfyOnMaxZoom:true,removeOutsideVisibleBounds:true,chunkedLoading:true,iconCreateFunction:clusterIcon})
    :L.layerGroup();
  leadLayer.addTo(map);
  const markerByLead=new Map();

  let selectedIds=new Set(),firstFit=true,lassoMode=false,lassoDrawing=false,lassoPoints=[],lassoPreview=null,lassoPolygon=null,lastLassoPoint=null,lassoStartPoint=null;
  let correctionLead=null,correctionMarker=null;

  function leadPinIcon(selected=false,correction=false){
    const cls=`lead-house-icon lead-spotio-pin-icon${selected?' selected':''}${correction?' correction':''}`;
    return L.divIcon({className:cls,html:'<div class="lead-house lead-spotio-pin" aria-hidden="true"></div>',iconSize:correction?[36,38]:[26,29],iconAnchor:correction?[18,33]:[13,25],tooltipAnchor:[0,correction?-30:-23]});
  }
  function currentRealFiltered(){
    const team=document.getElementById('teamFilter')?.value||'';
    const q=(document.getElementById('leadSearch')?.value||'').toLowerCase();
    return (state.realLeads||[]).filter(l=>Number.isFinite(Number(l.lat))&&Number.isFinite(Number(l.lng))&&(!team||l.team===team)&&(!q||`${l.address} ${l.city||''} ${l.stateCode||''} ${l.zip||''} ${l.rep||''}`.toLowerCase().includes(q)));
  }
  function updateSelectionStatus(prefix=''){
    const leads=currentRealFiltered();const base=`${leads.length.toLocaleString()} mapped leads in current filters · ${selectedIds.size.toLocaleString()} selected.`;const el=document.getElementById('mapSelectionStatus');if(el)el.textContent=prefix?`${prefix} · ${base}`:base;
  }
  function restoreGrabCursor(){
    lassoMode=false;lassoDrawing=false;const btn=document.getElementById('lassoSelectBtn');if(btn){btn.textContent='LASSO SELECT';btn.className='assign-btn';}canvas.style.cursor='grab';map.dragging.enable();map.doubleClickZoom.enable();map.boxZoom.enable();
  }
  function setMarkerSelectedStyle(id){const m=markerByLead.get(id);if(m)m.setIcon(leadPinIcon(selectedIds.has(id)));}
  function toggleLeadSelection(l){if(selectedIds.has(l.dbId))selectedIds.delete(l.dbId);else selectedIds.add(l.dbId);setMarkerSelectedStyle(l.dbId);updateSelectionStatus(selectedIds.has(l.dbId)?'Lead added to selection':'Lead removed from selection');}

  function renderPins(fit=false){
    leadLayer.clearLayers();markerByLead.clear();
    const leads=currentRealFiltered(),bounds=[];
    for(const l of leads){
      const marker=L.marker([Number(l.lat),Number(l.lng)],{icon:leadPinIcon(selectedIds.has(l.dbId)),keyboard:false,title:l.address||'Lead'});
      marker.bindTooltip(`${l.address}${l.rep?' · '+l.rep:''}`);
      marker.on('click',e=>{if(lassoMode){L.DomEvent.stopPropagation(e);return;}toggleLeadSelection(l);selectCorrectionLead(l);});
      markerByLead.set(l.dbId,marker);leadLayer.addLayer(marker);bounds.push([Number(l.lat),Number(l.lng)]);
    }
    updateSelectionStatus();
    if(bounds.length&&(fit||firstFit)){map.fitBounds(bounds,{padding:[18,18],maxZoom:16});firstFit=false;}
  }
  window.MCCOY_RENDER_LEAD_MAP=renderPins;

  function correctionMsg(text){const el=document.getElementById('leadCorrectionMsg');if(el)el.textContent=text;}
  function fillCorrectionForm(l){document.getElementById('editLeadAddress1').value=l.address1||l.address||'';document.getElementById('editLeadAddress2').value=l.address2||'';document.getElementById('editLeadCity').value=l.city||'';document.getElementById('editLeadState').value=l.stateCode||'';document.getElementById('editLeadZip').value=l.zip||'';}
  function selectCorrectionLead(l){
    if(window.MCCOY_ACCESS?.access?.role!=='admin')return;
    correctionLead=l;const p=document.getElementById('leadCorrectionPanel');if(p)p.style.display='block';fillCorrectionForm(l);correctionMsg('Lead selected. Drag the larger pin only if its map location needs correction.');
    if(correctionMarker)map.removeLayer(correctionMarker);
    correctionMarker=L.marker([Number(l.lat),Number(l.lng)],{draggable:true,autoPan:true,title:'Drag to correct lead location',icon:leadPinIcon(false,true)}).addTo(map);
    correctionMarker.bindTooltip('DRAG TO CORRECT LOCATION',{direction:'top'}).openTooltip();
    correctionMarker.on('dragstart',()=>correctionMsg('Move the pin to the correct property, then release to save.'));
    correctionMarker.on('dragend',async()=>{
      const pos=correctionMarker.getLatLng();correctionMsg('Saving corrected location…');
      try{const {data,error}=await sb.functions.invoke('lead-admin',{body:{action:'update_lead',lead_id:l.dbId,latitude:pos.lat,longitude:pos.lng}});if(error||!data?.ok)throw error||new Error(data?.detail||data?.error||'location_save_failed');l.lat=data.lead.latitude;l.lng=data.lead.longitude;markerByLead.get(l.dbId)?.setLatLng([l.lat,l.lng]);correctionMsg('Corrected map location saved.');}
      catch(e){console.error(e);correctionMsg('Unable to save corrected location.');correctionMarker.setLatLng([Number(l.lat),Number(l.lng)]);}finally{restoreGrabCursor();}
    });
  }
  window.MCCOY_SELECT_MAP_LEAD=id=>{const l=(state.realLeads||[]).find(x=>x.id===id||x.dbId===id);if(l){if(!selectedIds.has(l.dbId))selectedIds.add(l.dbId);setMarkerSelectedStyle(l.dbId);updateSelectionStatus('Lead selected');selectCorrectionLead(l);}};

  async function saveAddress(){
    if(!correctionLead)return;const btn=document.getElementById('saveLeadAddressBtn');btn.disabled=true;correctionMsg('Saving address…');
    const patch={action:'update_lead',lead_id:correctionLead.dbId,address1:document.getElementById('editLeadAddress1').value,address2:document.getElementById('editLeadAddress2').value,city:document.getElementById('editLeadCity').value,state:document.getElementById('editLeadState').value,zip:document.getElementById('editLeadZip').value};
    try{const {data,error}=await sb.functions.invoke('lead-admin',{body:patch});if(error||!data?.ok)throw error||new Error(data?.detail||data?.error||'address_save_failed');const r=data.lead;correctionLead.address1=r.address1||'';correctionLead.address2=r.address2||'';correctionLead.address=[r.address1,r.address2].filter(Boolean).join(' ');correctionLead.city=r.city||'';correctionLead.stateCode=r.state||'';correctionLead.zip=r.zip||'';correctionLead.fullAddress=[[r.address1,r.address2].filter(Boolean).join(' '),r.city,r.state,r.zip].filter(Boolean).join(', ');markerByLead.get(correctionLead.dbId)?.setTooltipContent(correctionLead.address);correctionMsg('Lead address saved.');if(typeof window.renderLeads==='function')window.renderLeads();}
    catch(e){console.error(e);correctionMsg('Unable to save lead address.');}finally{btn.disabled=false;restoreGrabCursor();}
  }

  function clearLassoShape(){if(lassoPreview){map.removeLayer(lassoPreview);lassoPreview=null;}if(lassoPolygon){map.removeLayer(lassoPolygon);lassoPolygon=null;}lassoPoints=[];lastLassoPoint=null;lassoStartPoint=null;}
  function clearSelection(){selectedIds.clear();clearLassoShape();restoreGrabCursor();renderPins(false);updateSelectionStatus('Selection cleared');}
  function selectVisible(){clearLassoShape();const b=map.getBounds();selectedIds=new Set(currentRealFiltered().filter(l=>b.contains([Number(l.lat),Number(l.lng)])).map(l=>l.dbId));restoreGrabCursor();renderPins(false);updateSelectionStatus('Current map view selected');}
  function pointInPolygon(lat,lng,poly){let inside=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const yi=poly[i].lat,xi=poly[i].lng,yj=poly[j].lat,xj=poly[j].lng;const crosses=((yi>lat)!==(yj>lat))&&(lng<(xj-xi)*(lat-yi)/((yj-yi)||1e-12)+xi);if(crosses)inside=!inside;}return inside;}
  function setLassoMode(on){lassoMode=on;const btn=document.getElementById('lassoSelectBtn');if(on){if(correctionMarker){map.removeLayer(correctionMarker);correctionMarker=null;}clearLassoShape();btn.textContent='DRAW LASSO…';btn.className='primary';canvas.style.cursor='crosshair';map.dragging.disable();map.doubleClickZoom.disable();map.boxZoom.disable();updateSelectionStatus('Hold the mouse button and drag around the leads, then release');}else restoreGrabCursor();}
  function beginLasso(e){if(!lassoMode)return;const oe=e.originalEvent;if(oe&&typeof oe.button==='number'&&oe.button!==0)return;lassoDrawing=true;lassoPoints=[e.latlng];lastLassoPoint=e.containerPoint;lassoStartPoint=e.containerPoint;if(lassoPreview)map.removeLayer(lassoPreview);lassoPreview=L.polyline(lassoPoints,{weight:2,dashArray:'6 4',interactive:false}).addTo(map);oe?.preventDefault?.();oe?.stopPropagation?.();}
  function extendLasso(e){if(!lassoMode||!lassoDrawing)return;const p=e.containerPoint;if(lastLassoPoint&&p.distanceTo(lastLassoPoint)<3)return;lastLassoPoint=p;lassoPoints.push(e.latlng);lassoPreview?.setLatLngs(lassoPoints);}
  function finishLasso(e){if(!lassoMode||!lassoDrawing)return;lassoDrawing=false;const end=e?.containerPoint||lastLassoPoint,dist=(lassoStartPoint&&end)?lassoStartPoint.distanceTo(end):0;if(lassoPreview){map.removeLayer(lassoPreview);lassoPreview=null;}if(lassoPoints.length<3||dist<12){lassoPoints=[];lastLassoPoint=null;lassoStartPoint=null;updateSelectionStatus('Lasso is still active — hold the mouse button and drag a shape around the leads');return;}if(lassoPolygon){map.removeLayer(lassoPolygon);lassoPolygon=null;}lassoPolygon=L.polygon(lassoPoints,{weight:2,fillOpacity:.12,interactive:false}).addTo(map);selectedIds=new Set(currentRealFiltered().filter(l=>pointInPolygon(Number(l.lat),Number(l.lng),lassoPoints)).map(l=>l.dbId));restoreGrabCursor();renderPins(false);updateSelectionStatus(`Lasso selected ${selectedIds.size.toLocaleString()} leads`);}
  map.on('mousedown',beginLasso);map.on('mousemove',extendLasso);map.on('mouseup',finishLasso);

  async function geocodeStatus(){if(window.MCCOY_ACCESS?.access?.role!=='admin'){document.getElementById('geocodeRealLeadsBtn').style.display='none';document.getElementById('geocodeProgress').textContent='Lead coordinates are managed by Admin.';return null;}try{const {data,error}=await sb.functions.invoke('lead-geocode',{body:{action:'status'}});if(error)throw error;document.getElementById('geocodeProgress').textContent=`Mapped ${Number(data.geocoded||0).toLocaleString()} of ${Number(data.total||0).toLocaleString()} · ${Number(data.unmatched||0).toLocaleString()} unmatched · ${Number(data.remaining||0).toLocaleString()} not processed.`;return data;}catch(e){console.error(e);document.getElementById('geocodeProgress').textContent='Unable to read geocode status.';return null;}}
  async function geocodeAll(){const btn=document.getElementById('geocodeRealLeadsBtn');if(window.MCCOY_ACCESS?.access?.role!=='admin')return;btn.disabled=true;btn.textContent='GEOCODING…';try{let loops=0;while(loops++<20){const {data,error}=await sb.functions.invoke('lead-geocode',{body:{action:'geocode_next',limit:750}});if(error||!data?.ok)throw error||new Error(data?.error||'geocode_failed');document.getElementById('geocodeProgress').textContent=`Processed ${Number(data.attempted||0).toLocaleString()} / ${Number(data.total||0).toLocaleString()} · mapped ${Number(data.geocoded||0).toLocaleString()} · unmatched ${Number(data.unmatched||0).toLocaleString()} · remaining ${Number(data.remaining||0).toLocaleString()}.`;if(data.complete||!data.processed)break;}await window.loadMcCoyLeads?.();setTimeout(()=>renderPins(true),250);}catch(e){console.error(e);document.getElementById('geocodeProgress').textContent='Geocoding stopped because of an error. You can safely press GEOCODE REAL LEADS again to resume.';}btn.disabled=false;btn.textContent='GEOCODE REAL LEADS';await geocodeStatus();restoreGrabCursor();}
  async function assignSelectedLeads(){const msg=document.getElementById('mapAssignMsg');if(window.MCCOY_ACCESS?.access?.role!=='admin'){msg.textContent='Only Admin can assign real leads.';restoreGrabCursor();return;}if(!selectedIds.size){msg.textContent='Select one or more leads first.';restoreGrabCursor();return;}const repEmail=document.getElementById('mapRepSelect').value,ids=[...selectedIds];msg.textContent=`Assigning ${ids.length.toLocaleString()} selected lead${ids.length===1?'':'s'}…`;try{for(let i=0;i<ids.length;i+=500){const {data,error}=await sb.functions.invoke('lead-admin',{body:{action:'assign_leads',lead_ids:ids.slice(i,i+500),rep_email:repEmail}});if(error||!data?.ok)throw error||new Error(data?.detail||data?.error||'bulk_assign_failed');}msg.textContent=`${ids.length.toLocaleString()} selected lead${ids.length===1?'':'s'} assigned successfully.`;selectedIds.clear();clearLassoShape();if(correctionMarker){map.removeLayer(correctionMarker);correctionMarker=null;}await window.loadMcCoyLeads?.();setTimeout(()=>renderPins(false),250);}catch(e){console.error(e);msg.textContent=`Assignment failed${e?.message?': '+e.message:''}.`;}finally{restoreGrabCursor();}}

  document.getElementById('geocodeRealLeadsBtn').onclick=geocodeAll;
  document.getElementById('fitAllPinsBtn').onclick=()=>{restoreGrabCursor();renderPins(true);};
  document.getElementById('lassoSelectBtn').onclick=()=>setLassoMode(!lassoMode);
  document.getElementById('clearMapSelectionBtn').onclick=clearSelection;
  document.getElementById('selectVisiblePinsBtn').onclick=selectVisible;
  document.getElementById('bulkAssignMapBtn').onclick=assignSelectedLeads;
  document.getElementById('saveLeadAddressBtn').onclick=saveAddress;
  document.getElementById('teamFilter')?.addEventListener('change',()=>{selectedIds.clear();clearLassoShape();restoreGrabCursor();setTimeout(()=>renderPins(true),0);});
  document.getElementById('leadSearch')?.addEventListener('input',()=>{selectedIds.clear();clearLassoShape();restoreGrabCursor();setTimeout(()=>renderPins(true),100);});
  window.addEventListener('mccoy-real-leads-loaded',()=>setTimeout(()=>{restoreGrabCursor();renderPins(true);geocodeStatus();},200));
  const obs=new MutationObserver(()=>{if(panel.style.display!=='none')setTimeout(()=>{map.invalidateSize();restoreGrabCursor();renderPins(firstFit);},50);});obs.observe(panel,{attributes:true,attributeFilter:['style']});
  setTimeout(()=>{map.setView([39.5,-98.35],4);restoreGrabCursor();renderPins(true);geocodeStatus();},800);
})();