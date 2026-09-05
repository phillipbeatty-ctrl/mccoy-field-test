// Shared map viewport ownership. MOVE PIN may update markers and GPS state,
// but automatic camera movement and workflow-target changes are blocked until it ends.
(()=>{
  if(window.MCCOY_MAP_VIEWPORT_LOCK)return;

  let owner=null;
  let snapshot=null;
  let lockedLeadId=null;
  let boundMap=null;
  const originalCameraMethods={};

  const mapApi=()=>window.MCCOY_LEAD_MAP?.map||null;
  const isMovePinOwner=()=>owner==='move-pin';
  const sameLead=id=>String(id??'')===String(lockedLeadId??'');

  function stopLocationFollow(){
    const button=document.getElementById('followMyLocationBtn');
    if(button?.getAttribute('aria-pressed')==='true')button.click();
    if(button){button.setAttribute('aria-pressed','false');button.textContent='MY LOCATION';}
  }

  function install(){
    const map=mapApi();
    if(!map||map===boundMap)return Boolean(map);
    boundMap=map;
    for(const name of ['setView','panTo','fitBounds','flyTo','flyToBounds']){
      if(typeof map[name]!=='function')continue;
      originalCameraMethods[name]=map[name].bind(map);
      map[name]=function(...args){
        if(isMovePinOwner())return this;
        return originalCameraMethods[name](...args);
      };
    }
    return true;
  }

  function acquire(nextOwner='move-pin',leadId=null){
    install();
    if(owner===nextOwner){
      if(leadId!=null&&lockedLeadId==null)lockedLeadId=String(leadId);
      return snapshot;
    }
    stopLocationFollow();
    const map=mapApi();
    owner=nextOwner;
    lockedLeadId=leadId==null?null:String(leadId);
    snapshot=map?{center:map.getCenter?.(),zoom:map.getZoom?.()}:null;
    map?.stop?.();
    window.dispatchEvent(new CustomEvent('mccoy-map-viewport-lock-changed',{detail:{owner,locked:true,leadId:lockedLeadId,snapshot}}));
    return snapshot;
  }

  function release(expectedOwner){
    if(expectedOwner&&owner!==expectedOwner)return false;
    const previous=owner,previousLeadId=lockedLeadId;
    owner=null;
    lockedLeadId=null;
    snapshot=null;
    window.dispatchEvent(new CustomEvent('mccoy-map-viewport-lock-changed',{detail:{owner:null,locked:false,previous,previousLeadId}}));
    return true;
  }

  function locked(){return Boolean(owner);}

  document.addEventListener('click',event=>{
    if(!isMovePinOwner())return;
    if(event.target?.closest?.('#followMyLocationBtn')){
      event.preventDefault();
      event.stopImmediatePropagation();
      const button=document.getElementById('followMyLocationBtn');
      if(button){button.setAttribute('aria-pressed','false');button.textContent='MY LOCATION';}
    }
  },true);

  window.addEventListener('mccoy-lead-map-window-mode-changed',event=>{
    const mode=event.detail?.mode,leadId=event.detail?.leadId;
    if(mode==='move-pin-ready'||mode==='move-pin')acquire('move-pin',leadId);
    else if(owner==='move-pin')release('move-pin');
  });
  window.addEventListener('mccoy-map-move-pin-ended',()=>release('move-pin'));
  window.addEventListener('pagehide',()=>release('move-pin'));

  window.MCCOY_MAP_VIEWPORT_LOCK={
    acquire,
    release,
    locked,
    owner:()=>owner,
    leadId:()=>lockedLeadId,
    protectsLead:id=>isMovePinOwner()&&sameLead(id),
    blocksSelection:id=>isMovePinOwner()&&!sameLead(id),
    snapshot:()=>snapshot,
    blocksAutomaticCamera:()=>isMovePinOwner(),
    install
  };

  [0,100,300,800,1600].forEach(delay=>setTimeout(install,delay));
})();
