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
      // Deliberately overrides everything a normal cycle respects:
      // manualLeadLocked, any in-progress ping session, and the
      // real-world fallback's own throttle. The point is a forced,
      // immediate fresh multi-ping session when the current value is
      // wrong -- too far, or on a different street -- not a passive
      // background refresh.
      manualLeadLocked=false;
      stopPingConsensusSession();
      window.MCCOY_LEAD_ADDRESS?.clear?.('refresh_button');
      window.MCCOY_LEAD_ADDRESS?.setMessage?.('Refreshing for a closer address\u2026');
      runPingConsensusSession();
    };
    combobox.insertAdjacentElement('afterend',btn);
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

  // --- Multi-ping consensus: resolves an initial fill or a REFRESH press
  // to a single, best-available address from at least 5 independent GPS
  // pings, per the fully-specified selection rules below. This runs as a
  // separate, one-shot session -- the ongoing 750ms automation tick does
  // not interfere with or duplicate it.
  const TARGET_METERS=5,TWO_MINUTE_FALLBACK_METERS=10,THREE_MINUTE_FALLBACK_METERS=30;
  const RULE_7_NEVER_BETTER_THAN=20; // Rule 7's own, distinct trigger (has GPS ever, across the whole session, beaten this) -- unrelated to the time-based relaxation tiers below, despite one of them coincidentally also being 20 in an earlier draft of this file.
  const SESSION_CAP_MS=5*60*1000,RELAX_TO_TWO_MINUTE_MS=2*60*1000,RELAX_TO_THREE_MINUTE_MS=3*60*1000;
  let pingSession=null; // {startedAt, stopped}

  function qualityTier(accuracy){
    if(!Number.isFinite(accuracy))return 'refining';
    if(accuracy<TARGET_METERS)return 'great';
    if(accuracy<=TWO_MINUTE_FALLBACK_METERS)return 'good';
    if(accuracy<=THREE_MINUTE_FALLBACK_METERS)return 'fair';
    return 'refining';
  }

  function ensureQualityIndicator(){
    const combobox=byId('fieldLeadAddressInput')?.closest('.field-lead-combobox');
    if(!combobox||byId('serviceAddressQualityIndicator'))return null;
    const badge=document.createElement('span');
    badge.id='serviceAddressQualityIndicator';
    badge.style.cssText='display:inline-block;margin-top:4px;font-size:10px;font-weight:700;padding:2px 8px;border-radius:999px;background:#f3f4f6;color:#374151';
    combobox.insertAdjacentElement('afterend',badge);
    return badge;
  }
  function setQualityIndicator(accuracy){
    const badge=ensureQualityIndicator()||byId('serviceAddressQualityIndicator');
    if(!badge)return;
    const tier=qualityTier(accuracy);
    const labels={great:'GREAT GPS',good:'GOOD GPS',fair:'FAIR GPS',refining:'REFINING…'};
    const colors={great:'#166534',good:'#854d0e',fair:'#9a3412',refining:'#6b7280'};
    badge.textContent=Number.isFinite(accuracy)?`${labels[tier]} (\u00b1${Math.round(accuracy)}m)`:labels[tier];
    badge.style.color=colors[tier];
  }

  // Resolves one GPS reading to a candidate address, reusing the same
  // local-lookup-then-real-world-fallback logic used elsewhere in this
  // file, but as a single, self-contained {address, accuracy, lead}
  // result rather than something that touches the UI directly.
  async function resolveOnePing(gps){
    const local=core.nearestLead(state.leads||[],gps);
    if(local&&local.distance<=core.QUARTER_MILE_METERS){
      return{address:label(local.lead),accuracy:Number(gps.accuracy),lead:local.lead};
    }
    const realWorld=await fetchRealWorldNearest(gps);
    if(realWorld)return{address:realWorld.address,accuracy:Number(gps.accuracy),lead:realWorld};
    return null;
  }

  function waitForFreshGps(sinceCapturedAt,timeoutMs=8000){
    return new Promise(resolve=>{
      const startedWaitingAt=Date.now();
      const check=()=>{
        const gps=state.latestGps;
        if(gps&&gps.capturedAt>sinceCapturedAt&&core.isFreshGps(gps)){resolve(gps);return;}
        if(Date.now()-startedWaitingAt>timeoutMs){resolve(gps||null);return;} // Give up waiting and use whatever's available rather than hang indefinitely.
        setTimeout(check,300);
      };
      check();
    });
  }

  // Selection rules 1/2/3/5/6/7, fully specified:
  // - A reading at or better than the ±5m target always wins outright over
  //   any multi-occurrence address (Rule 6, absolute override within this
  //   session -- this is now the single, only accuracy limit; there's no
  //   separate "Great" concept above or below it).
  // - Otherwise, occurrence count can override a small accuracy
  //   disadvantage: tolerated gap in meters equals the occurrence-count
  //   difference (Rule 5's ramp).
  // - A tie in occurrence count is broken by higher accuracy (Rule 3).
  // - If GPS never once reaches Rule 7's own threshold (20m) across the
  //   whole set collected so far, occurrence count alone decides, however
  //   narrow the margin (Rule 7, fully specified -- no extra margin
  //   requirement layered on top).
  // - Otherwise, highest accuracy wins (Rules 1/2).
  function pickWinner(pings){
    const byAddress=new Map();
    for(const ping of pings){
      const entry=byAddress.get(ping.address)||{address:ping.address,lead:ping.lead,count:0,bestAccuracy:Infinity};
      entry.count++;
      if(ping.accuracy<entry.bestAccuracy){entry.bestAccuracy=ping.accuracy;entry.lead=ping.lead;}
      byAddress.set(ping.address,entry);
    }
    const candidates=[...byAddress.values()];
    if(candidates.length===1)return candidates[0];

    const atTarget=candidates.filter(c=>c.bestAccuracy<=TARGET_METERS);
    if(atTarget.length){atTarget.sort((a,b)=>a.bestAccuracy-b.bestAccuracy);return atTarget[0];} // Rule 6.

    const everReachedRule7Threshold=candidates.some(c=>c.bestAccuracy<=RULE_7_NEVER_BETTER_THAN);
    if(!everReachedRule7Threshold){
      candidates.sort((a,b)=>b.count-a.count);
      return candidates[0]; // Rule 7.
    }

    candidates.sort((a,b)=>{
      if(a.count!==b.count){
        const countDiff=Math.abs(a.count-b.count),tolerance=countDiff; // Rule 5's ramp.
        const accuracyDiff=a.bestAccuracy-b.bestAccuracy;
        const higherCountIsA=a.count>b.count;
        const higherCountEntry=higherCountIsA?a:b,lowerCountEntry=higherCountIsA?b:a;
        const higherCountAccuracyDisadvantage=higherCountEntry.bestAccuracy-lowerCountEntry.bestAccuracy;
        if(higherCountAccuracyDisadvantage<=tolerance)return higherCountIsA?-1:1; // Occurrence wins within tolerance.
        return accuracyDiff; // Otherwise accuracy decides (Rules 1/2).
      }
      return a.bestAccuracy-b.bestAccuracy; // Rule 3: tie in count, accuracy breaks it.
    });
    return candidates[0];
  }

  function applyWinner(winner){
    if(!winner)return;
    if(winner.lead?.dbId!==undefined&&winner.lead?.isAdHoc!==true)chooseLead(winner.lead,true);
    else window.MCCOY_LEAD_ADDRESS?.setLead?.(winner.lead,'automatic_nearest_ping_consensus');
    setQualityIndicator(winner.bestAccuracy);
  }

  function targetForElapsed(elapsedMs){
    if(elapsedMs>=RELAX_TO_THREE_MINUTE_MS)return THREE_MINUTE_FALLBACK_METERS;
    if(elapsedMs>=RELAX_TO_TWO_MINUTE_MS)return TWO_MINUTE_FALLBACK_METERS;
    return TARGET_METERS;
  }

  async function runPingConsensusSession(){
    if(pingSession&&!pingSession.stopped)return; // Already running -- REFRESH stops and restarts explicitly below.
    const session={startedAt:Date.now(),stopped:false};
    pingSession=session;
    const pings=[];
    let lastCapturedAt=0;

    async function collectOnePing(){
      const gps=await waitForFreshGps(lastCapturedAt);
      if(!gps)return;
      lastCapturedAt=gps.capturedAt;
      const resolved=await resolveOnePing(gps);
      if(resolved)pings.push(resolved);
    }

    // Rule 4: scale the initial batch size to GPS quality -- worse average
    // accuracy means more pings before the first evaluation, giving a
    // proportionally larger pool to choose from. The first 5 always run
    // regardless, so a fast, good-GPS case never waits longer than that.
    for(let i=0;i<5&&!session.stopped;i++)await collectOnePing();
    if(session.stopped||!pings.length)return;
    const avgAccuracy=pings.reduce((sum,p)=>sum+p.accuracy,0)/pings.length;
    const extraTarget=avgAccuracy>TARGET_METERS?Math.min(Math.round(5*(avgAccuracy/TARGET_METERS)),25):5; // Capped so a single bad reading can't demand an extreme batch.
    for(let i=pings.length;i<extraTarget&&!session.stopped;i++)await collectOnePing();
    if(session.stopped||!pings.length)return;

    applyWinner(pickWinner(pings));

    // Whether to extend at all uses the same, single ±5m target used
    // everywhere else -- there is no separate threshold for this decision.
    if(pickWinner(pings).bestAccuracy<=TARGET_METERS)return;

    // Extended refinement: only when the winner's own accuracy hasn't yet
    // reached the currently-relaxing target, per the tiered schedule --
    // ±5m initially, relaxing to ±10m after 2 minutes if still not met,
    // ±30m after 3 minutes, and a hard stop at the 5-minute cap regardless.
    while(!session.stopped){
      const elapsed=Date.now()-session.startedAt;
      if(elapsed>=SESSION_CAP_MS){
        // Hard stop: abandon the occurrence-based consensus entirely and
        // select whichever single ping had the best (lowest-error)
        // accuracy across the whole session -- a single precise reading
        // is a more direct physical signal than a pattern of mediocre
        // repeats once time has genuinely run out.
        const best=pings.reduce((b,p)=>p.accuracy<b.accuracy?p:b);
        applyWinner({address:best.address,lead:best.lead,bestAccuracy:best.accuracy,count:pings.filter(p=>p.address===best.address).length});
        break;
      }
      const winner=pickWinner(pings);
      const currentTarget=targetForElapsed(elapsed);
      if(winner.bestAccuracy<=currentTarget)break;
      const distinctAddresses=new Set(pings.map(p=>p.address));
      if(distinctAddresses.size===1)break; // Nothing further pinging could change.
      await collectOnePing();
      if(session.stopped)break;
      const newWinner=pickWinner(pings);
      if(newWinner.address!==winner.address||newWinner.bestAccuracy!==winner.bestAccuracy)applyWinner(newWinner);
    }
  }

  function stopPingConsensusSession(){if(pingSession)pingSession.stopped=true;}

  function calculate(){
    const gps=state.latestGps||null;
    const context=addressContext(),typed=context.kind==='typed'?context:null;
    if(autoNearestEnabled()&&!manualLeadLocked&&!typed&&!state.activeDoorVisit&&!select.value&&(!pingSession||pingSession.stopped)){
      runPingConsensusSession();
    }
    if(typed)return{withinRange:false,distance:null,reason:'typed_address',lead:null,typed:true,address:typed.address,selectionSource:'typed_address'};
    const current=selectedLead(),distance=core.distanceState(current,gps);
    return{...distance,lead:current};
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
  window.MCCOY_DISTANCE_TO_LEAD_CONTROL={render,current:saleContext,useClosest,correctLead,_pickWinnerForTesting:pickWinner,_qualityTierForTesting:qualityTier,_targetForElapsedForTesting:targetForElapsed};
  render();
})();
