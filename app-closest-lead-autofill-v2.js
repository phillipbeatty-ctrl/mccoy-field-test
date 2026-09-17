// Fill an empty Sales Hub Lead or Service Address with the closest active lead
// in the signed-in user's organization, regardless of assignment.
(function(){
  if(window.MCCOY_FIELD_FEATURES?.automaticNearestLead!==true)return;
  if(window.MCCOY_CLOSEST_LEAD_AUTOFILL_V2)return;
  window.MCCOY_CLOSEST_LEAD_AUTOFILL_V2=true;

  const byId=id=>document.getElementById(id);
  const state={busy:false,lastRun:0,lastLat:null,lastLng:null,lastLead:null,timer:null};

  function labelledAddressInput(){
    const labels=[...document.querySelectorAll('#field label')];
    const label=labels.find(item=>/(lead\s+or\s+)?service\s+address/i.test(item.textContent||''));
    return label?.querySelector('input,textarea')||null;
  }

  function addressInput(){
    return byId('fieldLeadAddressInput')
      ||labelledAddressInput()
      ||document.querySelector('#field input[placeholder*="service address" i],#field input[aria-label*="service address" i]');
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

  function getGpsOnce(){
    if(!navigator.geolocation)return Promise.resolve(null);
    return new Promise(resolve=>{
      const readings=[];let watchId=null,settled=false;
      const weightedAverage=()=>{
        if(!readings.length)return null;
        let sumWeight=0,sumLat=0,sumLng=0,sumInverseVar=0;
        for(const r of readings){
          const variance=Math.max(r.accuracy,1)**2,weight=1/variance;
          sumWeight+=weight;sumLat+=r.lat*weight;sumLng+=r.lng*weight;sumInverseVar+=weight;
        }
        return {lat:sumLat/sumWeight,lng:sumLng/sumWeight,accuracy:1/Math.sqrt(sumInverseVar),sampleCount:readings.length};
      };
      const finish=()=>{
        if(settled)return;settled=true;
        if(watchId!=null)navigator.geolocation.clearWatch(watchId);
        resolve(weightedAverage());
      };
      const timeoutId=setTimeout(finish,10000);
      watchId=navigator.geolocation.watchPosition(
        position=>{
          readings.push({lat:Number(position.coords.latitude),lng:Number(position.coords.longitude),accuracy:Number(position.coords.accuracy)||50});
          if(readings.length>=6){clearTimeout(timeoutId);finish();}
        },
        ()=>{},
        {enableHighAccuracy:true,maximumAge:0,timeout:10000}
      );
    });
  }

  function distanceBetween(aLat,aLng,bLat,bLng){
    const toRad=value=>value*Math.PI/180;
    const dLat=toRad(bLat-aLat),dLng=toRad(bLng-aLng);
    const a=Math.sin(dLat/2)**2+Math.cos(toRad(aLat))*Math.cos(toRad(bLat))*Math.sin(dLng/2)**2;
    return 2*6371000*Math.asin(Math.min(1,Math.sqrt(a)));
  }

  function setClosestDisplay(lead,accuracyMeters){
    const display=byId('closestDoorAddress');if(!display||!lead?.address)return;
    const meters=Number(lead.distance_meters);
    const distance=Number.isFinite(meters)?meters<1609?`${Math.round(meters)} m`:`${(meters/1609.344).toFixed(2)} mi`:'';
    const confidence=Number.isFinite(accuracyMeters)?` · GPS ±${Math.round(accuracyMeters*3.28084)}ft`:'';
    display.textContent=`Closest address${distance?` · ${distance}`:''} · ${lead.address}${confidence}`;
    display.dataset.mccoyClosestLeadId=lead.id||'';
  }

  const autoNearestEnabled=()=>window.MCCOY_FIELD_FEATURES?.automaticNearestLead===true;
  function applyLead(lead){
    if(!autoNearestEnabled())return false;
    if(!lead?.address||hasManualAddress())return false;
    const input=addressInput();
    if(!input){console.warn('Nearest-address autofill: service address field not found; not falling back to a lead-pool match.');return false;}
    input.value=lead.address;
    input.dataset.mccoyAutoClosest='1';
    input.dataset.mccoyClosestLeadId=lead.id||'';
    input.dispatchEvent(new Event('input',{bubbles:true}));
    input.dispatchEvent(new Event('change',{bubbles:true}));
    window.MCCOY_CLOSEST_MCCOY_LEAD=lead;
    setClosestDisplay(lead,lead.accuracyMeters);
    window.dispatchEvent(new CustomEvent('mccoy-closest-lead-autofilled',{detail:{lead}}));
    return true;
  }

  const MAX_TRUSTED_ACCURACY_METERS=150;

  async function run({force=false}={}){
    if(!autoNearestEnabled())return;
    if(state.busy||!window.sb?.functions||!window.MCCOY_ACCESS?.access?.active||hasManualAddress())return;
    state.busy=true;
    try{
      const now=Date.now();
      const gps=await getGpsOnce();
      if(!gps||!autoNearestEnabled())return;
      if(Number.isFinite(gps.accuracy)&&gps.accuracy>MAX_TRUSTED_ACCURACY_METERS){
        const display=byId('closestDoorAddress');
        if(display)display.textContent=`Location signal too weak to auto-fill (accuracy ~${Math.round(gps.accuracy)}m / ${Math.round(gps.accuracy*3.28084)}ft). Please type or select the address.`;
        return;
      }
      const moved=state.lastLat==null?Infinity:distanceBetween(state.lastLat,state.lastLng,gps.lat,gps.lng);
      if(!force&&now-state.lastRun<15000&&moved<25){if(state.lastLead)applyLead(state.lastLead);return;}
      const {data,error}=await sb.functions.invoke('reverse-geocode-nearest-address',{body:{lat:gps.lat,lng:gps.lng,accuracy:gps.accuracy}});
      if(error)throw error;
      state.lastRun=now;state.lastLat=gps.lat;state.lastLng=gps.lng;
      if(data?.ambiguous){
        state.lastLead=null;
        const display=byId('closestDoorAddress');
        if(display){
          const list=(data.candidates||[]).map(c=>`${c.address} (~${Math.round(c.distance_meters*3.28084)}ft)`).join('  ·  ');
          display.textContent=`Multiple known addresses are within GPS range (±${Math.round((gps.accuracy||0)*3.28084)}ft) -- confirm which one before entering the order: ${list}`;
        }
        return;
      }
      const lead=data?.address?{id:data.google_place_id||'',address:data.address,distance_meters:null,accuracyMeters:gps.accuracy}:null;
      state.lastLead=lead;
      if(lead)applyLead(lead);
      else{const display=byId('closestDoorAddress');if(display)display.textContent='No nearby address was found.';}
    }catch(error){console.error('Nearest address auto-fill failed',error);}
    finally{state.busy=false;}
  }

  function schedule(options={}){clearTimeout(state.timer);if(!autoNearestEnabled())return;state.timer=setTimeout(()=>run(options),120);}

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
  [250,700,1500,3000].forEach(delay=>setTimeout(()=>run({force:delay===3000}),delay));
})();
