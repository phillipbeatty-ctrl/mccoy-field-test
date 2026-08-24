// Distance to Lead: automatic nearest-lead selection, resumable visits, and
// conservative dwell/location-based automatic dispositions.
(function(){
  if(window.MCCOY_DISTANCE_TO_LEAD_CONTROL)return;
  const core=window.MCCOY_DOOR_WORKFLOW_CORE,select=document.getElementById('fieldLeadSelect');
  if(!core||!select)return;
  const panel=document.getElementById('closestDoorAddress')||document.createElement('div');
  if(!panel.id){panel.id='closestDoorAddress';select.insertAdjacentElement('beforebegin',panel);}
  panel.className='geo-box distance-to-lead';panel.setAttribute('role','group');panel.setAttribute('aria-label','Distance to Lead');
  panel.style.cssText='margin:0 0 10px;border-color:#93c5fd;background:#eff6ff;color:#172554;display:grid;gap:8px';
  panel.innerHTML='<div style="display:flex;justify-content:space-between;gap:10px;align-items:center"><strong>DISTANCE TO LEAD</strong><span id="distanceLeadMode" style="font-size:11px;font-weight:900;padding:3px 7px;border-radius:999px;background:#dbeafe">AUTO</span></div>'
    +'<div id="distanceLeadStatus">Waiting for a current location and assigned leads…</div>'
    +'<div style="display:flex;gap:8px;flex-wrap:wrap"><button id="useClosestLeadBtn" type="button" class="assign-btn">USE CLOSEST LEAD</button><button id="correctDoorLeadBtn" type="button" class="assign-btn" hidden>CORRECT LEAD</button></div>'
    +'<label id="outsideSaleAddressWrap" hidden style="display:grid;gap:5px;font-size:12px;font-weight:800">Service address for an out-of-area SALE<input id="outsideSaleAddress" autocomplete="street-address" placeholder="Required unless supplied by provider" style="padding:10px;border:1px solid #93c5fd;border-radius:8px;background:#fff"></label>'
    +'<div id="distanceLeadRule" class="muted small">Assigned leads enforce the ¼-mile rule. Typed ad-hoc addresses can be dispositioned inside or outside assigned areas with fresh GPS retained for audit. Completed sales are allowed at any distance.</div>';

  let manualLeadLocked=false,autoChanging=false,lastNearest=null,lastState=null,providerAddress='';
  let arrivalCandidate=null,arrivalHits=0,departureCandidate=null,departureHits=0,resumeAttempted=false;
  const byId=id=>document.getElementById(id);
  const label=lead=>lead?.fullAddress||[lead?.address,lead?.city,[lead?.stateCode,lead?.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')||'Selected lead';
  const formatDistance=meters=>{const feet=Number(meters)*3.28084;return feet<1000?`${Math.round(feet)} ft`:`${(feet/5280).toFixed(2)} mi`;};
  const selectedLead=()=>{const value=String(select.value||'');return(state.leads||[]).find(lead=>String(lead.id)===value||String(lead.dbId)===value)||state.activeDoorVisit?.lead||null;};
  const addressContext=()=>window.MCCOY_LEAD_ADDRESS?.current?.()||{kind:'empty',address:'',lead:null,valid:false};
  function ensureOption(lead){if(!lead)return;let option=[...select.options].find(item=>item.value===String(lead.id));if(!option){option=new Option(label(lead),String(lead.id));select.add(option);}}
  function chooseLead(lead,automatic=true){if(!lead)return;ensureOption(lead);autoChanging=true;select.value=String(lead.id);select.dispatchEvent(new Event('change',{bubbles:true}));autoChanging=false;if(automatic)manualLeadLocked=false;}
  function activeCapture(){const capture=window.MCCOY_ACTIVE_PROVIDER_CAPTURE;return capture&&['dashboard_opened','details_required'].includes(capture.status)?capture:null;}
  function resetArrival(){arrivalCandidate=null;arrivalHits=0;}
  function resetDeparture(){departureCandidate=null;departureHits=0;}

  function calculate(){
    const gps=state.latestGps||null,nearest=core.nearestLead(state.leads||[],gps);
    const typed=!state.activeDoorVisit&&addressContext().kind==='typed'?addressContext():null;
    if(!manualLeadLocked&&!typed&&!state.activeDoorVisit){
      if(nearest&&nearest.distance<=core.QUARTER_MILE_METERS){if(String(select.value)!==String(nearest.lead.id))chooseLead(nearest.lead,true);}
      else if(select.value){autoChanging=true;select.value='';select.dispatchEvent(new Event('change',{bubbles:true}));autoChanging=false;}
    }
    if(typed){lastNearest=nearest;lastState={withinRange:false,distance:null,reason:'typed_address',lead:null,nearest,typed:true,address:typed.address,selectionSource:'typed_address'};return lastState;}
    const current=selectedLead(),distance=core.distanceState(current,gps);
    lastNearest=nearest;lastState={...distance,lead:current,nearest};
    return lastState;
  }

  function render(){
    const current=calculate(),mode=byId('distanceLeadMode'),status=byId('distanceLeadStatus'),manualWrap=byId('outsideSaleAddressWrap'),correct=byId('correctDoorLeadBtn');
    if(mode){mode.textContent=current.typed?'TYPED':manualLeadLocked?'MANUAL':'AUTO';mode.style.background=current.typed?'#ffedd5':manualLeadLocked?'#fef3c7':'#dbeafe';}
    if(correct)correct.hidden=!state.activeDoorVisit;
    select.disabled=!!state.activeDoorVisit;
    window.MCCOY_LEAD_ADDRESS?.setDisabled?.(!!state.activeDoorVisit);
    if(manualWrap)manualWrap.hidden=!!current.withinRange||!!current.typed;
    if(state.activeDoorVisit){
      const dwell=Date.now()-state.activeDoorVisit.arrivedAt;
      status.textContent=`Active door: ${label(state.activeDoorVisit.lead)} · ${current.distance==null?'distance unavailable':formatDistance(current.distance)} · ${dwell>=60000?'Contacted threshold reached; departure defaults to No Sale.':'Visit timer active.'}`;
      panel.style.borderColor='#60a5fa';panel.style.background='#eff6ff';return current;
    }
    if(current.typed){
      const fresh=core.isFreshGps(state.latestGps||null);
      status.textContent=`Ad-hoc address: ${current.address} · ${fresh?'Ready to start inside or outside assigned areas.':'Waiting for a fresh GPS fix to start; completed-sale entry remains available.'}`;panel.style.borderColor=fresh?'#f97316':'#f59e0b';panel.style.background='#fff7ed';return current;
    }
    if(!core.isFreshGps(state.latestGps||null)){
      status.textContent='Location unavailable or stale. Non-sale dispositions are locked; only a completed SALE with a service address is allowed.';panel.style.borderColor='#f59e0b';panel.style.background='#fffbeb';return current;
    }
    if(!current.lead){
      status.textContent=lastNearest?'No verified lead is within ¼ mile. Enter the service address to process only a completed SALE.':'No verified mapped leads are available. Enter the service address to process only a completed SALE.';panel.style.borderColor='#f59e0b';panel.style.background='#fffbeb';return current;
    }
    if(current.withinRange){
      status.textContent=`${manualLeadLocked?'Selected':'Closest'}: ${label(current.lead)} · ${formatDistance(current.distance)} away · Door outcomes enabled.`;panel.style.borderColor='#22c55e';panel.style.background='#f0fdf4';
    }else{
      status.textContent=`Selected lead is ${current.distance==null?'not precisely mapped':formatDistance(current.distance)+' away'}. Outside ¼ mile: only SALE is enabled, and a service address is required.`;panel.style.borderColor='#f59e0b';panel.style.background='#fffbeb';
    }
    return current;
  }

  async function correctLead(){
    const visit=state.activeDoorVisit;
    if(visit?.serverVisitId){
      const button=byId('correctDoorLeadBtn');if(button)button.disabled=true;
      try{const {data,error}=await sb.rpc('cancel_door_visit',{p_visit_id:visit.serverVisitId,p_reason:'user_corrected_auto_or_selected_lead'});if(error||!data?.ok)throw error||new Error('correction_failed');}
      catch(error){console.error('Door lead correction failed',error);alert('The active door could not be corrected. Check connection and retry.');if(button)button.disabled=false;return;}
      if(button)button.disabled=false;
    }
    state.activeDoorVisit=null;clearInterval(doorTimerHandle);const timer=byId('doorElapsed');if(timer)timer.textContent='00:00';select.disabled=false;manualLeadLocked=true;resetArrival();resetDeparture();
    const visitStatus=byId('doorVisitStatus');if(visitStatus)visitStatus.textContent='Previous selection cancelled. Choose an assigned lead or type the correct address.';window.MCCOY_LEAD_ADDRESS?.focus?.();render();
    window.dispatchEvent(new CustomEvent('mccoy-door-visit-corrected'));
  }

  function providerAddressFrom(capture){
    const value=String(capture?.service_address||'').trim();if(!value)return;
    providerAddress=value;const input=byId('outsideSaleAddress');if(input&&!input.value)input.value=value;render();
  }
  function saleContext(){
    const current=render(),typed=addressContext(),manual=current.typed?typed.address:(byId('outsideSaleAddress')?.value||''),leadAddress=label(current.lead);
    if(current.typed)return{ok:true,address:typed.address,source:'typed_address',withinRange:false,lead:null,distanceMeters:null,selectionSource:'typed_address'};
    return{...core.saleAddress({withinRange:current.withinRange,leadAddress,manualAddress:manual,providerAddress}),withinRange:current.withinRange,lead:current.lead,distanceMeters:current.distance};
  }

  async function resumeWorkflow(){
    if(resumeAttempted)return;resumeAttempted=true;
    try{
      const {data,error}=await sb.rpc('resume_door_workflow');if(error||!data?.ok)throw error||new Error('resume_failed');
      const session=data.session;if(!session||state.session)return;
      telemetrySessionId=session.id;state.session={startedAt:Date.parse(session.started_at)||Date.now(),startGps:null,resumed:true};state.lastTelemetryBreadcrumbAt=0;
      startGpsWatch();startTimer();byId('fieldState').textContent='Knocking — Session Resumed';byId('startKnockingBtn').classList.add('hidden');byId('stopKnockingBtn').classList.remove('hidden');telemetryStatus('Field session resumed after provider return.',true);
      const visit=data.visit;
      if(visit){
        let lead=(state.leads||[]).find(item=>String(item.dbId)===String(visit.lead_id));
        if(visit.selection_source==='typed_address'&&!visit.lead_id){lead=window.MCCOY_LEAD_ADDRESS_CORE?.adHocLead(visit.lead_label)||{id:`typed:${visit.id}`,dbId:null,address:visit.lead_label,fullAddress:visit.lead_label,isAdHoc:true,selectionSource:'typed_address'};window.MCCOY_LEAD_ADDRESS?.setTyped?.(visit.lead_label,'resume');}
        else{if(!lead){const address=[visit.address1,visit.address2].filter(Boolean).join(' ')||visit.lead_label;lead={id:`resumed-${visit.lead_id}`,dbId:visit.lead_id,address,fullAddress:visit.lead_label,city:visit.city||'',stateCode:visit.state||'',zip:visit.zip||'',lat:Number(visit.lead_latitude),lng:Number(visit.lead_longitude),geocodeStatus:visit.geocode_status,isDemo:false,disposition:'Uncontacted'};(state.leads||[]).unshift(lead);}chooseLead(lead,false);}
        manualLeadLocked=['manual_lead','typed_address'].includes(visit.selection_source);
        state.activeDoorVisit={serverVisitId:visit.id,lead,arrivedAt:Date.parse(visit.started_at)||Date.now(),arrivalGps:{lat:visit.arrival_latitude,lng:visit.arrival_longitude,accuracy:visit.arrival_accuracy_meters,capturedAt:Date.parse(visit.started_at)||Date.now()},arrivalDistanceMeters:Number(visit.arrival_distance_meters),restored:true};
        startDoorTimer();const visitStatus=byId('doorVisitStatus');if(visitStatus)visitStatus.textContent=`Resumed active visit for ${lead.address}.`;
      }
      window.dispatchEvent(new CustomEvent('mccoy-field-session-started',{detail:{sessionId:session.id,startedAt:state.session.startedAt,resumed:true}}));render();
    }catch(error){console.error('Door workflow resume failed',error);}
  }

  function evaluateAutomation(){
    const current=render(),gps=state.latestGps||null;
    if(!state.session||!telemetrySessionId||!core.isFreshGps(gps)){resetArrival();resetDeparture();return;}
    if(!state.activeDoorVisit){
      if(!current.withinRange||!current.lead){resetArrival();return;}
      const candidate=String(current.lead.dbId||current.lead.id);if(arrivalCandidate===candidate)arrivalHits++;else{arrivalCandidate=candidate;arrivalHits=1;}
      if(core.shouldAutoArrive({distance:current.distance,accuracy:Number(gps.accuracy),candidateHits:arrivalHits})){resetArrival();window.MCCOY_START_DOOR_VISIT?.({automatic:!manualLeadLocked});}
      return;
    }
    resetArrival();if(activeCapture()){resetDeparture();return;}
    const active=state.activeDoorVisit.lead,activeDistance=core.metersBetween(gps,active),nearest=core.nearestLead(state.leads||[],gps),nearestIsDifferent=!!nearest&&String(nearest.lead.dbId||nearest.lead.id)!==String(active.dbId||active.id);
    const candidate=`${nearestIsDifferent?'different':'away'}:${nearest?.lead?.dbId||''}`;if(departureCandidate===candidate)departureHits++;else{departureCandidate=candidate;departureHits=1;}
    if(core.shouldAutoDepart({activeDistance,accuracy:Number(gps.accuracy),nearestIsDifferent,candidateHits:departureHits})){
      resetDeparture();window.MCCOY_COMPLETE_DOOR_VISIT?.('auto',{automatic:true,autoReason:'gps_departure_after_stable_arrival'});
    }
  }

  select.addEventListener('change',event=>{if((event.isTrusted||!autoChanging)&&!state.activeDoorVisit){manualLeadLocked=!!select.value;resetArrival();render();}});
  window.addEventListener('mccoy-lead-address-changed',event=>{if(!state.activeDoorVisit){manualLeadLocked=event.detail?.context?.kind==='typed'||event.detail?.context?.kind==='assigned';resetArrival();render();}});
  byId('useClosestLeadBtn').addEventListener('click',()=>{manualLeadLocked=false;window.MCCOY_LEAD_ADDRESS?.clear?.('use_closest');const nearest=core.nearestLead(state.leads||[],state.latestGps||null);if(nearest&&nearest.distance<=core.QUARTER_MILE_METERS)chooseLead(nearest.lead,true);render();});
  byId('correctDoorLeadBtn').addEventListener('click',correctLead);
  byId('outsideSaleAddress').addEventListener('input',render);
  for(const eventName of ['mccoy-provider-sale-capture-started','mccoy-provider-sale-capture-ready','mccoy-provider-sale-returned','mccoy-provider-sale-capture-restored'])window.addEventListener(eventName,event=>providerAddressFrom(event.detail?.capture));
  window.addEventListener('mccoy-provider-sale-abandoned',()=>setTimeout(evaluateAutomation,150));
  window.addEventListener('mccoy-door-visit-started',render);window.addEventListener('mccoy-door-visit-completed',()=>{manualLeadLocked=false;resetArrival();resetDeparture();render();});
  for(const eventName of ['mccoy-real-leads-progress','mccoy-real-leads-loaded'])window.addEventListener(eventName,()=>{if(state.activeDoorVisit?.lead?.dbId){const loaded=(state.leads||[]).find(item=>String(item.dbId)===String(state.activeDoorVisit.lead.dbId));if(loaded){state.activeDoorVisit.lead=loaded;chooseLead(loaded,false);}}render();});
  window.addEventListener('mccoy-access-ready',resumeWorkflow);setTimeout(()=>{if(window.MCCOY_ACCESS?.access)resumeWorkflow();},900);
  const timer=setInterval(()=>{try{evaluateAutomation();}catch(error){console.error('Distance to Lead evaluation failed',error);}},750);
  window.addEventListener('beforeunload',()=>clearInterval(timer));
  window.MCCOY_DISTANCE_TO_LEAD_CONTROL={render,current:saleContext,useClosest:()=>byId('useClosestLeadBtn').click(),correctLead};
  render();
})();
