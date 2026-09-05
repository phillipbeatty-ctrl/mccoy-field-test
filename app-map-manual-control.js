// Keep Lead Pool map navigation manual during an active field session.
// MY LOCATION performs a one-time center. It never leaves continuous follow enabled.
(()=>{
  if(window.MCCOY_MAP_MANUAL_CONTROL)return;
  window.MCCOY_MAP_MANUAL_CONTROL=true;
  if(typeof window.MCCOY_MAP_MANUAL_VIEWPORT_HOLD!=='boolean')window.MCCOY_MAP_MANUAL_VIEWPORT_HOLD=false;

  let syntheticLocationClick=false;
  let mapBound=false;

  const activeSession=()=>Boolean(window.state?.session);
  const locationButton=()=>document.getElementById('followMyLocationBtn');

  function pauseLocationFollow(message='Map follow is off. MY LOCATION will center once when pressed.'){
    const button=locationButton();
    if(!button)return;
    if(button.getAttribute('aria-pressed')==='true'){
      syntheticLocationClick=true;
      button.click();
      syntheticLocationClick=false;
    }
    button.setAttribute('aria-pressed','false');
    button.textContent='MY LOCATION';
    const label=document.getElementById('liveLocationStateText');
    if(label&&activeSession())label.textContent=message;
  }

  function setManualViewportHold(held){
    window.MCCOY_MAP_MANUAL_VIEWPORT_HOLD=Boolean(held);
    window.dispatchEvent(new CustomEvent('mccoy-map-manual-viewport-hold-changed',{detail:{held:Boolean(held)}}));
  }

  function bindLocationButton(){
    const button=locationButton();
    if(!button||button.dataset.mccoyOneShotLocation==='1')return;
    button.dataset.mccoyOneShotLocation='1';
    button.title='Center once on your current location. The map will not keep following you.';
    button.addEventListener('click',()=>{
      if(syntheticLocationClick)return;
      setTimeout(()=>{
        if(button.getAttribute('aria-pressed')==='true')pauseLocationFollow('Location centered once. Move or tap the map freely; it will stay where you leave it.');
        else{
          button.textContent='MY LOCATION';
          button.setAttribute('aria-pressed','false');
        }
        setManualViewportHold(true);
      },0);
    },true);
  }

  function bindMap(){
    const map=window.MCCOY_LEAD_MAP?.map;
    if(!map||mapBound)return;
    mapBound=true;
    const userMoved=()=>{
      setManualViewportHold(true);
      pauseLocationFollow('Current location remains available. Map movement is manual until MY LOCATION is pressed again.');
    };
    for(const eventName of ['mousedown','touchstart','dragstart','zoomstart'])map.on(eventName,userMoved);
    map.on('click',event=>{
      const target=event?.originalEvent?.target;
      if(target?.closest?.('.lead-house-icon,.mccoy-live-location-icon,.mccoy-lead-cluster'))return;
      userMoved();
    });
  }

  function init(){bindLocationButton();bindMap();}

  window.addEventListener('mccoy-field-session-started',()=>{
    setTimeout(()=>{init();pauseLocationFollow();},0);
  });
  window.addEventListener('mccoy-field-session-ended',()=>setTimeout(init,0));
  window.addEventListener('mccoy-real-leads-loaded',()=>setTimeout(init,0));
  document.addEventListener('click',event=>{
    if(event.target.closest?.('#followMyLocationBtn'))setTimeout(bindLocationButton,0);
    if(event.target.closest?.('#fitAllPinsBtn'))setManualViewportHold(true);
    const leadNav=event.target.closest?.('.nav-btn[data-view="leads"],#leadMapView');
    if(leadNav)setManualViewportHold(false);
  },true);

  [0,100,300,800,1600,3000].forEach(delay=>setTimeout(init,delay));
})();
