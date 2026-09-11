// Independent Lead Pool activity, nearest-pin focus, map knocking, and phone-sale address search.
(function(){
  if(window.MCCOY_LEAD_POOL_INDEPENDENT_ACTIVITY)return;
  window.MCCOY_LEAD_POOL_INDEPENDENT_ACTIVITY=true;

  const byId=id=>document.getElementById(id);
  const QUARTER_MILE_METERS=402.336;
  let selectedLeadId=null;
  let manualSelectedLeadId=null;
  let manualViewportHold=false;
  let saveBusy=false;
  let pendingSaveRequestId=null;
  let visitTimerStartedAt=null;
  let visitTimerStoppedAt=null;
  let visitTimerHandle=null;
  let phoneContext=null;
  let phoneSearchBusy=false;
  let addressRevision=0;
  let phoneSearchMarker=null;
  let autoSelectTimer=null;

  function uuid(){
    if(typeof crypto?.randomUUID==='function')return crypto.randomUUID();
    return'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,char=>{const random=Math.random()*16|0,value=char==='x'?random:(random&3|8);return value.toString(16);});
  }
  function leadByAnyId(id){
    const raw=String(id??'');
    return(state.realLeads||[]).find(lead=>String(lead.id)===raw||String(lead.dbId)===raw)||null;
  }
  function leadAddress(lead){
    return lead?.fullAddress||[[lead?.address1||lead?.address,lead?.address2].filter(Boolean).join(' '),lead?.city,[lead?.stateCode||lead?.state,lead?.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  }
  function compact(value){return String(value||'').trim().toLowerCase().replace(/[^a-z0-9]/g,'');}
  function currentSessionId(){
    try{if(typeof telemetrySessionId!=='undefined'&&telemetrySessionId)return telemetrySessionId;}catch(_){}
    return null;
  }
  function validPoint(value){
    if((value?.latitude??value?.lat)==null||(value?.longitude??value?.lng)==null)return null;
    const latitude=Number(value?.latitude??value?.lat),longitude=Number(value?.longitude??value?.lng);
    return Number.isFinite(latitude)&&latitude>=-90&&latitude<=90&&Number.isFinite(longitude)&&longitude>=-180&&longitude<=180?{latitude,longitude}:null;
  }
  function currentGps(){
    const gps=typeof snapshotGpsInstant==='function'?snapshotGpsInstant():(state.latestGps||null);
    return validPoint(gps)?gps:null;
  }
  function gpsRpc(gps){
    const point=validPoint(gps),accuracy=Number(gps?.accuracy),capturedAt=Number(gps?.capturedAt);
    return{
      p_latitude:point?.latitude??null,
      p_longitude:point?.longitude??null,
      p_accuracy_meters:Number.isFinite(accuracy)&&accuracy>=0?accuracy:null,
      p_gps_captured_at:Number.isFinite(capturedAt)&&capturedAt>0?new Date(capturedAt).toISOString():null
    };
  }
  function mapVisible(){
    const leads=byId('leads'),panel=byId('leadMapPanel');
    return Boolean(leads?.classList.contains('active')&&panel&&panel.style.display!=='none');
  }
  function setMessage(text,error=false){
    const message=byId('mapPinDispositionMsg');
    if(message){message.textContent=text;message.style.color=error?'#991b1b':'#166534';}
  }
  function updateLocalLead(lead,data){
    if(!lead||!data)return;
    lead.disposition=data.effective_disposition||data.lead?.current_disposition||lead.disposition;
    lead.lastActivityType=data.activity_type||data.lead?.last_activity_type||lead.lastActivityType;
    lead.visitResult=data.visit_result||data.lead?.visit_result||lead.visitResult;
    lead.stage=data.stage||data.lead?.stage||lead.stage;
    lead.pinColor=data.pin_color||data.lead?.pin_color||lead.pinColor;
    lead.pinColorSource=data.pin_color_source||data.lead?.pin_color_source||lead.pinColorSource;
    lead.pinDisposition=data.effective_disposition||lead.stage||lead.visitResult||lead.disposition;
  }
  function timerElapsedMs(){
    if(!visitTimerStartedAt)return 0;
    return Math.max(0,(visitTimerStoppedAt||Date.now())-visitTimerStartedAt);
  }
  function formatTimer(){
    const seconds=Math.floor(timerElapsedMs()/1000),minutes=Math.floor(seconds/60),remaining=seconds%60;
    return`${String(minutes).padStart(2,'0')}:${String(remaining).padStart(2,'0')}`;
  }
  function renderTimer(){
    const value=byId('mapVisitTimerValue'),button=byId('mapVisitTimerBtn'),activity=byId('mapLeadActivityType')?.value;
    const enabled=activity==='Visit',panel=byId('mapVisitTimerPanel');
    if(panel)panel.hidden=!enabled;
    if(value)value.textContent=formatTimer();
    if(button){
      button.disabled=!enabled;
      button.textContent=!visitTimerStartedAt?'START VISIT TIMER':visitTimerStoppedAt?'RESTART VISIT TIMER':'STOP VISIT TIMER';
    }
  }
  function stopTimerLoop(){if(visitTimerHandle){clearInterval(visitTimerHandle);visitTimerHandle=null;}}
  function resetVisitTimer(){visitTimerStartedAt=null;visitTimerStoppedAt=null;stopTimerLoop();renderTimer();}
  function toggleVisitTimer(){
    if(byId('mapLeadActivityType')?.value!=='Visit'){setMessage('Dwell timing is available only for a Visit.',true);return;}
    if(!visitTimerStartedAt||visitTimerStoppedAt){
      visitTimerStartedAt=Date.now();visitTimerStoppedAt=null;stopTimerLoop();visitTimerHandle=setInterval(renderTimer,250);setMessage('Visit timer started. SAVE PIN DISPOSITION will retain this dwell time and occurred-at timestamp.');
    }else{
      visitTimerStoppedAt=Date.now();stopTimerLoop();setMessage(`Visit timer stopped at ${formatTimer()}. Save when ready.`);
    }
    renderTimer();
  }
  function ensureTimerPanel(grid){
    let panel=byId('mapVisitTimerPanel');
    if(panel)return panel;
    panel=document.createElement('div');panel.id='mapVisitTimerPanel';panel.style.cssText='display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:9px 0;padding:8px;border:1px solid #dbe4f0;border-radius:9px;background:#f8fafc';
    panel.innerHTML='<button id="mapVisitTimerBtn" type="button" class="assign-btn">START VISIT TIMER</button><strong id="mapVisitTimerValue" style="font-variant-numeric:tabular-nums">00:00</strong><span class="muted small">Optional. Without the timer, the activity is saved with its occurred-at timestamp and zero dwell.</span>';
    grid.insertAdjacentElement('afterend',panel);return panel;
  }
  function explicitSaleContext({lead=null,address=null,point=null,source='lead_pool_phone'}={}){
    const serviceAddress=String(address||leadAddress(lead)||'').trim();
    return{
      sale_context:'out_of_area_phone',
      session_id:currentSessionId(),
      lead_id:lead?.dbId||lead?.id||null,
      lead_label:lead?.address||serviceAddress,
      service_address:serviceAddress,
      customer_map_location:validPoint(point||lead),
      source,
      selection_source:source,
      source_door_visit_id:null,
      preserve_active_visit:true
    };
  }
  function startExplicitSale(context){
    if(!context?.service_address){setMessage('Enter or select a complete customer address first.',true);return;}
    try{
      if(typeof window.MCCOY_START_EXPLICIT_SALE!=='function')throw new Error('Sale controls are still loading. Please retry.');
      window.MCCOY_START_EXPLICIT_SALE(context);
    }catch(error){
      console.error('Explicit Lead Pool sale failed',error);
      const message=String(error?.message||'Could not start this sale. Please retry.');
      setMessage(message,true);phoneMessage(message,true);
    }
  }

  async function saveIndependentDisposition(lead){
    if(saveBusy)return;
    if(!state.session||!currentSessionId()){setMessage('Start a field session before saving Lead Pool activity.',true);byId('startKnockingBtn')?.focus();return;}
    const current=leadByAnyId(lead?.dbId||lead?.id);
    if(!current){setMessage('This pin is no longer available. Refreshing the Lead Pool…',true);await window.loadMcCoyLeads?.();return;}
    const activityType=byId('mapLeadActivityType')?.value,visitResult=byId('mapLeadVisitResult')?.value,stage=byId('mapLeadStage')?.value||null;
    if(!activityType||!visitResult){setMessage('Choose both Activity Type and Visit Result.',true);return;}
    if(stage==='Sale Made'){startExplicitSale(explicitSaleContext({lead:current,source:'lead_pool_sale_made'}));return;}

    const requestId=pendingSaveRequestId||uuid();pendingSaveRequestId=requestId;
    const save=byId('mapPinSaveBtn');saveBusy=true;if(save){save.disabled=true;save.textContent='SAVING…';}
    const occurredAt=visitTimerStartedAt||Date.now(),dwellSeconds=activityType==='Visit'?Math.floor(timerElapsedMs()/1000):0,gps=currentGps();
    setMessage('Saving independent Lead Pool activity…');
    try{
      const{data,error}=await sb.rpc('record_lead_pool_pin_disposition',{
        p_session_id:currentSessionId(),p_lead_id:current.dbId,p_client_request_id:requestId,
        p_activity_type:activityType,p_visit_result:visitResult,p_stage:stage,
        p_occurred_at:new Date(occurredAt).toISOString(),p_dwell_seconds:dwellSeconds,...gpsRpc(gps)
      });
      if(error||!data?.ok)throw error||new Error(data?.error||'lead_pool_disposition_failed');
      updateLocalLead(current,data);pendingSaveRequestId=null;resetVisitTimer();
      setMessage(`${data.duplicate?'Already saved':'Saved'} ${data.effective_disposition||visitResult} for ${current.address}. The Sales Hub activity was left unchanged.`);
      window.MCCOY_RENDER_LEAD_MAP?.(false);window.MCCOY_APPLY_DISPOSITION_COLORS?.();
      window.dispatchEvent(new CustomEvent('mccoy-lead-pool-disposition-saved',{detail:{leadId:current.dbId,visitId:data.visit_id,occurredAt:data.occurred_at,dwellSeconds:data.dwell_seconds,duplicate:Boolean(data.duplicate)}}));
      setTimeout(()=>window.loadMcCoyLeads?.(),150);
    }catch(error){
      const detail=String(error?.message||error||'').replace(/_/g,' ');
      console.error('Lead Pool independent disposition failed',error);
      if(/lead not available/i.test(detail)){selectedLeadId=null;manualSelectedLeadId=null;setMessage('This pin was deleted while it was open. The Lead Pool is refreshing.',true);setTimeout(()=>window.loadMcCoyLeads?.(),0);}
      else setMessage(detail||'Disposition could not be saved. Retry uses the same request ID so it cannot create a duplicate.',true);
    }finally{saveBusy=false;if(save){save.disabled=false;save.textContent='SAVE PIN DISPOSITION';}}
  }
  async function startMapKnock(lead){
    const current=leadByAnyId(lead?.dbId||lead?.id);
    if(!current){setMessage('This pin is no longer available.',true);return;}
    if(!state.session||!currentSessionId()){setMessage('Start a field session before knocking from the map.',true);return;}
    const active=state.activeDoorVisit;
    if(active){
      if(String(active.lead?.dbId||'')===String(current.dbId||''))setMessage('This lead is already the active physical-door activity.');
      else setMessage('Finish or correct the current physical-door activity before starting another knock. Pin dispositions and phone sales remain available.',true);
      return;
    }
    let gps=currentGps();
    if(typeof getGPSOnce==='function'){
      try{gps=await Promise.race([getGPSOnce(),new Promise(resolve=>setTimeout(()=>resolve(gps),4000))])||gps;if(gps)state.latestGps=gps;}catch(_){}
    }
    const point=validPoint(gps),leadPoint=validPoint(current),core=window.MCCOY_DOOR_WORKFLOW_CORE;
    const distance=point&&leadPoint?core?.metersBetween?.({lat:point.latitude,lng:point.longitude},{lat:leadPoint.latitude,lng:leadPoint.longitude}):null;
    if(!Number.isFinite(distance)){setMessage('A current GPS fix and mapped lead location are required to start a physical knock from the map. You can still save a disposition or process a phone sale.',true);return;}
    if(distance>QUARTER_MILE_METERS){setMessage(`This lead is ${Math.round(distance).toLocaleString()} m away. Map knocking requires being within one-quarter mile; remote disposition and phone-sale controls remain available.`,true);return;}
    window.MCCOY_LEAD_ADDRESS?.setLead?.(current,'lead_pool_map_knock');
    setMessage('Starting this physical-door activity from the Lead Pool map…');
    const ok=await window.MCCOY_START_DOOR_VISIT?.({automatic:false});
    setMessage(ok?`Physical-door activity started for ${current.address}.`:'The physical-door activity could not be started. Review the Sales Hub status.',!ok);
  }
  async function deleteLead(lead){
    const button=byId('mapDeleteLeadBtn');if(button)button.disabled=true;
    const removed=await window.MCCOY_DELETE_LEAD?.(lead);
    if(removed){selectedLeadId=null;manualSelectedLeadId=null;manualViewportHold=false;resetVisitTimer();const detail=byId('mapLeadDetail');if(detail)detail.innerHTML='<div class="muted small">Lead deleted. Choose another pin or type a sale address.</div>';scheduleAutoSelect(100);}
    else if(button)button.disabled=false;
  }
  function configureDetail(lead){
    if(!lead)return;
    const detail=byId('mapLeadDetail'),grid=detail?.querySelector('.map-pin-disposition-grid'),actions=detail?.querySelector('.map-pin-disposition-actions');
    if(!detail||!grid||!actions)return false;
    if(detail.dataset.independentLeadId===String(lead.dbId||lead.id))return true;
    detail.dataset.independentLeadId=String(lead.dbId||lead.id);
    ensureTimerPanel(grid);
    actions.innerHTML='<button id="mapPinKnockBtn" type="button" class="assign-btn">KNOCK THIS LEAD</button><button id="mapPinSaveBtn" type="button" class="primary">SAVE PIN DISPOSITION</button><button id="mapPinSaleBtn" type="button" class="success">PROCESS PHONE SALE</button><button id="mapDeleteLeadBtn" type="button" class="danger">DELETE LEAD</button>';
    const message=byId('mapPinDispositionMsg');if(message)message.textContent='SAVE records this pin immediately without replacing the active Sales Hub door. KNOCK THIS LEAD keeps the one-quarter-mile physical-knock rule.';
    byId('mapPinSaveBtn')?.addEventListener('click',()=>saveIndependentDisposition(lead));
    byId('mapPinKnockBtn')?.addEventListener('click',()=>startMapKnock(lead));
    byId('mapPinSaleBtn')?.addEventListener('click',()=>startExplicitSale(explicitSaleContext({lead,source:'lead_pool_selected_pin_phone_sale'})));
    byId('mapDeleteLeadBtn')?.addEventListener('click',()=>deleteLead(lead));
    byId('mapVisitTimerBtn')?.addEventListener('click',toggleVisitTimer);
    byId('mapLeadActivityType')?.addEventListener('change',()=>{if(byId('mapLeadActivityType')?.value!=='Visit')resetVisitTimer();else renderTimer();});
    renderTimer();return true;
  }
  function configureSelectedDetail(attempt=0){
    const lead=leadByAnyId(selectedLeadId);if(!lead)return;
    if(!configureDetail(lead)&&attempt<8)setTimeout(()=>configureSelectedDetail(attempt+1),60+attempt*40);
  }
  function focusLead(lead,{source='manual',center=true,zoom=17}={}){
    if(!lead)return;
    const nextId=lead.dbId||lead.id;
    if(window.MCCOY_MAP_VIEWPORT_LOCK?.blocksSelection?.(nextId))return;
    selectedLeadId=nextId;
    if(source!=='auto_nearest'){manualSelectedLeadId=selectedLeadId;manualViewportHold=false;}
    window.dispatchEvent(new CustomEvent('mccoy-map-lead-selected',{detail:{leadId:selectedLeadId,source}}));
    const point=validPoint(lead),map=window.MCCOY_LEAD_MAP?.map;
    if(center&&point&&map)map.setView([point.latitude,point.longitude],Math.max(Number(map.getZoom?.()||0),zoom),{animate:false});
    setTimeout(configureSelectedDetail,0);
  }
  function nearestVisibleLead(){
    const gps=validPoint(state.latestGps);if(!gps)return null;
    const core=window.MCCOY_DOOR_WORKFLOW_CORE;let nearest=null;
    for(const lead of state.realLeads||[]){
      if(window.MCCOY_LEAD_MATCHES_FILTER&&!window.MCCOY_LEAD_MATCHES_FILTER(lead))continue;
      const point=validPoint(lead);if(!point)continue;
      const distance=core?.metersBetween?.({lat:gps.latitude,lng:gps.longitude},{lat:point.latitude,lng:point.longitude});
      if(!Number.isFinite(distance))continue;
      if(!nearest||distance<nearest.distance)nearest={lead,distance};
    }
    return nearest;
  }
  const autoNearestEnabled=()=>window.MCCOY_FIELD_FEATURES?.automaticNearestLead===true;
  function autoSelectNearest(){
    if(!autoNearestEnabled())return;
    if(window.MCCOY_MAP_VIEWPORT_LOCK?.owner?.()==='move-pin')return;
    if(manualViewportHold||!mapVisible()||manualSelectedLeadId||phoneContext)return;
    const nearest=nearestVisibleLead();if(!nearest)return;
    if(String(selectedLeadId||'')===String(nearest.lead.dbId||nearest.lead.id))return;
    focusLead(nearest.lead,{source:'auto_nearest',center:true,zoom:16});
    setTimeout(()=>setMessage(`Nearest mapped lead auto-selected · ${Math.round(nearest.distance).toLocaleString()} m away. Select any other pin to hold that selection.`),80);
  }
  function scheduleAutoSelect(delay=150){
    clearTimeout(autoSelectTimer);
    if(!autoNearestEnabled())return;
    if(manualViewportHold||window.MCCOY_MAP_VIEWPORT_LOCK?.owner?.()==='move-pin')return;
    autoSelectTimer=setTimeout(autoSelectNearest,delay);
  }

  function ensurePhoneSearch(){
    const controls=byId('leadGeoControls');if(!controls||byId('leadPoolPhoneSaleSearch'))return false;
    const panel=document.createElement('div');panel.id='leadPoolPhoneSaleSearch';panel.style.cssText='margin-top:10px;padding-top:10px;border-top:1px solid #dbe4f0';
    panel.innerHTML='<strong>Sale for any address</strong><div class="muted small" style="margin:3px 0 7px">Enter the full service address, including unit, city, state and ZIP. You can process a sale without a map pin.</div><div style="display:flex;flex-wrap:wrap;gap:7px"><input id="leadPoolPhoneAddress" aria-label="Sale service address" maxlength="240" list="leadPoolPhoneAddressOptions" autocomplete="street-address" placeholder="Customer service address" style="flex:1 1 240px;min-width:0;min-height:44px;padding:9px;border:1px solid #cbd5e1;border-radius:8px"><datalist id="leadPoolPhoneAddressOptions"></datalist><button id="leadPoolCenterAddressBtn" type="button" class="assign-btn">CENTER MAP (OPTIONAL)</button><button id="leadPoolPhoneSaleBtn" type="button" class="success" disabled>PROCESS SALE</button></div><div id="leadPoolPhoneAddressMsg" class="muted small" role="status" aria-live="polite" style="margin-top:6px">Type an address and process the sale. Centering the map and adding a pin are optional.</div>';
    controls.appendChild(panel);
    byId('leadPoolCenterAddressBtn').addEventListener('click',searchPhoneAddress);
    byId('leadPoolPhoneSaleBtn').addEventListener('click',()=>{updateAddressIntent();if(phoneContext)startExplicitSale({...phoneContext});});
    byId('leadPoolPhoneAddress').addEventListener('input',()=>{addressRevision++;removePhoneMarker();updateAddressIntent();});
    refreshPhoneOptions();return true;
  }
  function refreshPhoneOptions(){
    const list=byId('leadPoolPhoneAddressOptions');if(!list)return;
    const options=(state.realLeads||[]).slice(0,1000).map(lead=>{const option=document.createElement('option');option.value=leadAddress(lead);return option;});
    list.replaceChildren(...options);
  }
  function phoneMessage(text,error=false){const el=byId('leadPoolPhoneAddressMsg');if(el){el.textContent=text;el.style.color=error?'#991b1b':'';}}
  function removePhoneMarker(){
    if(phoneSearchMarker&&window.MCCOY_LEAD_MAP?.map){try{window.MCCOY_LEAD_MAP.map.removeLayer(phoneSearchMarker);}catch(_){} }
    phoneSearchMarker=null;
  }
  function localAddressMatch(address){
    const matches=window.MCCOY_LEAD_ADDRESS_CORE?.matchingLeads(address,state.realLeads||[])||[];
    return matches.length===1?matches[0]:null;
  }
  function updateAddressIntent(){
    const address=String(byId('leadPoolPhoneAddress')?.value||'').trim();
    const lead=localAddressMatch(address);
    phoneContext=address.length>=5?{
      ...explicitSaleContext({lead,address,source:'lead_pool_address_sale'}),sale_context:'field'
    }:null;
    byId('leadPoolPhoneSaleBtn').disabled=!phoneContext;
    phoneMessage(phoneContext?'Ready to process this address. Centering the map and adding a pin are optional.':'Enter a complete service address.');
    return phoneContext;
  }
  function applyPhoneSearchResult(data,address){
    removePhoneMarker();
    const matchedLead=localAddressMatch(address);
    const center=validPoint(data?.center)||validPoint(data?.geocoded_center)||validPoint(matchedLead);
    const serviceAddress=address;
    updateAddressIntent();
    manualSelectedLeadId=matchedLead?.dbId||matchedLead?.id||'phone_address';manualViewportHold=false;
    byId('leadPoolPhoneSaleBtn').disabled=false;
    if(matchedLead)focusLead(matchedLead,{source:'address_search',center:true,zoom:18});
    else if(center&&window.MCCOY_LEAD_MAP?.map){
      const map=window.MCCOY_LEAD_MAP.map;map.setView([center.latitude,center.longitude],18,{animate:false});
      if(window.L){phoneSearchMarker=window.L.marker([center.latitude,center.longitude],{title:serviceAddress}).addTo(map).bindTooltip('Sale address',{direction:'top'}).openTooltip();}
    }
    phoneMessage(matchedLead?`Matching McCoy lead selected: ${leadAddress(matchedLead)}. Completing the sale will update this pin.`:`Map centered on ${serviceAddress}. No exact McCoy lead matched; the typed address will be used for the sale.`);
  }
  async function searchPhoneAddress(){
    if(phoneSearchBusy)return;
    const input=byId('leadPoolPhoneAddress'),address=String(input?.value||'').trim(),revision=addressRevision;
    const accessKey=()=>`${window.MCCOY_ACCESS?.user?.id||''}:${window.MCCOY_ACCESS?.access?.organization_id||''}`;
    const owner=accessKey(),stillCurrent=()=>revision===addressRevision&&input.value.trim()===address&&owner===accessKey();
    if(address.length<5){phoneMessage('Enter a complete customer service address.',true);return;}
    updateAddressIntent();
    const local=localAddressMatch(address);
    if(local){applyPhoneSearchResult({lead:{id:local.dbId},service_address:leadAddress(local),center:validPoint(local)},address);return;}
    phoneSearchBusy=true;const button=byId('leadPoolCenterAddressBtn');button.disabled=true;button.textContent='SEARCHING…';phoneMessage('Finding this address and checking for a matching McCoy lead…');
    try{
      const{data,error}=await sb.functions.invoke('lead-map-address-search',{body:{address}});
      if(!stillCurrent())return;
      if(error||!data?.ok)throw error||new Error(data?.detail||data?.error||'address_search_failed');
      applyPhoneSearchResult(data,address);
    }catch(error){
      if(!stillCurrent())return;
      console.error('Lead Pool address search failed',error);
      updateAddressIntent();
      phoneMessage('Map lookup is unavailable. You can still process the sale for the address you entered.',true);
    }finally{phoneSearchBusy=false;button.disabled=false;button.textContent='CENTER MAP (OPTIONAL)';}
  }

  window.addEventListener('mccoy-map-lead-selected',event=>{
    const id=event.detail?.leadId,source=event.detail?.source||'manual';if(!id)return;
    if(window.MCCOY_MAP_VIEWPORT_LOCK?.blocksSelection?.(id))return;
    selectedLeadId=id;if(source!=='auto_nearest'){manualSelectedLeadId=id;manualViewportHold=false;}
    resetVisitTimer();setTimeout(configureSelectedDetail,0);
  });
  window.addEventListener('mccoy-gps-update',()=>scheduleAutoSelect(250));
  window.addEventListener('mccoy-map-viewport-lock-changed',event=>{
    if(event.detail?.owner==='move-pin'&&event.detail?.locked){clearTimeout(autoSelectTimer);return;}
    if(!event.detail?.locked)scheduleAutoSelect(250);
  });
  window.addEventListener('mccoy-real-leads-loaded',()=>{
    ensurePhoneSearch();refreshPhoneOptions();
    if(selectedLeadId&&!leadByAnyId(selectedLeadId)){
      selectedLeadId=null;manualSelectedLeadId=null;manualViewportHold=false;resetVisitTimer();const detail=byId('mapLeadDetail');if(detail)detail.innerHTML='<div class="muted small">The selected lead was removed. Choose another pin or type a sale address.</div>';
    }else if(selectedLeadId)configureSelectedDetail();
    scheduleAutoSelect(150);
  });
  window.addEventListener('mccoy-lead-owners-updated',()=>{if(selectedLeadId)setTimeout(configureSelectedDetail,0);});
  window.addEventListener('mccoy-door-visit-started',()=>{if(selectedLeadId)setTimeout(configureSelectedDetail,0);});
  window.addEventListener('mccoy-door-visit-completed',()=>{if(selectedLeadId)setTimeout(configureSelectedDetail,0);});
  document.addEventListener('click',event=>{
    const pick=event.target.closest?.('.map-pick');if(pick?.dataset?.id&&!window.MCCOY_MAP_VIEWPORT_LOCK?.blocksSelection?.(pick.dataset.id)){selectedLeadId=pick.dataset.id;manualSelectedLeadId=pick.dataset.id;manualViewportHold=false;setTimeout(configureSelectedDetail,60);}
    if(event.target.closest?.('#clearMapSelectionBtn')){setTimeout(()=>{if(window.MCCOY_MAP_VIEWPORT_LOCK?.owner?.()==='move-pin')return;clearTimeout(autoSelectTimer);selectedLeadId=null;manualSelectedLeadId=null;manualViewportHold=true;phoneContext=null;removePhoneMarker();resetVisitTimer();},0);}
    if(event.target.closest?.('.nav-btn[data-view="leads"],#leadMapView'))setTimeout(()=>{manualViewportHold=false;ensurePhoneSearch();scheduleAutoSelect(180);},60);
  },true);
  window.addEventListener('beforeunload',()=>{stopTimerLoop();clearTimeout(autoSelectTimer);});

  [0,250,800,1600,2600].forEach(delay=>setTimeout(()=>{ensurePhoneSearch();refreshPhoneOptions();if(selectedLeadId)configureSelectedDetail();scheduleAutoSelect(100);},delay));
})();
