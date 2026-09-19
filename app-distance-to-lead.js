// Silent location engine: automatic nearest-lead selection, resumable visits,
// and sale-only distance audit context. Distance is never rendered as a field metric.
(function(){
  if(window.MCCOY_DISTANCE_TO_LEAD_CONTROL)return;
  const autoNearestEnabled=()=>window.MCCOY_FIELD_FEATURES?.automaticNearestLead===true;
  const core=window.MCCOY_DOOR_WORKFLOW_CORE,select=document.getElementById('fieldLeadSelect');
  if(!core||!select)return;
  document.getElementById('closestDoorAddress')?.remove();
  const arriveButton=document.getElementById('arriveDoorBtn'),correctButton=document.createElement('button');
  correctButton.id='correctDoorLeadBtn';correctButton.type='button';correctButton.className='assign-btn';correctButton.textContent='CORRECT LEAD';correctButton.hidden=true;correctButton.setAttribute('aria-describedby','doorVisitStatus');arriveButton?.insertAdjacentElement('afterend',correctButton);

  let manualLeadLocked=false,autoChanging=false,providerAddress='';
  let arrivalCandidate=null,arrivalHits=0,departureCandidate=null,departureHits=0,resumeAttempted=false;
  const byId=id=>document.getElementById(id);
  const label=lead=>lead?.fullAddress||[lead?.address,lead?.city,[lead?.stateCode,lead?.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')||'Selected lead';
  const selectedLead=()=>window.MCCOY_LEAD_ADDRESS?.current?.().lead||state.activeDoorVisit?.lead||null;
  const addressContext=()=>window.MCCOY_LEAD_ADDRESS?.current?.()||{kind:'empty',address:'',lead:null,valid:false};
  function ensureOption(lead){if(!lead)return;let option=[...select.options].find(item=>item.value===String(lead.id));if(!option){option=new Option(label(lead),String(lead.id));select.add(option);}}
  function chooseLead(lead,automatic=true){if(!lead||(automatic&&!autoNearestEnabled()))return;ensureOption(lead);autoChanging=true;select.value=String(lead.id);select.dispatchEvent(new Event('change',{bubbles:true}));autoChanging=false;if(automatic)manualLeadLocked=false;}
  function activeCapture(){const capture=window.MCCOY_ACTIVE_PROVIDER_CAPTURE;return capture&&['dashboard_opened','details_required'].includes(capture.status)?capture:null;}
  function resetArrival(){arrivalCandidate=null;arrivalHits=0;}
  function resetDeparture(){departureCandidate=null;departureHits=0;}

  function calculate(){
    // Auto-populating the address is no longer this file's job. That now
    // belongs entirely to app-closest-lead-autofill-v2.js, which does a
    // genuine real-world lookup -- a server-side radius search against the
    // full leads table, falling back to actual reverse geocoding -- rather
    // than guessing from whatever happened to be sitting in this file's
    // local, possibly-sparse lead cache with no real-world fallback and no
    // distance limit. This function now only reports distance/arrival
    // state for whatever lead is already selected; it never changes the
    // selection itself.
    const gps=state.latestGps||null;
    const context=addressContext(),typed=context.kind==='typed'?context:null;
    if(typed)return{withinRange:false,distance:null,reason:'typed_address',lead:null,typed:true,address:typed.address,selectionSource:'typed_address'};
    const current=selectedLead(),distance=core.distanceState(current,gps);
    return{...distance,lead:current};
  }

  function render(){
    const current=calculate(),correct=byId('correctDoorLeadBtn');
    if(correct)correct.hidden=!state.activeDoorVisit;
    select.disabled=!!state.activeDoorVisit;
    // The sale address can differ from the active physical-door visit.
    window.MCCOY_LEAD_ADDRESS?.setDisabled?.(false);
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
    const visitStatus=byId('doorVisitStatus');if(visitStatus)visitStatus.textContent='Previous selection cancelled. Choose a McCoy lead or type the correct address.';window.MCCOY_LEAD_ADDRESS?.focus?.();render();
    window.dispatchEvent(new CustomEvent('mccoy-door-visit-corrected'));
  }

  function providerAddressFrom(capture){
    const value=String(capture?.service_address||'').trim();if(!value)return;
    providerAddress=value;render();
  }
  function saleContext(){
    const current=render(),context=addressContext(),lead=current.lead||context.lead||null,contextAddress=context.valid?String(context.address||'').trim():'',leadAddress=lead?label(lead):'',address=contextAddress||providerAddress||leadAddress;
    return{ok:!!address,address,source:context.kind==='typed'?'typed_address':contextAddress?'lead':providerAddress?'provider':'lead',withinRange:current.withinRange,lead:context.kind==='typed'?null:lead,distanceMeters:current.distance,selectionSource:context.kind==='typed'?'typed_address':null};
  }

  async function resumeWorkflow(){
    if(resumeAttempted)return;resumeAttempted=true;
    const hadAddress=!!addressContext().address,revision=window.MCCOY_LEAD_ADDRESS?.revision?.()||0;
    try{
      const {data,error}=await sb.rpc('resume_door_workflow');if(error||!data?.ok)throw error||new Error('resume_failed');
      const session=data.session;if(!session||state.session)return;
      const restoreAddress=!hadAddress&&!addressContext().address&&revision===(window.MCCOY_LEAD_ADDRESS?.revision?.()||0);
      telemetrySessionId=session.id;state.session={startedAt:Date.parse(session.started_at)||Date.now(),startGps:null,resumed:true};state.lastTelemetryBreadcrumbAt=0;
      startGpsWatch();startTimer();byId('fieldState').textContent='Knocking — Session Resumed';byId('startKnockingBtn').classList.add('hidden');const stopBtn=byId('stopKnockingBtn');stopBtn.classList.remove('hidden');stopBtn.disabled=false;stopBtn.textContent='STOP SESSION';telemetryStatus('Field session resumed after provider return.',true);
      const visit=data.visit;
      if(visit){
        let lead=(state.leads||[]).find(item=>String(item.dbId)===String(visit.lead_id));
        if(visit.selection_source==='typed_address'&&!visit.lead_id){lead=window.MCCOY_LEAD_ADDRESS_CORE?.adHocLead(visit.lead_label)||{id:`typed:${visit.id}`,dbId:null,address:visit.lead_label,fullAddress:visit.lead_label,isAdHoc:true,selectionSource:'typed_address'};if(restoreAddress)window.MCCOY_LEAD_ADDRESS?.setTyped?.(visit.lead_label,'resume');}
        else{if(!lead){const address=[visit.address1,visit.address2].filter(Boolean).join(' ')||visit.lead_label;lead={id:`resumed-${visit.lead_id}`,dbId:visit.lead_id,address,fullAddress:visit.lead_label,city:visit.city||'',stateCode:visit.state||'',zip:visit.zip||'',lat:Number(visit.lead_latitude),lng:Number(visit.lead_longitude),geocodeStatus:visit.geocode_status,isDemo:false,disposition:'Uncontacted'};(state.leads||[]).unshift(lead);}if(restoreAddress)chooseLead(lead,false);}
        manualLeadLocked=['manual_lead','typed_address'].includes(visit.selection_source);
        state.activeDoorVisit={serverVisitId:visit.id,lead,arrivedAt:Date.parse(visit.started_at)||Date.now(),arrivalGps:{lat:visit.arrival_latitude,lng:visit.arrival_longitude,accuracy:visit.arrival_accuracy_meters,capturedAt:Date.parse(visit.started_at)||Date.now()},arrivalDistanceMeters:Number(visit.arrival_distance_meters),restored:true};
        startDoorTimer();const visitStatus=byId('doorVisitStatus');if(visitStatus)visitStatus.textContent=`Resumed active visit for ${lead.address}.`;
      }
      window.dispatchEvent(new CustomEvent('mccoy-field-session-started',{detail:{sessionId:session.id,startedAt:state.session.startedAt,resumed:true}}));render();
    }catch(error){console.error('Door workflow resume failed',error);}
  }

  function evaluateAutomation(){
    if(!autoNearestEnabled()){resetArrival();resetDeparture();return;}
    const current=render(),gps=state.latestGps||null;
    if(!state.session||!telemetrySessionId||!core.isFreshGps(gps)){resetArrival();resetDeparture();return;}
    if(!state.activeDoorVisit){
      // Automatic arrival remains restricted to field/manual-verified pins even
      // though the address box can populate from every usable mapped lead.
      if(!current.withinRange||!current.lead||!core.verifiedLead(current.lead)){resetArrival();return;}
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
  byId('correctDoorLeadBtn')?.addEventListener('click',correctLead);
  for(const eventName of ['mccoy-provider-sale-capture-started','mccoy-provider-sale-capture-ready','mccoy-provider-sale-returned','mccoy-provider-sale-capture-restored'])window.addEventListener(eventName,event=>providerAddressFrom(event.detail?.capture));
  window.addEventListener('mccoy-provider-sale-abandoned',()=>{providerAddress='';setTimeout(evaluateAutomation,150);});
  window.addEventListener('mccoy-door-visit-started',render);window.addEventListener('mccoy-door-visit-completed',()=>{manualLeadLocked=false;providerAddress='';resetArrival();resetDeparture();render();});
  for(const eventName of ['mccoy-real-leads-progress','mccoy-real-leads-loaded'])window.addEventListener(eventName,()=>{if(state.activeDoorVisit?.lead?.dbId){const loaded=(state.leads||[]).find(item=>String(item.dbId)===String(state.activeDoorVisit.lead.dbId));if(loaded){state.activeDoorVisit.lead=loaded;}}render();});
  window.addEventListener('mccoy-access-ready',resumeWorkflow);setTimeout(()=>{if(window.MCCOY_ACCESS?.access)resumeWorkflow();},900);
  // The shared manual workflow remains installed; a paused release owns no automation timer.
  const timer=autoNearestEnabled()?setInterval(()=>{try{evaluateAutomation();}catch(error){console.error('Silent door automation failed',error);}},750):null;
  window.addEventListener('beforeunload',()=>clearInterval(timer));
  window.MCCOY_DISTANCE_TO_LEAD_CONTROL={render,current:saleContext,correctLead};
  render();
})();
