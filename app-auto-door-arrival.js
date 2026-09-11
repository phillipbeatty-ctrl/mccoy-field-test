// Automatically record ARRIVED AT DOOR only when both the door coordinates and
// the browser location meet a strict, high-confidence 5 ft ±2 ft boundary.
(()=>{
  if(window.MCCOY_FIELD_FEATURES?.automaticNearestLead!==true)return;
  if(window.MCCOY_DISTANCE_TO_LEAD_CONTROL)return;
  if(window.MCCOY_AUTO_DOOR_ARRIVAL)return;
  window.MCCOY_AUTO_DOOR_ARRIVAL=true;

  const MAX_CONFIDENT_DISTANCE_METERS=7/3.28084;
  const MAX_FIX_AGE_MS=5000;
  const REQUIRED_CONSECUTIVE_FIXES=2;
  const verifiedStatuses=new Set(['manual','field_verified']);
  const autoArrivedLeadIds=new Set();
  let observedSessionStart=null,lastFixAt=0,candidateId=null,candidateHits=0;

  function metersBetween(lat1,lng1,lat2,lng2){
    const radians=value=>value*Math.PI/180,R=6371000,dLat=radians(lat2-lat1),dLng=radians(lng2-lng1);
    const value=Math.sin(dLat/2)**2+Math.cos(radians(lat1))*Math.cos(radians(lat2))*Math.sin(dLng/2)**2;
    return 2*R*Math.asin(Math.sqrt(value));
  }
  function verifiedDoor(lead){
    if(!lead||lead.isDemo===true||!lead.dbId)return false;
    const lat=Number(lead.lat),lng=Number(lead.lng),status=String(lead.geocodeStatus||'').trim().toLowerCase().replace(/[\s-]+/g,'_');
    return Number.isFinite(lat)&&Number.isFinite(lng)&&verifiedStatuses.has(status);
  }
  function closestVerifiedDoor(gps){
    let nearest=null;
    for(const lead of state.leads||[]){
      if(!verifiedDoor(lead)||autoArrivedLeadIds.has(String(lead.id)))continue;
      const distance=metersBetween(Number(gps.lat),Number(gps.lng),Number(lead.lat),Number(lead.lng));
      if(!nearest||distance<nearest.distance)nearest={lead,distance};
    }
    return nearest;
  }
  function resetCandidate(){candidateId=null;candidateHits=0;}
  function ensureLeadOption(select,lead){
    let option=[...select.options].find(item=>item.value===String(lead.id));
    if(!option){option=new Option(lead.fullAddress||lead.address||'Verified door',String(lead.id));select.add(option);}
  }
  function restoreManualButton(){
    const button=document.getElementById('arriveDoorBtn');
    if(button&&!state.activeDoorVisit?.autoVerified)button.hidden=false;
  }

  const autoNearestEnabled=()=>window.MCCOY_FIELD_FEATURES?.automaticNearestLead===true;
  function evaluateAutoArrival(){
    if(!autoNearestEnabled()){resetCandidate();restoreManualButton();return;}
    restoreManualButton();
    const sessionStart=state.session?.startedAt||null;
    if(sessionStart!==observedSessionStart){observedSessionStart=sessionStart;autoArrivedLeadIds.clear();resetCandidate();lastFixAt=0;}
    if(!sessionStart||state.activeDoorVisit)return;
    if(window.MCCOY_LEAD_ADDRESS?.current?.().kind==='typed'){resetCandidate();return;}
    const gps=state.latestGps||null,capturedAt=Number(gps?.capturedAt||0),lat=Number(gps?.lat),lng=Number(gps?.lng),accuracy=Number(gps?.accuracy);
    if(!capturedAt||capturedAt===lastFixAt)return;
    lastFixAt=capturedAt;
    if(!Number.isFinite(lat)||!Number.isFinite(lng)||!Number.isFinite(accuracy)||accuracy<0||Date.now()-capturedAt>MAX_FIX_AGE_MS||accuracy>MAX_CONFIDENT_DISTANCE_METERS){resetCandidate();return;}
    const nearest=closestVerifiedDoor(gps);
    // Geolocation accuracy is a radius. Requiring distance + accuracy to fit
    // inside seven feet keeps the entire reported uncertainty circle in range.
    if(!nearest||nearest.distance+accuracy>MAX_CONFIDENT_DISTANCE_METERS){resetCandidate();return;}
    const leadId=String(nearest.lead.id);
    if(candidateId===leadId)candidateHits++;else{candidateId=leadId;candidateHits=1;}
    if(candidateHits<REQUIRED_CONSECUTIVE_FIXES)return;

    const select=document.getElementById('fieldLeadSelect'),button=document.getElementById('arriveDoorBtn');
    if(!select||!button)return;
    ensureLeadOption(select,nearest.lead);select.value=leadId;select.dispatchEvent(new Event('change',{bubbles:true}));
    button.click();
    if(!state.activeDoorVisit||String(state.activeDoorVisit.lead?.id)!==leadId)return;
    const distanceFeet=nearest.distance*3.28084,accuracyFeet=accuracy*3.28084;
    state.activeDoorVisit.autoVerified=true;
    state.activeDoorVisit.autoVerification={distanceMeters:nearest.distance,accuracyMeters:accuracy,verifiedAt:Date.now()};
    autoArrivedLeadIds.add(leadId);button.hidden=true;resetCandidate();
    const status=document.getElementById('doorVisitStatus');
    if(status)status.textContent=`Arrival auto-verified for ${nearest.lead.address||nearest.lead.fullAddress} (${distanceFeet.toFixed(1)} ft away, GPS ±${accuracyFeet.toFixed(1)} ft).`;
    if(typeof saveTestEvent==='function')saveTestEvent({eventType:'door_arrival_auto_verified',leadLabel:nearest.lead.address||nearest.lead.fullAddress,eventTime:Date.now(),gps:{...gps,ageMs:Date.now()-capturedAt},gpsQuality:'High Accuracy',isGpsVerified:true,leadLat:Number(nearest.lead.lat),leadLng:Number(nearest.lead.lng),distanceMeters:nearest.distance,payload:{automatic:true,trigger_radius_feet:7,required_consecutive_fixes:REQUIRED_CONSECUTIVE_FIXES}});
  }

  const timer=setInterval(()=>{try{evaluateAutoArrival();}catch(error){console.error('Automatic door arrival failed',error);}},500);
  window.addEventListener('beforeunload',()=>clearInterval(timer));
})();
