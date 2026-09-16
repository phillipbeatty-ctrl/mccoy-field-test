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
    .lead-house-icon.pin-location-verified .lead-house{box-shadow:0 0 0 3px rgba(22,163,74,.45)}
    .lead-house-icon.pin-location-review .lead-house{border-style:dashed;opacity:.78}
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
  controls.innerHTML=`<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><button id="geocodeRealLeadsBtn" class="primary">VERIFY NEXT 25 WITH GOOGLE</button><button id="fitAllPinsBtn" class="assign-btn">FIT ALL PINS</button><button id="lassoSelectBtn" class="assign-btn">LASSO SELECT</button><button id="clearMapSelectionBtn" class="assign-btn">CLEAR SELECTION</button><button id="selectVisiblePinsBtn" class="assign-btn">SELECT CURRENT VIEW</button></div><div id="geocodeProgress" class="muted small" style="margin-top:8px">Checking Google verification status…</div><div id="mapSelectionStatus" class="muted small" style="margin-top:4px">No leads selected.</div>`;
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
      edit.innerHTML=`<div style="font-weight:700;margin-bottom:5px">Correct Lead</div><div class="muted small" style="margin-bottom:7px">Select MOVE PIN, drag the large correction pin to the actual door, then confirm the proposed location.</div><button id="moveLeadPinBtn" class="primary" style="width:100%;min-height:48px">MOVE PIN</button><div id="movePinActions" style="display:none;grid-template-columns:1fr 1fr;gap:7px;margin-top:7px"><button id="confirmLeadPinBtn" class="primary" style="min-height:48px" disabled>CONFIRM LOCATION</button><button id="cancelLeadPinBtn" class="assign-btn" style="min-height:48px">CANCEL</button><button id="keepOriginalPinBtn" class="assign-btn" style="grid-column:1/3;min-height:44px">KEEP ORIGINAL</button></div><div id="movePinDistance" class="muted small" style="margin-top:6px"></div><div id="adminLeadAddressFields"><label class="small">Street address</label><input id="editLeadAddress1" style="width:100%;padding:7px;margin:3px 0 6px"><label class="small">Unit / Address 2</label><input id="editLeadAddress2" style="width:100%;padding:7px;margin:3px 0 6px"><div style="display:grid;grid-template-columns:1fr 54px 70px;gap:5px"><div><label class="small">City</label><input id="editLeadCity" style="width:100%;padding:7px;margin-top:3px"></div><div><label class="small">State</label><input id="editLeadState" maxlength="2" style="width:100%;padding:7px;margin-top:3px;text-transform:uppercase"></div><div><label class="small">ZIP</label><input id="editLeadZip" style="width:100%;padding:7px;margin-top:3px"></div></div><button id="saveLeadAddressBtn" class="assign-btn" style="margin-top:7px;width:100%">SAVE ADDRESS</button></div><div id="leadCorrectionMsg" class="muted small" style="margin-top:6px" aria-live="polite"></div>`;
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
    ?L.markerClusterGroup({maxClusterRadius:45,disableClusteringAtZoom:19,showCoverageOnHover:false,zoomToBoundsOnClick:true,spiderfyOnMaxZoom:true,removeOutsideVisibleBounds:true,chunkedLoading:true,chunkInterval:80,chunkDelay:15,iconCreateFunction:clusterIcon})
    :L.layerGroup();
  leadLayer.addTo(map);
  const markerByLead=new Map(),pinIconCache=new Map();
  let renderedLeadSource=null,renderedFilterKey='',renderedBounds=[],mappedLeadCount=0,searchRenderTimer=null;

  let selectedIds=new Set(),firstFit=true,lassoMode=false,lassoDrawing=false,lassoPoints=[],lassoPreview=null,lassoPolygon=null,lastLassoPoint=null,lassoStartPoint=null;
  let correctionLead=null,correctionMarker=null,movePinOriginal=null,movePinProposed=null,movePinBusy=false,movePinRequest=0;

  function pinLocationQuality(lead){
    const status=String(lead?.geocodeStatus||'').toLowerCase(),verification=String(lead?.geocodeVerificationStatus||'').toLowerCase();
    if(['google_rooftop','google_address_validation','manual','field_verified'].includes(status)||['google_verified_preserved','google_address_validation_applied'].includes(verification))return'verified';
    return'review';
  }
  function leadPinIcon(lead,selected=false,correction=false){
    const quality=pinLocationQuality(lead),key=`${quality}:${selected?'selected':'normal'}:${correction?'correction':'pin'}`;if(pinIconCache.has(key))return pinIconCache.get(key);
    const cls=`lead-house-icon lead-spotio-pin-icon pin-location-${quality}${selected?' selected':''}${correction?' correction':''}`;
    const icon=L.divIcon({className:cls,html:'<div class="lead-house lead-spotio-pin" aria-hidden="true"></div>',iconSize:correction?[36,38]:[26,29],iconAnchor:correction?[18,33]:[13,25],tooltipAnchor:[0,correction?-30:-23]});pinIconCache.set(key,icon);return icon;
  }
  function currentRealFiltered(){
    return (state.realLeads||[]).filter(lead=>Number.isFinite(Number(lead.lat))&&Number.isFinite(Number(lead.lng))&&(!window.MCCOY_LEAD_MATCHES_FILTER||window.MCCOY_LEAD_MATCHES_FILTER(lead)));
  }
  function updateSelectionStatus(prefix=''){
    const filterKey=`${document.getElementById('teamFilter')?.value||''}|${document.getElementById('leadOwnerFilter')?.value||''}|${(document.getElementById('leadSearch')?.value||'').toLowerCase()}`,count=renderedLeadSource===state.realLeads&&renderedFilterKey===filterKey?mappedLeadCount:currentRealFiltered().length;const base=`${count.toLocaleString()} mapped leads in current filters · ${selectedIds.size.toLocaleString()} selected.`;const el=document.getElementById('mapSelectionStatus');if(el)el.textContent=prefix?`${prefix} · ${base}`:base;
  }
  function restoreGrabCursor(){
    lassoMode=false;lassoDrawing=false;window.MCCOY_LASSO_ACTIVE=false;const btn=document.getElementById('lassoSelectBtn');if(btn){btn.textContent='LASSO SELECT';btn.className='assign-btn';}canvas.style.cursor='grab';canvas.style.touchAction='';map.dragging.enable();map.touchZoom?.enable();map.doubleClickZoom.enable();map.boxZoom.enable();
  }
  function styleMarker(marker){
    const element=marker.getElement?.(),lead=marker._mccoyLead;if(!element||!lead)return;
    element.dataset.mccoyLeadId=String(lead.dbId||lead.id);
    window.MCCOY_COLOR_LEAD_MARKER?.(element,lead);
  }
  function setMarkerSelectedStyle(id){const marker=markerByLead.get(id);if(!marker)return;const selected=selectedIds.has(id);if(marker._mccoySelected===selected)return;marker._mccoySelected=selected;marker.setIcon(leadPinIcon(marker._mccoyLead,selected));styleMarker(marker);}
  function toggleLeadSelection(l){if(selectedIds.has(l.dbId))selectedIds.delete(l.dbId);else selectedIds.add(l.dbId);setMarkerSelectedStyle(l.dbId);updateSelectionStatus(selectedIds.has(l.dbId)?'Lead added to selection':'Lead removed from selection');}

  function renderPins(fit=false){
    const source=state.realLeads||[],filterKey=`${document.getElementById('teamFilter')?.value||''}|${document.getElementById('leadOwnerFilter')?.value||''}|${(document.getElementById('leadSearch')?.value||'').toLowerCase()}`;
    if(renderedLeadSource===source&&renderedFilterKey===filterKey){for(const [id,marker] of markerByLead){const location=marker.getLatLng?.(),lead=marker._mccoyLead;if(location&&lead&&(location.lat!==Number(lead.lat)||location.lng!==Number(lead.lng))){renderedLeadSource=null;return renderPins(fit);}const selected=selectedIds.has(id);if(marker._mccoySelected!==selected){marker._mccoySelected=selected;marker.setIcon(leadPinIcon(lead,selected));styleMarker(marker);}}updateSelectionStatus();if(renderedBounds.length&&(fit||firstFit)){map.fitBounds(renderedBounds,{padding:[18,18],maxZoom:16});firstFit=false;}return;}
    leadLayer.clearLayers();markerByLead.clear();
    const leads=currentRealFiltered(),bounds=[],markers=[];
    for(const lead of leads){
      const selected=selectedIds.has(lead.dbId),marker=L.marker([Number(lead.lat),Number(lead.lng)],{icon:leadPinIcon(lead,selected),keyboard:false,title:lead.address||'Lead'});marker._mccoySelected=selected;marker._mccoyLead=lead;
      marker.on('add',()=>styleMarker(marker));
      marker.bindTooltip(`${lead.address}${lead.ownerName&&lead.ownerRole!=='unassigned'?' · Owner: '+lead.ownerName:''} · ${pinLocationQuality(lead)==='verified'?'Location verified':'Location needs review'}`);
      marker.on('click',event=>{if(lassoMode){L.DomEvent.stopPropagation(event);return;}toggleLeadSelection(lead);selectCorrectionLead(lead);window.dispatchEvent(new CustomEvent('mccoy-map-lead-selected',{detail:{leadId:lead.dbId||lead.id}}));});
      markerByLead.set(lead.dbId,marker);markers.push(marker);bounds.push([Number(lead.lat),Number(lead.lng)]);
    }
    if(typeof leadLayer.addLayers==='function')leadLayer.addLayers(markers);else for(const marker of markers)leadLayer.addLayer(marker);
    renderedLeadSource=source;renderedFilterKey=filterKey;renderedBounds=bounds;mappedLeadCount=leads.length;updateSelectionStatus();
    if(bounds.length&&(fit||firstFit)){map.fitBounds(bounds,{padding:[18,18],maxZoom:16});firstFit=false;}
  }
  window.MCCOY_RENDER_LEAD_MAP=renderPins;
  window.MCCOY_LEAD_MAP={map,canvas,renderPins,invalidateSize:options=>map.invalidateSize(options||{pan:false}),fitLeadPins:()=>renderPins(true)};
  window.MCCOY_INVALIDATE_LEAD_MAP=()=>setTimeout(()=>{
    if(panel.style.display==='none')return;
    map.invalidateSize({pan:false});
    renderPins(false);
  },50);
  // Proactive settle, independent of any specific external event firing.
  // Confirmed with a real user report: opening the map and simply waiting --
  // without backgrounding the app (which triggers the visibilitychange fix
  // below) and without anything else touching this panel's style (which
  // triggers the MutationObserver below) -- can leave it visibly undersized
  // for roughly 30 seconds, until something else unrelated coincidentally
  // fires an event that happens to correct it. Rather than keep hunting for
  // that exact coincidental trigger, this polls invalidateSize a bounded
  // number of times right after the map initializes, so correction is fast
  // and guaranteed regardless of what else is or isn't happening.
  let settleAttempts=0;
  const settleInterval=setInterval(()=>{
    settleAttempts++;
    if(panel.style.display!=='none')map.invalidateSize({pan:false});
    if(settleAttempts>=8)clearInterval(settleInterval);
  },500);

  function correctionMsg(text){const el=document.getElementById('leadCorrectionMsg');if(el)el.textContent=text;}
  function fillCorrectionForm(l){document.getElementById('editLeadAddress1').value=l.address1||l.address||'';document.getElementById('editLeadAddress2').value=l.address2||'';document.getElementById('editLeadCity').value=l.city||'';document.getElementById('editLeadState').value=l.stateCode||'';document.getElementById('editLeadZip').value=l.zip||'';}
  function metersBetween(a,b){if(!a||!b)return null;const r=Math.PI/180,dLat=(b.lat-a.lat)*r,dLng=(b.lng-a.lng)*r,x=Math.sin(dLat/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(dLng/2)**2;return 6371000*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));}
  function syncMovePinButtons(active=false){
    const actions=document.getElementById('movePinActions'),move=document.getElementById('moveLeadPinBtn'),confirm=document.getElementById('confirmLeadPinBtn');
    if(actions)actions.style.display=active?'grid':'none';if(move)move.style.display=active?'none':'block';for(const id of ['cancelLeadPinBtn','keepOriginalPinBtn']){const button=document.getElementById(id);if(button)button.disabled=movePinBusy;}if(confirm)confirm.disabled=!active||!movePinProposed||movePinBusy;
  }
  function endMovePin(message=''){
    movePinRequest+=1;
    if(correctionMarker){map.removeLayer(correctionMarker);correctionMarker=null;}
    if(correctionLead){markerByLead.get(correctionLead.dbId)?.setOpacity?.(1);}
    movePinOriginal=null;movePinProposed=null;movePinBusy=false;window.MCCOY_MAP_MOVE_PIN_ACTIVE=false;syncMovePinButtons(false);restoreGrabCursor();
    const distance=document.getElementById('movePinDistance');if(distance)distance.textContent='';if(message)correctionMsg(message);
    window.dispatchEvent(new CustomEvent('mccoy-map-move-pin-ended',{detail:{leadId:correctionLead?.dbId||correctionLead?.id||null,message}}));
  }
  async function currentUserMayMove(l){
    const role=String(window.MCCOY_ACCESS?.access?.role||'').toLowerCase();
    if(!['admin','manager','trainer','rep'].includes(role))return false;
    const {data}=await sb.auth.getUser();const id=String(data?.user?.id||'');if(!id)return false;
    return role==='admin'||(role==='rep'&&String(l.assignedRepId||'')===id)||(['manager','trainer'].includes(role)&&String(l.assignedManagerId||'')===id);
  }
  async function fetchAuthoritativeMovePinState(l){
    const leadId=String(l?.dbId||l?.id||'');
    if(!leadId)throw new Error('pin_snapshot_unavailable');
    const {data,error}=await sb.functions.invoke('lead-pin-snapshot',{body:{lead_id:leadId}});
    const snapshot=data?.lead,coordinate=(value,limit)=>value===null||(typeof value==='number'&&Number.isFinite(value)&&Math.abs(value)<=limit);
    if(error||!data?.ok||String(snapshot?.id||'')!==leadId||typeof snapshot?.pin_location_updated_at!=='string'||!Number.isFinite(Date.parse(snapshot.pin_location_updated_at))||!coordinate(snapshot.latitude,90)||!coordinate(snapshot.longitude,180))throw new Error('pin_snapshot_unavailable');
    const hasPin=snapshot.latitude!==null&&snapshot.longitude!==null,hasCandidate=Number.isFinite(Number(l.geocodeCandidateLat))&&Number.isFinite(Number(l.geocodeCandidateLng));
    if(!hasPin&&!hasCandidate)throw new Error('pin_start_unavailable');
    return Object.freeze({
      lat:Number(hasPin?snapshot.latitude:l.geocodeCandidateLat),lng:Number(hasPin?snapshot.longitude:l.geocodeCandidateLng),
      latitude:snapshot.latitude,longitude:snapshot.longitude,updatedAt:snapshot.pin_location_updated_at
    });
  }
  function movePinAdminDiagnostic(reason,status,mismatches=[]){
    if(String(window.MCCOY_ACCESS?.access?.role||'').toLowerCase()!=='admin'||!String(window.MCCOY_ACCESS?.user?.id||''))return'';
    const parts=[reason,status?`HTTP ${status}`:'',mismatches.length?`changed: ${mismatches.join(', ')}`:''].filter(Boolean);
    return parts.length?` Admin diagnostic: ${parts.join(' · ')}.`:'';
  }
  async function movePinFailurePayload(error){
    let payload=null,status=Number(error?.context?.status)||null;
    if(error?.context?.clone){
      try{payload=await error.context.clone().json();}
      catch{try{const text=String(await error.context.clone().text()||'').trim();if(text)payload={message:text.slice(0,500)};}catch{}}
    }
    return{payload,status};
  }
  async function startMovePin(){
    const l=correctionLead;if(!l||movePinBusy)return;
    const requestId=++movePinRequest,allowed=await currentUserMayMove(l);
    if(requestId!==movePinRequest)return;
    if(!allowed){correctionMsg('You can move only a lead currently assigned to you or your managed team.');return;}
    correctionMsg('Loading the current saved pin…');
    try{movePinOriginal=await fetchAuthoritativeMovePinState(l);}
    catch(error){correctionMsg(error?.message==='pin_start_unavailable'?'This lead has no starting map point. Save a complete address before placing it.':'The current saved pin could not be loaded. Try MOVE PIN again.');return;}
    if(requestId!==movePinRequest||correctionLead!==l)return;
    clearLassoShape();restoreGrabCursor();window.MCCOY_MAP_MOVE_PIN_ACTIVE=true;
    window.dispatchEvent(new CustomEvent('mccoy-map-move-pin-started',{detail:{leadId:l.dbId||l.id}}));
    l.lat=movePinOriginal.latitude;l.lng=movePinOriginal.longitude;l.updatedAt=movePinOriginal.updatedAt;movePinProposed=null;
    markerByLead.get(l.dbId)?.setOpacity?.(.38);
    correctionMarker=L.marker([movePinOriginal.lat,movePinOriginal.lng],{draggable:true,autoPan:true,title:'Move pin to the actual door',icon:leadPinIcon(l,false,true)}).addTo(map);
    correctionMarker._mccoyLead=l;styleMarker(correctionMarker);
    correctionMarker.bindTooltip('MOVE TO ACTUAL DOOR',{direction:'top'}).openTooltip();syncMovePinButtons(true);
    correctionMarker.on('dragstart',()=>correctionMsg('Move the large pin to the correct property, then release to preview.'));
    correctionMarker.on('dragend',()=>{const pos=correctionMarker.getLatLng();movePinProposed={lat:pos.lat,lng:pos.lng};const meters=metersBetween(movePinOriginal,movePinProposed);const distance=document.getElementById('movePinDistance');if(distance)distance.textContent=`Proposed move: ${meters<30?Math.round(meters*3.28084)+' ft':Math.round(meters)+' m'} from the original pin.`;correctionMsg('Review the proposed position, then select CONFIRM LOCATION.');syncMovePinButtons(true);});
  }
  function freshGps(){return new Promise(resolve=>{if(!navigator.geolocation)return resolve(null);navigator.geolocation.getCurrentPosition(position=>resolve({lat:Number(position.coords.latitude),lng:Number(position.coords.longitude),accuracy:Number(position.coords.accuracy),capturedAt:Date.now()}),()=>resolve(null),{enableHighAccuracy:true,maximumAge:0,timeout:10000});});}
  async function confirmMovePin(){
    const l=correctionLead,original=movePinOriginal,proposed=movePinProposed,requestId=movePinRequest;if(!l||!original||!proposed||movePinBusy)return;movePinBusy=true;syncMovePinButtons(true);correctionMsg('Confirming permission and current GPS…');
    try{
      const role=String(window.MCCOY_ACCESS?.access?.role||'').toLowerCase(),gps=await freshGps();
      if(requestId!==movePinRequest||correctionLead!==l)return;
      if(role!=='admin'&&!gps)throw new Error('fresh_gps_required');
      const body={action:'move_lead_pin',lead_id:l.dbId,expected_updated_at:original.updatedAt,original_latitude:original.latitude,original_longitude:original.longitude,proposed_latitude:proposed.lat,proposed_longitude:proposed.lng,actor_latitude:gps?.lat??null,actor_longitude:gps?.lng??null,actor_accuracy_meters:gps?.accuracy??null,gps_captured_at:gps?new Date(gps.capturedAt).toISOString():null,client_request_id:crypto.randomUUID(),client_context:{platform:navigator.userAgentData?.platform||navigator.platform||'web',app_version:window.MCCOY_CLIENT_VERSION||''}};
      const {data,error}=await (window.MCCOY_INVOKE_MOVE_PIN?window.MCCOY_INVOKE_MOVE_PIN(body):sb.functions.invoke('lead-admin',{body}));
      if(requestId!==movePinRequest||correctionLead!==l)return;
      if(error||!data?.ok){
        const safeCodes=['stale_lead','fresh_gps_required','unauthorized_lead'];const failure=await movePinFailurePayload(error);let code=data?.error||failure.payload?.error;
        // Non-2xx SDK results put the stable rejection code in error.context.
        // Only these public recovery codes may select a UI branch; never detail.
        if(!safeCodes.includes(code)&&error?.context?.clone){try{const payload=await error.context.clone().json();code=payload?.error;}catch{}}
        if(requestId!==movePinRequest||correctionLead!==l)return;
        const failureError=new Error(safeCodes.includes(code)?code:'location_save_failed');failureError.status=failure.status;failureError.backendReason=[failure.payload?.error,failure.payload?.detail].filter(Boolean).join(': ')||failure.payload?.message||error?.message||failureError.message;throw failureError;
      }
      l.lat=data.lead.latitude;l.lng=data.lead.longitude;l.updatedAt=data.lead.updated_at;l.geocodeStatus=data.lead.geocode_status;l.geocodeProvider=data.lead.geocode_provider;l.geocodePrecision=data.lead.geocode_precision;l.geocodeVerificationStatus=data.lead.geocode_verification_status;
      const marker=markerByLead.get(l.dbId);marker?.setLatLng([l.lat,l.lng]);marker?.setIcon(leadPinIcon(l,selectedIds.has(l.dbId)));if(marker)styleMarker(marker);endMovePin(data.decision==='review_required'?'Location saved and flagged for Admin review.':'Location confirmed and saved.');
    }catch(error){
      const reason=String(error?.message||error);
      if(reason.includes('stale_lead')){
        try{
          const previous=movePinOriginal,current=await fetchAuthoritativeMovePinState(l);
          if(requestId!==movePinRequest||correctionLead!==l)return;
          const mismatches=[];if(previous.updatedAt!==current.updatedAt)mismatches.push('timestamp');if(previous.latitude!==current.latitude)mismatches.push('latitude');if(previous.longitude!==current.longitude)mismatches.push('longitude');
          movePinOriginal=current;l.lat=current.latitude;l.lng=current.longitude;l.updatedAt=current.updatedAt;
          const marker=markerByLead.get(l.dbId);if(current.latitude!==null&&current.longitude!==null)marker?.setLatLng([current.latitude,current.longitude]);
          const meters=metersBetween(current,movePinProposed),distance=document.getElementById('movePinDistance');if(distance&&Number.isFinite(meters))distance.textContent=`Proposed move: ${meters<30?Math.round(meters*3.28084)+' ft':Math.round(meters)+' m'} from the current saved pin.`;
          movePinBusy=false;syncMovePinButtons(true);correctionMsg(`The saved pin changed. Its current version is loaded; review the proposed location and tap the green check again.${movePinAdminDiagnostic('stale_lead',error.status||409,mismatches)}`);
        }catch{
          movePinBusy=false;syncMovePinButtons(true);correctionMsg(`The saved pin changed, but its current version could not be loaded. Cancel and reopen MOVE PIN.${movePinAdminDiagnostic('stale_lead',error.status||409)}`);
        }
      }else{movePinBusy=false;syncMovePinButtons(true);const generic=reason.includes('fresh_gps_required')?'A fresh GPS fix is required before this field correction can be confirmed.':reason.includes('unauthorized_lead')?'Your assignment changed or you no longer control this lead.':'Unable to save the proposed location. The original pin is unchanged.';correctionMsg(`${generic}${movePinAdminDiagnostic(error.backendReason||reason,error.status)}`);}
    }
  }
  function selectCorrectionLead(l){
    const hasPin=Number.isFinite(Number(l.lat))&&Number.isFinite(Number(l.lng)),hasCandidate=Number.isFinite(Number(l.geocodeCandidateLat))&&Number.isFinite(Number(l.geocodeCandidateLng));
    if(correctionLead!==l)endMovePin();correctionLead=l;const p=document.getElementById('leadCorrectionPanel');if(p)p.style.display='block';fillCorrectionForm(l);document.getElementById('adminLeadAddressFields').style.display=window.MCCOY_ACCESS?.access?.role==='admin'?'block':'none';correctionMsg(hasPin?'Lead selected. Select MOVE PIN to propose a corrected door location.':hasCandidate?'A review point is available. Select MOVE PIN to place it on the actual door.':'This lead needs a complete address before it can be placed.');
  }
  window.MCCOY_SELECT_MAP_LEAD=id=>{const l=(state.realLeads||[]).find(x=>x.id===id||x.dbId===id);if(l){if(!selectedIds.has(l.dbId))selectedIds.add(l.dbId);setMarkerSelectedStyle(l.dbId);updateSelectionStatus('Lead selected');selectCorrectionLead(l);}};

  async function saveAddress(){
    if(!correctionLead)return;
    if(typeof window.MCCOY_CORRECT_ADDRESS_LOCATION==='function')return window.MCCOY_CORRECT_ADDRESS_LOCATION();
    correctionMsg('Address verification is still loading. Please try again.');
  }

  function clearLassoShape(){if(lassoPreview){map.removeLayer(lassoPreview);lassoPreview=null;}if(lassoPolygon){map.removeLayer(lassoPolygon);lassoPolygon=null;}lassoPoints=[];lastLassoPoint=null;lassoStartPoint=null;}
  function clearSelection(){if(window.MCCOY_MAP_MOVE_PIN_ACTIVE)endMovePin();selectedIds.clear();clearLassoShape();restoreGrabCursor();renderPins(false);updateSelectionStatus('Selection cleared');}
  function selectVisible(){clearLassoShape();const b=map.getBounds();selectedIds=new Set(currentRealFiltered().filter(l=>b.contains([Number(l.lat),Number(l.lng)])).map(l=>l.dbId));restoreGrabCursor();renderPins(false);updateSelectionStatus('Current map view selected');}
  function pointInPolygon(lat,lng,poly){let inside=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const yi=poly[i].lat,xi=poly[i].lng,yj=poly[j].lat,xj=poly[j].lng;const crosses=((yi>lat)!==(yj>lat))&&(lng<(xj-xi)*(lat-yi)/((yj-yi)||1e-12)+xi);if(crosses)inside=!inside;}return inside;}
  function setLassoMode(on){if(on&&window.MCCOY_MAP_MOVE_PIN_ACTIVE)endMovePin('Pin movement cancelled before lasso selection.');lassoMode=on;window.MCCOY_LASSO_ACTIVE=on;const btn=document.getElementById('lassoSelectBtn');if(on){clearLassoShape();btn.textContent='DRAW LASSO…';btn.className='primary';canvas.style.cursor='crosshair';canvas.style.touchAction='none';map.dragging.disable();map.touchZoom?.disable();map.doubleClickZoom.disable();map.boxZoom.disable();updateSelectionStatus('Drag your finger or hold the mouse button around the leads, then release');}else restoreGrabCursor();}
  function beginLasso(e){if(!lassoMode)return;const oe=e.originalEvent;if(oe&&typeof oe.button==='number'&&oe.button!==0)return;window.MCCOY_LASSO_ACTIVE=true;lassoDrawing=true;lassoPoints=[e.latlng];lastLassoPoint=e.containerPoint;lassoStartPoint=e.containerPoint;if(lassoPreview)map.removeLayer(lassoPreview);lassoPreview=L.polyline(lassoPoints,{weight:2,dashArray:'6 4',interactive:false}).addTo(map);oe?.preventDefault?.();oe?.stopPropagation?.();}
  function extendLasso(e){if(!lassoMode||!lassoDrawing)return;const p=e.containerPoint;if(lastLassoPoint&&p.distanceTo(lastLassoPoint)<3)return;lastLassoPoint=p;lassoPoints.push(e.latlng);lassoPreview?.setLatLngs(lassoPoints);}
  function finishLasso(e){if(!lassoMode||!lassoDrawing)return;lassoDrawing=false;const end=e?.containerPoint||lastLassoPoint,dist=(lassoStartPoint&&end)?lassoStartPoint.distanceTo(end):0;if(lassoPreview){map.removeLayer(lassoPreview);lassoPreview=null;}if(lassoPoints.length<3||dist<12){lassoPoints=[];lastLassoPoint=null;lassoStartPoint=null;updateSelectionStatus('Lasso is still active — drag your finger or mouse around the leads');return;}if(lassoPolygon){map.removeLayer(lassoPolygon);lassoPolygon=null;}lassoPolygon=L.polygon(lassoPoints,{weight:2,fillOpacity:.12,interactive:false}).addTo(map);selectedIds=new Set(currentRealFiltered().filter(l=>pointInPolygon(Number(l.lat),Number(l.lng),lassoPoints)).map(l=>l.dbId));window.MCCOY_LASSO_IGNORE_MAP_CLEAR_UNTIL=Date.now()+900;restoreGrabCursor();renderPins(false);updateSelectionStatus(`Lasso selected ${selectedIds.size.toLocaleString()} leads`);}
  map.on('mousedown',beginLasso);map.on('mousemove',extendLasso);map.on('mouseup',finishLasso);
  function touchAsLeafletEvent(event,useChanged=false){const list=useChanged?event.changedTouches:event.touches;const touch=list?.[0]||event.changedTouches?.[0];if(!touch)return null;const rect=canvas.getBoundingClientRect(),containerPoint=L.point(touch.clientX-rect.left,touch.clientY-rect.top);return{latlng:map.containerPointToLatLng(containerPoint),containerPoint,originalEvent:event};}
  canvas.addEventListener('touchstart',event=>{if(!lassoMode||event.touches.length!==1)return;event.preventDefault();const adapted=touchAsLeafletEvent(event);if(adapted)beginLasso(adapted);},{passive:false});
  canvas.addEventListener('touchmove',event=>{if(!lassoMode||!lassoDrawing)return;event.preventDefault();const adapted=touchAsLeafletEvent(event);if(adapted)extendLasso(adapted);},{passive:false});
  canvas.addEventListener('touchend',event=>{if(!lassoMode||!lassoDrawing)return;event.preventDefault();const adapted=touchAsLeafletEvent(event,true);if(adapted)finishLasso(adapted);},{passive:false});
  canvas.addEventListener('touchcancel',event=>{if(!lassoMode)return;event.preventDefault();lassoDrawing=false;if(lassoPreview){map.removeLayer(lassoPreview);lassoPreview=null;}lassoPoints=[];lastLassoPoint=null;lassoStartPoint=null;updateSelectionStatus('Lasso is still active — drag your finger around the leads');},{passive:false});

  async function geocodeStatus(){if(window.MCCOY_ACCESS?.access?.role!=='admin'){document.getElementById('geocodeRealLeadsBtn').style.display='none';document.getElementById('geocodeProgress').textContent='Lead coordinates are managed by Admin.';return null;}try{const {data,error}=await sb.functions.invoke('lead-geocode',{body:{action:'status'}});if(error)throw error;const btn=document.getElementById('geocodeRealLeadsBtn');btn.dataset.googleConfigured=data.google_configured?'1':'0';btn.disabled=!data.google_configured;document.getElementById('geocodeProgress').textContent=data.google_configured?`${Number(data.google_verified||0).toLocaleString()} Google verified · ${Number(data.preserved||0).toLocaleString()} trusted pins compared · ${Number(data.review||0).toLocaleString()} need review · ${Number(data.pending||0).toLocaleString()} pending · ${Number(data.unmapped||0).toLocaleString()} safely unmapped.`:'Google verification is unavailable until Admin configures the server-only Maps API key.';return data;}catch(e){console.error(e);document.getElementById('geocodeProgress').textContent='Unable to read Google verification status.';return null;}}
  async function geocodeAll(){const btn=document.getElementById('geocodeRealLeadsBtn');if(window.MCCOY_ACCESS?.access?.role!=='admin')return;if(!window.confirm('Verify up to 25 Lead Pool addresses with Google? Google Maps Platform usage charges may apply.'))return;btn.disabled=true;btn.textContent='VERIFYING 25…';try{const {data,error}=await sb.functions.invoke('lead-geocode',{body:{action:'verify_next',limit:25}});if(error||!data?.ok)throw error||new Error(data?.detail||data?.error||'google_verification_failed');document.getElementById('geocodeProgress').textContent=`Compared ${Number(data.processed||0).toLocaleString()} · applied ${Number(data.applied||0).toLocaleString()} rooftop pins · preserved ${Number(data.preserved||0).toLocaleString()} trusted pins · ${Number(data.review||0).toLocaleString()} need review · ${Number(data.pending||0).toLocaleString()} pending.`;await window.loadMcCoyLeads?.();setTimeout(()=>renderPins(true),250);}catch(e){console.error(e);document.getElementById('geocodeProgress').textContent=e?.message?.includes('google_maps_key_not_configured')?'Google verification is unavailable until Admin configures the server-only Maps API key.':'Google verification stopped safely; no approximate result was applied.';}btn.textContent='VERIFY NEXT 25 WITH GOOGLE';await geocodeStatus();restoreGrabCursor();}
  async function assignSelectedLeads(){const msg=document.getElementById('mapAssignMsg');if(!['admin','manager','trainer'].includes(window.MCCOY_ACCESS?.access?.role)){msg.textContent='Only Managers, Trainers, and Administrators can assign real leads.';restoreGrabCursor();return;}if(!selectedIds.size){msg.textContent='Select one or more leads first.';restoreGrabCursor();return;}const repEmail=document.getElementById('mapRepSelect').value,ids=[...selectedIds];msg.textContent=`Assigning ${ids.length.toLocaleString()} selected lead${ids.length===1?'':'s'}…`;try{for(let i=0;i<ids.length;i+=500){const {data,error}=await sb.functions.invoke('lead-admin',{body:{action:'assign_leads',lead_ids:ids.slice(i,i+500),rep_email:repEmail}});if(error||!data?.ok)throw error||new Error(data?.detail||data?.error||'bulk_assign_failed');}msg.textContent=`${ids.length.toLocaleString()} selected lead${ids.length===1?'':'s'} assigned successfully.`;selectedIds.clear();clearLassoShape();if(correctionMarker){map.removeLayer(correctionMarker);correctionMarker=null;}await window.loadMcCoyLeads?.();setTimeout(()=>renderPins(false),250);}catch(e){console.error(e);msg.textContent=`Assignment failed${e?.message?': '+e.message:''}.`;}finally{restoreGrabCursor();}}

  document.getElementById('geocodeRealLeadsBtn').onclick=geocodeAll;
  document.getElementById('fitAllPinsBtn').onclick=()=>{restoreGrabCursor();renderPins(true);};
  document.getElementById('lassoSelectBtn').onclick=()=>setLassoMode(!lassoMode);
  document.getElementById('clearMapSelectionBtn').onclick=clearSelection;
  document.getElementById('selectVisiblePinsBtn').onclick=selectVisible;
  document.getElementById('bulkAssignMapBtn').onclick=assignSelectedLeads;
  document.getElementById('saveLeadAddressBtn').onclick=saveAddress;
  document.getElementById('moveLeadPinBtn').onclick=startMovePin;
  document.getElementById('confirmLeadPinBtn').onclick=confirmMovePin;
  document.getElementById('cancelLeadPinBtn').onclick=()=>endMovePin('Pin movement cancelled. The original location was kept.');
  document.getElementById('keepOriginalPinBtn').onclick=()=>endMovePin('Original pin location kept.');
  document.getElementById('teamFilter')?.addEventListener('change',()=>{selectedIds.clear();clearLassoShape();restoreGrabCursor();setTimeout(()=>renderPins(true),0);});
  document.getElementById('leadOwnerFilter')?.addEventListener('change',()=>{selectedIds.clear();clearLassoShape();restoreGrabCursor();setTimeout(()=>renderPins(true),0);});
  document.getElementById('leadSearch')?.addEventListener('input',()=>{selectedIds.clear();clearLassoShape();restoreGrabCursor();clearTimeout(searchRenderTimer);searchRenderTimer=setTimeout(()=>renderPins(true),160);});
  window.addEventListener('mccoy-real-leads-loaded',()=>setTimeout(()=>{restoreGrabCursor();renderPins(true);geocodeStatus();},200));
  const obs=new MutationObserver(()=>{if(panel.style.display!=='none')setTimeout(()=>{map.invalidateSize();restoreGrabCursor();renderPins(firstFit);},50);});obs.observe(panel,{attributes:true,attributeFilter:['style']});
  // The panel-visibility MutationObserver above only fires on a DOM change to
  // this panel's own style attribute -- it never fires just because the OS
  // backgrounds and later foregrounds the whole app, since nothing in the DOM
  // itself changes during that transition. Leaflet still needs an explicit
  // invalidateSize() whenever it becomes visible again after being backgrounded,
  // the same as it does after any other visibility change; without this, the
  // map can sit incorrectly sized until something else happens to touch the
  // panel's style, which is why switching to another app and back "fixes" it
  // immediately (a real visibilitychange fires) while just waiting does not.
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden||panel.style.display==='none')return;
    setTimeout(()=>{map.invalidateSize({pan:false});restoreGrabCursor();renderPins(false);},50);
  });
  setTimeout(()=>{map.setView([39.5,-98.35],4);restoreGrabCursor();renderPins(true);geocodeStatus();},800);
})();
