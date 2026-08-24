(()=>{
  const api=window.MCCOY_LEAD_MAP,core=window.MCCOY_LIVE_LOCATION_CORE;
  if(!api?.map||!window.L||!core)return;
  const map=api.map,controls=document.getElementById('leadGeoControls');
  if(!controls||document.getElementById('followMyLocationBtn'))return;

  const css=document.createElement('style');
  css.textContent=`
    .mccoy-live-location-icon{background:transparent!important;border:0!important}
    .mccoy-live-location-icon .live-location-pin{position:relative;width:24px;height:24px;border:4px solid #fff;border-radius:50%;background:#2563eb;box-shadow:0 1px 5px rgba(15,23,42,.55)}
    .mccoy-live-location-icon .live-location-pin:before{content:"";position:absolute;inset:-9px;border:3px solid rgba(37,99,235,.32);border-radius:50%;animation:mccoy-location-pulse 1.8s ease-out infinite}
    .mccoy-live-location-icon.signal-lost .live-location-pin{background:#d97706}
    .mccoy-live-location-icon.signal-lost .live-location-pin:before{animation:none;border-color:rgba(217,119,6,.28)}
    @keyframes mccoy-location-pulse{0%{transform:scale(.65);opacity:1}100%{transform:scale(1.6);opacity:0}}
    #liveLocationStatus{display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-top:6px}
    #liveLocationStatus .live-location-dot{width:9px;height:9px;border-radius:50%;background:#94a3b8;box-shadow:0 0 0 3px rgba(148,163,184,.16)}
    #liveLocationStatus[data-state="live"] .live-location-dot{background:#2563eb;box-shadow:0 0 0 3px rgba(37,99,235,.18)}
    #liveLocationStatus[data-state="signal_lost"] .live-location-dot{background:#d97706;box-shadow:0 0 0 3px rgba(217,119,6,.18)}
    #liveLocationAccuracy{margin-top:3px}
    #followMyLocationBtn[aria-pressed="true"]{background:#1455d9;color:#fff;border-color:#1455d9}
  `;
  document.head.appendChild(css);

  const buttonRow=controls.querySelector('div');
  const followButton=document.createElement('button');followButton.id='followMyLocationBtn';followButton.type='button';followButton.className='assign-btn';followButton.textContent='MY LOCATION';followButton.setAttribute('aria-pressed','false');followButton.title='Center the map on your current field-session location';buttonRow?.appendChild(followButton);
  const status=document.createElement('div');status.id='liveLocationStatus';status.className='muted small';status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.dataset.state='inactive';status.innerHTML='<span class="live-location-dot" aria-hidden="true"></span><span id="liveLocationStateText">Start Knocking to show your location. This marker exists only in your browser.</span>';controls.appendChild(status);
  const accuracy=document.createElement('div');accuracy.id='liveLocationAccuracy';accuracy.className='muted small';accuracy.textContent='Accuracy: unavailable';controls.appendChild(accuracy);

  const locationLayer=L.layerGroup().addTo(map);
  const icon=stateName=>L.divIcon({className:`mccoy-live-location-icon${stateName==='signal_lost'?' signal-lost':''}`,html:'<div class="live-location-pin" aria-hidden="true"></div>',iconSize:[32,32],iconAnchor:[16,16],tooltipAnchor:[0,-18]});
  let marker=null,accuracyCircle=null,lastAccepted=null,pendingJump=null,follow=false,gpsErrorReason=null,freshnessTimer=null;

  function activeSession(){return Boolean(state?.session);}
  function statusText(text,stateName='inactive'){status.dataset.state=stateName;const label=document.getElementById('liveLocationStateText');if(label)label.textContent=text;}
  function accuracyText(fix,lastKnown=false){accuracy.textContent=fix?`Accuracy: ±${Math.round(fix.accuracy)} m${lastKnown?' at last fix':''}`:'Accuracy: unavailable';}
  function setFollow(on){follow=Boolean(on);followButton.setAttribute('aria-pressed',String(follow));followButton.textContent=follow?'FOLLOWING ME':'MY LOCATION';}
  function clearFreshnessTimer(){if(freshnessTimer!==null){clearTimeout(freshnessTimer);freshnessTimer=null;}}
  function scheduleFreshness(){
    clearFreshnessTimer();if(!activeSession()||!lastAccepted)return;
    const fresh=core.freshness(lastAccepted);if(!fresh.visible)return;
    const boundary=fresh.state==='live'?core.LIVE_MAX_AGE_MS:core.SIGNAL_GRACE_MS;
    freshnessTimer=setTimeout(()=>{freshnessTimer=null;refreshFreshness();scheduleFreshness();},Math.max(250,boundary-fresh.ageMs+50));
  }
  function clearLocation({message='Start Knocking to show your location. This marker exists only in your browser.',resetFix=true}={}){
    if(marker){locationLayer.removeLayer(marker);marker=null;}if(accuracyCircle){locationLayer.removeLayer(accuracyCircle);accuracyCircle=null;}
    if(resetFix){lastAccepted=null;pendingJump=null;gpsErrorReason=null;}
    clearFreshnessTimer();setFollow(false);statusText(message,'inactive');accuracyText(null);
  }
  function zoomToLocation(event){
    event?.originalEvent?.preventDefault?.();if(event&&window.L?.DomEvent)L.DomEvent.stopPropagation(event);
    if(!activeSession()||!lastAccepted||!core.freshness(lastAccepted).visible)return;
    const targetZoom=Math.min(19,Math.max(18,map.getZoom()+2));map.setView([lastAccepted.lat,lastAccepted.lng],targetZoom,{animate:true});
    const lastKnown=core.freshness(lastAccepted).state!=='live'||Boolean(gpsErrorReason)||Boolean(pendingJump);
    statusText(lastKnown?'Zoomed to your last known location. The marker is not live.':'Zoomed to your current location.',lastKnown?'signal_lost':'live');
  }
  function showFix(fix,stateName='live'){
    const latLng=[fix.lat,fix.lng],lastKnown=stateName==='signal_lost',circleColor=lastKnown?'#d97706':'#2563eb',title=lastKnown?'Your last known location':'Your current location';
    if(!marker){marker=L.marker(latLng,{icon:icon(stateName),keyboard:false,zIndexOffset:1200,title:`${title} · tap to zoom in`}).addTo(locationLayer);marker.bindTooltip(`${title} · tap to zoom in`);marker.on('click',zoomToLocation);}
    else{marker.setLatLng(latLng);marker.setIcon(icon(stateName));}
    const markerTitle=`${title} · tap to zoom in`;marker.setOpacity(lastKnown?0.68:1);marker.setTooltipContent(`${markerTitle} · ±${Math.round(fix.accuracy)}m`);marker.options.title=markerTitle;marker.getElement?.()?.setAttribute('title',markerTitle);
    if(!accuracyCircle)accuracyCircle=L.circle(latLng,{radius:Math.max(3,fix.accuracy),color:circleColor,weight:1,opacity:.65,fillColor:circleColor,fillOpacity:.10,interactive:false}).addTo(locationLayer);
    else{accuracyCircle.setLatLng(latLng);accuracyCircle.setRadius(Math.max(3,fix.accuracy));accuracyCircle.setStyle({color:circleColor,fillColor:circleColor});}
    accuracyText(fix,lastKnown);
  }
  function acceptFix(fix){
    pendingJump=null;gpsErrorReason=null;lastAccepted=fix;showFix(fix,'live');statusText('Current location · updated now. This marker exists only in your browser.','live');scheduleFreshness();
    if(follow)map.panTo([fix.lat,fix.lng],{animate:true,duration:.35});
  }
  function showLastKnown(fix,message){
    pendingJump=null;lastAccepted=fix;showFix(fix,'signal_lost');statusText(message,'signal_lost');setFollow(false);scheduleFreshness();
  }
  function receiveFix(raw){
    if(!activeSession())return;
    const decision=core.evaluateFix(lastAccepted,pendingJump,raw);
    if(decision.action==='reject')return;
    if(decision.action==='expired'){clearLocation({message:'Location marker hidden because the last GPS fix is more than 2 minutes old.'});return;}
    if(decision.action==='last_known'){gpsErrorReason=null;showLastKnown(decision.fix,`GPS is not current · showing a fix from ${Math.ceil(decision.freshness.ageMs/1000)}s ago.`);return;}
    if(decision.action==='pending'){
      pendingJump=decision.pending;if(lastAccepted){showFix(lastAccepted,'signal_lost');accuracyText(lastAccepted,true);}setFollow(false);statusText('GPS jump rejected · keeping your last known position until another fix confirms it.','signal_lost');scheduleFreshness();return;
    }
    acceptFix(decision.fix);
  }
  function gpsErrorMessage(reason,ageSeconds){
    const age=Number.isFinite(ageSeconds)?` Last fix: ${ageSeconds}s ago.`:'';
    if(reason==='permission_denied')return`Location permission is off. The marker is not live.${age}`;
    if(reason==='timeout')return`GPS timed out. The marker is not live.${age}`;
    return`GPS position is unavailable. The marker is not live.${age}`;
  }
  function receiveError(detail={}){
    if(!activeSession())return;gpsErrorReason=detail.reason||core.geolocationErrorReason(detail);pendingJump=null;setFollow(false);
    if(lastAccepted){const age=Math.ceil(core.freshness(lastAccepted).ageMs/1000);showFix(lastAccepted,'signal_lost');statusText(gpsErrorMessage(gpsErrorReason,age),'signal_lost');accuracyText(lastAccepted,true);scheduleFreshness();}
    else{statusText(gpsErrorMessage(gpsErrorReason),'signal_lost');accuracyText(null);}
  }
  function refreshFreshness(){
    if(!activeSession()){if(marker||lastAccepted)clearLocation();return;}
    if(!lastAccepted){statusText(gpsErrorReason?gpsErrorMessage(gpsErrorReason):'Field session active · waiting for a usable location fix…',gpsErrorReason?'signal_lost':'inactive');accuracyText(null);return;}
    const fresh=core.freshness(lastAccepted);
    if(fresh.state==='expired'){clearLocation({message:'Location marker hidden because the last GPS fix is more than 2 minutes old.'});return;}
    if(gpsErrorReason){showFix(lastAccepted,'signal_lost');statusText(gpsErrorMessage(gpsErrorReason,Math.ceil(fresh.ageMs/1000)),'signal_lost');accuracyText(lastAccepted,true);return;}
    if(pendingJump){showFix(lastAccepted,'signal_lost');statusText('GPS jump rejected · keeping your last known position until another fix confirms it.','signal_lost');accuracyText(lastAccepted,true);return;}
    if(fresh.state==='live'){showFix(lastAccepted,'live');statusText(`Current location · updated ${Math.ceil(fresh.ageMs/1000)}s ago. This marker exists only in your browser.`,'live');accuracyText(lastAccepted,false);return;}
    showFix(lastAccepted,'signal_lost');statusText(`GPS signal interrupted · showing a fix from ${Math.ceil(fresh.ageMs/1000)}s ago. The marker is not live.`,'signal_lost');accuracyText(lastAccepted,true);setFollow(false);
  }

  followButton.addEventListener('click',()=>{
    if(!activeSession()){clearLocation();return;}
    if(!lastAccepted&&state.latestGps)receiveFix(state.latestGps);
    const fresh=lastAccepted?core.freshness(lastAccepted):null;
    if(!lastAccepted||fresh?.state!=='live'||gpsErrorReason||pendingJump){setFollow(false);statusText('A current GPS fix is required before the map can follow you.','signal_lost');window.requestFreshGpsInBackground?.();return;}
    setFollow(!follow);if(follow)map.setView([lastAccepted.lat,lastAccepted.lng],Math.max(map.getZoom(),17),{animate:true});
  });
  map.on('dragstart',()=>{if(follow){setFollow(false);statusText('Current location is still available. Follow paused because you moved the map.','live');}});
  window.addEventListener('mccoy-gps-update',event=>receiveFix(event.detail?.gps));
  window.addEventListener('mccoy-gps-error',event=>receiveError(event.detail));
  window.addEventListener('mccoy-field-session-started',()=>{clearLocation({message:'Field session active · waiting for a usable location fix…'});if(state.latestGps)receiveFix(state.latestGps);});
  window.addEventListener('mccoy-field-session-ended',()=>clearLocation());
  window.addEventListener('pageshow',()=>{if(activeSession()&&state.latestGps)receiveFix(state.latestGps);refreshFreshness();scheduleFreshness();});
  window.addEventListener('pagehide',clearFreshnessTimer);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'){clearFreshnessTimer();return;}if(activeSession()&&state.latestGps)receiveFix(state.latestGps);refreshFreshness();scheduleFreshness();});
  if(activeSession()&&state.latestGps)receiveFix(state.latestGps);else refreshFreshness();
  window.MCCOY_LIVE_LOCATION_MAP={receiveFix,receiveError,refresh:refreshFreshness,clear:clearLocation,zoom:zoomToLocation,isFollowing:()=>follow};
})();
