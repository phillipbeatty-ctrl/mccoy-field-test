// Shared map viewport ownership. MOVE PIN may update markers and GPS state,
// but automatic camera movement is blocked until the workflow ends.
(()=>{
  if(window.MCCOY_MAP_VIEWPORT_LOCK)return;

  let owner=null;
  let snapshot=null;
  let boundMap=null;
  let originalPanTo=null;
  let originalFitBounds=null;

  const mapApi=()=>window.MCCOY_LEAD_MAP?.map||null;
  const isMovePinOwner=()=>owner==='move-pin';

  function stopLocationFollow(){
    const button=document.getElementById('followMyLocationBtn');
    if(button?.getAttribute('aria-pressed')==='true')button.click();
    if(button){button.setAttribute('aria-pressed','false');button.textContent='MY LOCATION';}
  }

  function install(){
    const map=mapApi();
    if(!map||map===boundMap)return Boolean(map);
    boundMap=map;
    originalPanTo=map.panTo.bind(map);
    originalFitBounds=map.fitBounds.bind(map);

    map.panTo=function(...args){
      if(isMovePinOwner())return this;
      return originalPanTo(...args);
    };
    map.fitBounds=function(...args){
      if(isMovePinOwner())return this;
      return originalFitBounds(...args);
    };
    return true;
  }

  function acquire(nextOwner='move-pin'){
    install();
    if(owner===nextOwner)return snapshot;
    const map=mapApi();
    owner=nextOwner;
    snapshot=map?{center:map.getCenter?.(),zoom:map.getZoom?.()}:null;
    map?.stop?.();
    stopLocationFollow();
    window.dispatchEvent(new CustomEvent('mccoy-map-viewport-lock-changed',{detail:{owner,locked:true,snapshot}}));
    return snapshot;
  }

  function release(expectedOwner){
    if(expectedOwner&&owner!==expectedOwner)return false;
    const previous=owner;
    owner=null;
    snapshot=null;
    window.dispatchEvent(new CustomEvent('mccoy-map-viewport-lock-changed',{detail:{owner:null,locked:false,previous}}));
    return true;
  }

  function locked(){return Boolean(owner);}

  document.addEventListener('click',event=>{
    if(!isMovePinOwner())return;
    if(event.target?.closest?.('#followMyLocationBtn')){
      event.preventDefault();
      event.stopImmediatePropagation();
      stopLocationFollow();
    }
  },true);

  window.addEventListener('mccoy-lead-map-window-mode-changed',event=>{
    const mode=event.detail?.mode;
    if(mode==='move-pin-ready'||mode==='move-pin')acquire('move-pin');
    else if(owner==='move-pin')release('move-pin');
  });
  window.addEventListener('mccoy-map-move-pin-ended',()=>release('move-pin'));
  window.addEventListener('pagehide',()=>release('move-pin'));

  window.MCCOY_MAP_VIEWPORT_LOCK={
    acquire,
    release,
    locked,
    owner:()=>owner,
    snapshot:()=>snapshot,
    blocksAutomaticCamera:()=>isMovePinOwner(),
    install
  };

  [0,100,300,800,1600].forEach(delay=>setTimeout(install,delay));
})();
