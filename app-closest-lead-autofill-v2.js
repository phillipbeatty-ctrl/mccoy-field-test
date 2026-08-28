// Fill an empty Sales Hub Lead or Service Address with the closest active lead
// in the signed-in user's organization, regardless of assignment.
(function(){
  if(window.MCCOY_CLOSEST_LEAD_AUTOFILL_V2)return;
  window.MCCOY_CLOSEST_LEAD_AUTOFILL_V2=true;

  const byId=id=>document.getElementById(id);
  const state={busy:false,lastRun:0,lastLat:null,lastLng:null,lastLead:null,timer:null};

  function labelledAddressInput(){
    const labels=[...document.querySelectorAll('#field label')];
    const label=labels.find(item=>/lead\s+or\s+service\s+address/i.test(item.textContent||''));
    return label?.querySelector('input,textarea')||null;
  }

  function addressInput(){
    return byId('leadOrServiceAddress')
      ||byId('leadOrServiceAddressInput')
      ||byId('fieldServiceAddress')
      ||byId('fieldServiceAddressInput')
      ||byId('fieldAddressInput')
      ||byId('typedLeadAddress')
      ||byId('typedLeadAddressInput')
      ||byId('adHocLeadAddress')
      ||labelledAddressInput()
      ||document.querySelector('#field input[placeholder*="lead or service address" i],#field input[aria-label*="lead or service address" i],#field input[placeholder*="service address" i],#field input[aria-label*="service address" i]');
  }

  function hasManualAddress(){
    const input=addressInput();
    if(input)return !!String(input.value||'').trim();
    const select=byId('fieldLeadSelect');
    if(!select)return false;
    const option=select.selectedOptions?.[0];
    const value=String(select.value||'').trim();
    const text=String(option?.textContent||'').trim();
    return !!value&&!/select|choose|type|lead or service address/i.test(text);
  }

  function currentCoordinates(){
    const candidates=[];
    try{candidates.push(window.MCCOY_DISTANCE_TO_LEAD_CONTROL?.current?.()?.rep_location);}catch(_){}
    try{candidates.push(window.MCCOY_DISTANCE_TO_LEAD_CONTROL?.current?.()?.gps);}catch(_){}
    candidates.push(window.MCCOY_LAST_GPS,window.MCCOY_LATEST_GPS,window.state?.latestGps,window.MCCOY_LIVE_LOCATION?.latest);
    for(const value of candidates){
      const lat=Number(value?.latitude??value?.lat),lng=Number(value?.longitude??value?.lng);
      if(Number.isFinite(lat)&&lat>=-90&&lat<=90&&Number.isFinite(lng)&&lng>=-180&&lng<=180)return{lat,lng};
    }
    return null;
  }

  function getGpsOnce(){
    const existing=currentCoordinates();if(existing)return Promise.resolve(existing);
    if(!navigator.geolocation)return Promise.resolve(null);
    return new Promise(resolve=>navigator.geolocation.getCurrentPosition(
      position=>resolve({lat:Number(position.coords.latitude),lng:Number(position.coords.longitude)}),
      ()=>resolve(null),
      {enableHighAccuracy:true,maximumAge:30000,timeout:6500}
    ));
  }

  function distanceBetween(aLat,aLng,bLat,bLng){
    const toRad=value=>value*Math.PI/180;
    const dLat=toRad(bLat-aLat),dLng=toRad(bLng-aLng);
    const a=Math.sin(dLat/2)**2+Math.cos(toRad(aLat))*Math.cos(toRad(bLat))*Math.sin(dLng/2)**2;
    return 2*6371000*Math.asin(Math.min(1,Math.sqrt(a)));
  }

  function setClosestDisplay(lead){
    const display=byId('closestDoorAddress');if(!display||!lead?.address)return;
    const meters=Number(lead.distance_meters);
    const distance=Number.isFinite(meters)?meters<1609?`${Math.round(meters)} m`:`${(meters/1609.344).toFixed(2)} mi`:'';
    display.textContent=`Closest McCoy lead${distance?` · ${distance}`:''} · ${lead.address}`;
    display.dataset.mccoyClosestLeadId=lead.id||'';
  }

  function selectExistingLeadOption(lead){
    const select=byId('fieldLeadSelect');if(!select)return false;
    const address=String(lead.address||'').trim().toLowerCase();
    const id=String(lead.id||'');
    const option=[...select.options].find(item=>String(item.value||'')===id||String(item.textContent||'').trim().toLowerCase().includes(address));
    if(!option)return false;
    select.value=option.value;
    select.dataset.mccoyAutoClosest='1';
    select.dispatchEvent(new Event('change',{bubbles:true}));
    return true;
  }

  function applyLead(lead){
    if(!lead?.address||hasManualAddress())return false;
    const input=addressInput();
    if(input){
      input.value=lead.address;
      input.dataset.mccoyAutoClosest='1';
      input.dataset.mccoyClosestLeadId=lead.id||'';
      input.dispatchEvent(new Event('input',{bubbles:true}));
      input.dispatchEvent(new Event('change',{bubbles:true}));
    }else selectExistingLeadOption(lead);
    window.MCCOY_CLOSEST_MCCOY_LEAD=lead;
    setClosestDisplay(lead);
    window.dispatchEvent(new CustomEvent('mccoy-closest-lead-autofilled',{detail:{lead}}));
    return true;
  }

  async function run({force=false,allowGpsPrompt=false}={}){
    if(state.busy||!window.sb?.rpc||!window.MCCOY_ACCESS?.access?.active||hasManualAddress())return;
    const now=Date.now();
    let gps=currentCoordinates();
    if(!gps&&allowGpsPrompt)gps=await getGpsOnce();
    if(!gps)return;
    const moved=state.lastLat==null?Infinity:distanceBetween(state.lastLat,state.lastLng,gps.lat,gps.lng);
    if(!force&&now-state.lastRun<15000&&moved<25){if(state.lastLead)applyLead(state.lastLead);return;}
    state.busy=true;
    try{
      const {data,error}=await sb.rpc('get_closest_mccoy_lead',{p_lat:gps.lat,p_lng:gps.lng});
      if(error)throw error;
      state.lastRun=now;state.lastLat=gps.lat;state.lastLng=gps.lng;state.lastLead=data||null;
      if(data?.address)applyLead(data);
      else{const display=byId('closestDoorAddress');if(display)display.textContent='No mapped McCoy lead was found near the current location.';}
    }catch(error){console.error('Closest McCoy lead auto-fill failed',error);}
    finally{state.busy=false;}
  }

  function schedule(options={}){clearTimeout(state.timer);state.timer=setTimeout(()=>run(options),120);}

  document.addEventListener('input',event=>{
    const input=addressInput();if(!input||event.target!==input)return;
    if(event.isTrusted){
      if(String(input.value||'').trim())delete input.dataset.mccoyAutoClosest;
      else{delete input.dataset.mccoyAutoClosest;schedule({force:true,allowGpsPrompt:false});}
    }
  },true);
  document.addEventListener('click',event=>{
    if(event.target?.closest?.('#startKnockingBtn,.nav-btn[data-view="field"]'))schedule({force:true,allowGpsPrompt:true});
    if(event.target?.closest?.('#customerRefresh,#leadRefreshBtn,#salesRefreshBtn'))schedule({force:true,allowGpsPrompt:false});
  },true);
  for(const name of ['mccoy-access-ready','mccoy-sales-hub-layout-ready','mccoy-leads-updated','mccoy-lead-pool-changed','mccoy-location-updated','mccoy-live-location-updated'])window.addEventListener(name,()=>schedule({force:name!=='mccoy-location-updated',allowGpsPrompt:false}));
  window.addEventListener('mccoy-door-visit-completed',()=>schedule({force:true,allowGpsPrompt:false}));
  [250,700,1500,3000].forEach(delay=>setTimeout(()=>run({force:delay===3000,allowGpsPrompt:false}),delay));
})();
