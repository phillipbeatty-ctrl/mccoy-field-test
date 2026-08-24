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
    #followMyLocationBtn[aria-pressed="true"]{background:#1455d9;color:#fff;border-color:#1455d9}
  `;
  document.head.appendChild(css);

  const buttonRow=controls.querySelector('div');
  const followButton=document.createElement('button');followButton.id='followMyLocationBtn';followButton.type='button';followButton.className='assign-btn';followButton.textContent='MY LOCATION';followButton.setAttribute('aria-pressed','false');followButton.title='Center the map on your live field-session location';buttonRow?.appendChild(followButton);
  const status=document.createElement('div');status.id='liveLocationStatus';status.className='muted small';status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.dataset.state='inactive';status.innerHTML='<span class="live-location-dot" aria-hidden="true"></span><span>Start Knocking to show your live location. Only you see this map marker.</span>';controls.appendChild(status);

  const locationLayer=L.layerGroup().addTo(map);
  const icon=stateName=>L.divIcon({className:`mccoy-live-location-icon${stateName==='signal_lost'?' signal-lost':''}`,html:'<div class="live-location-pin" aria-hidden="true"></div>',iconSize:[32,32],iconAnchor:[16,16],tooltipAnchor:[0,-18]});
  let marker=null,accuracyCircle=null,trailLine=null,lastAccepted=null,lastTrailPoint=null,pendingJump=null,follow=false,trail=[];

  function activeSession(){return Boolean(state?.session);}
  function statusText(text,stateName='inactive'){
    status.dataset.state=stateName;const label=status.querySelector('span:last-child');if(label)label.textContent=text;
  }
  function setFollow(on){
    follow=Boolean(on);followButton.setAttribute('aria-pressed',String(follow));followButton.textContent=follow?'FOLLOWING ME':'MY LOCATION';
  }
  function clearLocation({clearTrail=true,message='Start Knocking to show your live location. Only you see this map marker.'}={}){
    if(marker){locationLayer.removeLayer(marker);marker=null;}if(accuracyCircle){locationLayer.removeLayer(accuracyCircle);accuracyCircle=null;}
    if(clearTrail&&trailLine){locationLayer.removeLayer(trailLine);trailLine=null;}if(clearTrail){trail=[];lastTrailPoint=null;lastAccepted=null;pendingJump=null;}
    setFollow(false);statusText(message,'inactive');
  }
  function appendTrail(fix){
    if(!core.shouldAppendTrail(lastTrailPoint,fix))return;lastTrailPoint=fix;trail.push([fix.lat,fix.lng]);if(trail.length>120)trail.shift();
    if(!trailLine)trailLine=L.polyline(trail,{color:'#2563eb',weight:3,opacity:.55,dashArray:'5 7',interactive:false}).addTo(locationLayer);else trailLine.setLatLngs(trail);
  }
  function showFix(fix,stateName='live'){
    const latLng=[fix.lat,fix.lng],circleColor=stateName==='signal_lost'?'#d97706':'#2563eb';
    if(!marker){marker=L.marker(latLng,{icon:icon(stateName),keyboard:false,zIndexOffset:1200,title:'Your live location'}).addTo(locationLayer);marker.bindTooltip('Your live location');}
    else{marker.setLatLng(latLng);marker.setIcon(icon(stateName));}
    marker.setOpacity(stateName==='signal_lost'?0.68:1);marker.setTooltipContent(`Your ${stateName==='signal_lost'?'last known':'live'} location · ±${Math.round(fix.accuracy)}m`);
    if(!accuracyCircle)accuracyCircle=L.circle(latLng,{radius:Math.max(3,fix.accuracy),color:circleColor,weight:1,opacity:.65,fillColor:circleColor,fillOpacity:.10,interactive:false}).addTo(locationLayer);
    else{accuracyCircle.setLatLng(latLng);accuracyCircle.setRadius(Math.max(3,fix.accuracy));accuracyCircle.setStyle({color:circleColor,fillColor:circleColor});}
  }
  function acceptFix(fix){
    pendingJump=null;lastAccepted=fix;appendTrail(fix);showFix(fix,'live');statusText(`Live location · accuracy ±${Math.round(fix.accuracy)}m · updated now. Only you see this map marker.`,'live');
    if(follow){map.panTo([fix.lat,fix.lng],{animate:true,duration:.35});}
  }
  function receiveFix(raw){
    if(!activeSession())return;const fix=core.normalizeGps(raw);if(!fix)return;
    if(pendingJump){if(core.confirmsJump(pendingJump,fix)){acceptFix(fix);return;}pendingJump=fix;statusText('Checking an unstable GPS jump before moving your map marker…','signal_lost');return;}
    if(lastAccepted&&core.isImplausibleJump(lastAccepted,fix)){pendingJump=fix;statusText('Checking an unstable GPS jump before moving your map marker…','signal_lost');return;}
    acceptFix(fix);
  }
  function refreshFreshness(){
    if(!activeSession()){if(marker||lastAccepted)clearLocation();return;}
    if(!lastAccepted){statusText('Field session active · waiting for a usable location fix…','inactive');return;}
    const fresh=core.freshness(lastAccepted);
    if(fresh.state==='live')return;
    if(fresh.state==='signal_lost'){
      showFix(lastAccepted,'signal_lost');statusText(`GPS signal interrupted · showing last fix from ${Math.ceil(fresh.ageMs/1000)}s ago (±${Math.round(lastAccepted.accuracy)}m).`,'signal_lost');return;
    }
    clearLocation({clearTrail:false,message:'Live location hidden because the last GPS fix is more than 2 minutes old.'});
  }

  followButton.addEventListener('click',()=>{
    if(!activeSession()){clearLocation();return;}
    if(!lastAccepted&&state.latestGps)receiveFix(state.latestGps);
    if(!lastAccepted){statusText('Waiting for a usable GPS fix before centering the map…','inactive');window.requestFreshGpsInBackground?.();return;}
    setFollow(!follow);if(follow)map.setView([lastAccepted.lat,lastAccepted.lng],Math.max(map.getZoom(),17),{animate:true});
  });
  map.on('dragstart',()=>{if(follow){setFollow(false);statusText(`Live location · accuracy ±${Math.round(lastAccepted?.accuracy||0)}m. Follow paused because you moved the map.`,'live');}});
  window.addEventListener('mccoy-gps-update',event=>receiveFix(event.detail?.gps));
  window.addEventListener('mccoy-field-session-started',()=>{clearLocation({message:'Field session active · waiting for a usable location fix…'});if(state.latestGps)receiveFix(state.latestGps);});
  window.addEventListener('mccoy-field-session-ended',()=>clearLocation());
  window.addEventListener('pageshow',()=>{if(activeSession()&&state.latestGps)receiveFix(state.latestGps);refreshFreshness();});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){if(activeSession()&&state.latestGps)receiveFix(state.latestGps);refreshFreshness();}});
  const freshnessTimer=setInterval(refreshFreshness,5_000);window.addEventListener('pagehide',()=>clearInterval(freshnessTimer));
  if(activeSession()&&state.latestGps)receiveFix(state.latestGps);
  window.MCCOY_LIVE_LOCATION_MAP={receiveFix,refresh:refreshFreshness,clear:clearLocation,isFollowing:()=>follow};
})();
