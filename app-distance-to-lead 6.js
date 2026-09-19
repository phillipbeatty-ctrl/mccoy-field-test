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

  function ensureRefreshButton(){
    const combobox=byId('fieldLeadAddressInput')?.closest('.field-lead-combobox');
    if(!combobox||byId('serviceAddressRefreshBtn'))return;
    const btn=document.createElement('button');
    btn.type='button';btn.id='serviceAddressRefreshBtn';btn.textContent='REFRESH';
    btn.style.cssText='margin-top:6px;font-size:11px;padding:5px 10px;border-radius:999px;border:1px solid #d1d5db;background:#fff;color:#374151;cursor:pointer;display:block';
    btn.onclick=()=>{
      // Deliberately overrides everything a normal automatic cycle
      // respects: manualLeadLocked (so a prior manual edit or selection
      // doesn't block a fresh attempt) and the real-world fallback's own
      // throttle (so this doesn't wait out the usual 15s/25m cooldown).
      // The point is a forced, immediate retry when the current value is
      // wrong -- too far, or on a different street -- not a passive
      // background refresh.
      manualLeadLocked=false;
      realWorldLookup.lastAttemptAt=0;realWorldLookup.lastLat=null;realWorldLookup.lastLng=null;
      window.MCCOY_LEAD_ADDRESS?.clear?.('refresh_button');
      window.MCCOY_LEAD_ADDRESS?.setMessage?.('Refreshing for a closer address\u2026');
      render();
    };
    combobox.insertAdjacentElement('afterend',btn);
  }

  let realWorldLookup={busy:false,lastAttemptAt:0,lastLat:null,lastLng:null};

  function metersMoved(lat,lng){
    if(realWorldLookup.lastLat==null)return Infinity;
    return core.metersBetween({lat,lng},{lat:realWorldLookup.lastLat,lng:realWorldLookup.lastLng});
  }

  async function fetchRealWorldNearest(gps){
    // Same proven lookup app-closest-lead-autofill-v2.js already uses: a
    // real, radius-bounded search of the full leads table server-side,
    // falling back to actual Google reverse geocoding when nothing in our
    // own data is genuinely close. This is the real-world fallback for
    // when the local lead cache has nothing usable nearby.
    const {data,error}=await sb.functions.invoke('reverse-geocode-nearest-address',{body:{lat:gps.lat,lng:gps.lng,accuracy:gps.accuracy}});
    if(error||!data?.address||data.ambiguous)return null;
    return{id:data.google_place_id?`realworld:${data.google_place_id}`:`realworld:${gps.lat.toFixed(5)},${gps.lng.toFixed(5)}`,
      dbId:null,address:data.address,fullAddress:data.address,isAdHoc:true,selectionSource:'automatic_nearest_realworld'};
  }

  function maybeFallbackToRealWorld(gps,localNearest){
    if(!gps||typeof sb==='undefined'||!sb?.functions)return;
    if(localNearest&&localNearest.distance<=core.QUARTER_MILE_METERS)return;
    if(realWorldLookup.busy||Date.now()-realWorldLookup.lastAttemptAt<15000)return;
    if(metersMoved(gps.lat,gps.lng)<25&&realWorldLookup.lastAttemptAt>0)return;
    realWorldLookup.busy=true;realWorldLookup.lastAttemptAt=Date.now();realWorldLookup.lastLat=gps.lat;realWorldLookup.lastLng=gps.lng;
    fetchRealWorldNearest(gps).then(lead=>{
      // Re-check conditions on arrival -- an async response should never
      // clobber a manual selection, typed address, or active visit that
      // started while this was in flight. Using setLead directly, not
      // chooseLead: this synthetic, real-world-only lead is never added
      // to state.leads, and the select's own change-sync (syncFromSelect)
      // looks up the label from state.leads -- it would never find this
      // one, leaving the visible Service Address box unchanged even
      // though the underlying hidden select technically updated.
      if(lead&&autoNearestEnabled()&&!manualLeadLocked&&addressContext().kind!=='typed'&&!state.activeDoorVisit){
        window.MCCOY_LEAD_ADDRESS?.setLead?.(lead,'automatic_nearest_realworld');
      }
    }).catch(error=>console.error('Real-world nearest-address fallback failed',error))
      .finally(()=>{realWorldLookup.busy=false;});
  }

  function calculate(){
    const gps=state.latestGps||null,nearest=autoNearestEnabled()?core.nearestLead(state.leads||[],gps):null;
    const context=addressContext(),typed=context.kind==='typed'?context:null;
    if(autoNearestEnabled()&&!manualLeadLocked&&!typed&&!state.activeDoorVisit){
      if(nearest){if(String(select.value)!==String(nearest.lead.id))chooseLead(nearest.lead,true);}
      else if(select.value){autoChanging=true;select.value='';select.dispatchEvent(new Event('change',{bubbles:true}));autoChanging=false;}
      if(gps)maybeFallbackToRealWorld(gps,nearest);
    }
    if(typed)return{withinRange:false,distance:null,reason:'typed_address',lead:null,nearest,typed:true,address:typed.address,selectionSource:'typed_address'};
    const current=selectedLead(),distance=core.distanceState(current,gps);
    return{...distance,lead:current,nearest};
  }

  function render(){
    ensureRefreshButton();
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

  function useClosest(){if(!autoNearestEnabled())return render();manualLeadLocked=false;window.MCCOY_LEAD_ADDRESS?.clear?.('use_closest');const nearest=core.nearestLead(state.leads||[],state.latestGps||null);if(nearest)chooseLead(nearest.lead,true);return render();}

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
  window.MCCOY_DISTANCE_TO_LEAD_CONTROL={render,current:saleContext,useClosest,correctLead};
  render();
})();
