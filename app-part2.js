let doorTimerHandle=null;
function fmtDoor(ms){
  const s=Math.floor(ms/1000), m=Math.floor(s/60), sec=s%60;
  return `${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`;
}
function startDoorTimer(){
  clearInterval(doorTimerHandle);
  doorTimerHandle=setInterval(()=>{
    if(state.activeDoorVisit){
      document.getElementById("doorElapsed").textContent=fmtDoor(Date.now()-state.activeDoorVisit.arrivedAt);
    }
  },100);
}

// V7.1: GPS quality, property presence and door confidence are separate concepts.
// GPS quality describes the measurement itself. Property presence is a conservative
// point-based proxy until parcel geometry is available. Door confidence may improve
// from repeated verified visit endpoints and a learned neighborhood walkway offset.
state.observedDoorPoints = state.observedDoorPoints || {};
state.neighborhoodWalkwayDoorOffsets = state.neighborhoodWalkwayDoorOffsets || [];

function median(values){
  if(!values.length) return null;
  const a=[...values].sort((x,y)=>x-y);
  const mid=Math.floor(a.length/2);
  return a.length%2 ? a[mid] : (a[mid-1]+a[mid])/2;
}

function classifyPropertyPresence(gps, distanceMeters){
  const gpsQuality=classifyGps(gps);
  if(distanceMeters==null || !gpsQuality.verified){
    return {status:"Unknown", verified:false, reason:distanceMeters==null?"No property reference coordinate":"GPS fix not verified"};
  }
  if(distanceMeters<=30) return {status:"On Property / Strong Match", verified:true, reason:`${distanceMeters.toFixed(1)}m from address reference`};
  if(distanceMeters<=60) return {status:"Near Property / Probable Match", verified:false, reason:`${distanceMeters.toFixed(1)}m from address reference`};
  return {status:"Outside Property Area", verified:false, reason:`${distanceMeters.toFixed(1)}m from address reference`};
}

function observedDoorModel(leadId){
  const pts=state.observedDoorPoints[leadId]||[];
  if(!pts.length) return null;
  const lat=median(pts.map(p=>p.lat));
  const lng=median(pts.map(p=>p.lng));
  return {lat,lng,count:pts.length};
}

function nearestRecentTransitPoint(gps, maxLookback=30){
  if(!gps || !state.breadcrumbs?.length) return null;
  const candidates=state.breadcrumbs.slice(-maxLookback).filter(p=>
    p && p.lat!=null && p.lng!=null && (p.accuracy==null || p.accuracy<=15)
  );
  if(!candidates.length) return null;
  let best=null;
  for(const p of candidates){
    const d=haversineMeters(gps.lat,gps.lng,p.lat,p.lng);
    // Ignore essentially stationary points at the visit itself; we are looking for
    // the approach/transit corridor that is likely sidewalk or common walking path.
    if(d<8 || d>80) continue;
    if(!best || d<best.distanceMeters) best={point:p,distanceMeters:d};
  }
  return best;
}

function learnDoorAndWalkway(leadId,gps,propertyPresence){
  const q=classifyGps(gps);
  if(!gps || !q.verified || propertyPresence.status==="Outside Property Area" || propertyPresence.status==="Unknown") return;

  const pts=state.observedDoorPoints[leadId]||(state.observedDoorPoints[leadId]=[]);
  pts.push({lat:gps.lat,lng:gps.lng,accuracy:gps.accuracy,at:Date.now()});
  if(pts.length>20) pts.shift();

  const transit=nearestRecentTransitPoint(gps);
  if(transit && transit.distanceMeters>=8 && transit.distanceMeters<=60){
    state.neighborhoodWalkwayDoorOffsets.push(transit.distanceMeters);
    if(state.neighborhoodWalkwayDoorOffsets.length>100) state.neighborhoodWalkwayDoorOffsets.shift();
  }
}

function classifyDoorConfidence(leadId,gps,propertyPresence){
  const q=classifyGps(gps);
  if(!gps || !q.verified) return {status:"Unknown",reason:"GPS fix not verified",observedDoorCount:0};
  if(propertyPresence.status==="Outside Property Area") return {status:"Low",reason:"Outside property area",observedDoorCount:0};

  const model=observedDoorModel(leadId);
  const learnedOffset=median(state.neighborhoodWalkwayDoorOffsets);

  if(model && model.count>=3){
    const d=haversineMeters(gps.lat,gps.lng,model.lat,model.lng);
    if(d<=15) return {status:"High",reason:`${d.toFixed(1)}m from observed door cluster (${model.count} verified visits)`,observedDoorCount:model.count,observedDoorDistanceMeters:d,learnedWalkwayDoorOffsetMeters:learnedOffset};
    if(d<=30) return {status:"Medium",reason:`${d.toFixed(1)}m from observed door cluster (${model.count} verified visits)`,observedDoorCount:model.count,observedDoorDistanceMeters:d,learnedWalkwayDoorOffsetMeters:learnedOffset};
    return {status:"Low",reason:`${d.toFixed(1)}m from observed door cluster`,observedDoorCount:model.count,observedDoorDistanceMeters:d,learnedWalkwayDoorOffsetMeters:learnedOffset};
  }

  if(learnedOffset!=null && state.neighborhoodWalkwayDoorOffsets.length>=3){
    return {status:"Medium",reason:`Door not established; neighborhood walkway-to-door offset learned at ~${learnedOffset.toFixed(1)}m`,observedDoorCount:model?.count||0,learnedWalkwayDoorOffsetMeters:learnedOffset};
  }

  return {status:"Not Established",reason:"Need repeated verified visits before inferring the physical door",observedDoorCount:model?.count||0,learnedWalkwayDoorOffsetMeters:learnedOffset};
}

function updatePresenceBoxes(leadId,gps,distanceMeters){
  const property=classifyPropertyPresence(gps,distanceMeters);
  const door=classifyDoorConfidence(leadId,gps,property);
  const pbox=document.getElementById("doorPresenceBox");
  if(pbox){
    pbox.innerHTML=`<strong>Property Presence:</strong> ${property.status} — ${property.reason}<br><strong>Door Confidence:</strong> ${door.status} — ${door.reason}`;
    pbox.style.color=property.status==="Outside Property Area"?"#991b1b":property.status==="Unknown"?"#4b5563":"#166534";
  }
  return {property,door};
}

document.getElementById("setCalibrationLeadBtn").addEventListener("click", async ()=>{
  if(!state.session){alert("Start a field session first so GPS tracking is active.");return;}
  const status=document.getElementById("calibrationStatus");
  status.textContent="Requesting a fresh calibration fix...";

  let gps=null;
  try{
    const fresh=await getGPSOnce();
    state.latestGps=fresh;
    gps={...fresh,ageMs:0,snapshotAt:Date.now()};
  }catch(e){gps=snapshotGpsInstant();}

  if(!gps){status.textContent="Could not obtain a GPS location.";updatePresenceBoxes(null,null,null);return;}

  const q=classifyGps(gps);
  state.calibrationLead={lat:gps.lat,lng:gps.lng,setAt:Date.now(),accuracy:gps.accuracy};
  status.innerHTML=`Address reference set at ${gps.lat.toFixed(6)}, ${gps.lng.toFixed(6)} • ${q.quality} • ±${Math.round(gps.accuracy)}m`;
  updateGpsQualityBox(gps);
  const leadId=Number(document.getElementById("fieldLeadSelect").value);
  const presence=updatePresenceBoxes(leadId,gps,0);

  saveTestEvent({
    eventType:"calibration_lead_set",leadLabel:"Battle Ground Local Calibration Lead",eventTime:Date.now(),gps,
    gpsQuality:q.quality,isGpsVerified:q.verified,leadLat:gps.lat,leadLng:gps.lng,distanceMeters:0,
    payload:{purpose:"Known-location address reference",testAppVersion:"7.1-property-door-learning",propertyPresence:presence.property.status,doorConfidence:presence.door.status,propertyThresholdsMeters:{strongMatch:30,probableMatch:60}}
  });
});

document.getElementById("arriveDoorBtn").addEventListener("click", ()=>{
  if(!state.session){alert("Start a field session first.");return;}
  const leadId=Number(document.getElementById("fieldLeadSelect").value);
  const lead=state.leads.find(l=>l.id===leadId);
  const arrivedAt=Date.now();
  const gps=snapshotGpsInstant();

  state.activeDoorVisit={lead,arrivedAt,arrivalGps:gps};
  document.getElementById("doorElapsed").textContent="00:00";
  const gpsQuality=classifyGps(gps);
  const dist=distanceToCalibrationLead(gps);
  const presence=updatePresenceBoxes(leadId,gps,dist);
  updateGpsQualityBox(gps);
  document.getElementById("doorVisitStatus").innerHTML = gps
    ? `Arrived: ${lead.address} • GPS <strong>${gpsQuality.quality}${gpsQuality.verified?" ✓":""}</strong> • Property <strong>${presence.property.status}</strong> • Door confidence <strong>${presence.door.status}</strong> • ${formatDistance(dist)}`
    : `Arrived: ${lead.address} • GPS unavailable • Property/door confidence unknown`;
  startDoorTimer();

  if(gps) state.breadcrumbs.push({...gps,eventType:"door_arrival",leadId:lead.id});
  saveTestEvent({
    eventType:"door_arrival",leadLabel:lead.address,eventTime:arrivedAt,gps,gpsQuality:gpsQuality.quality,isGpsVerified:gpsQuality.verified,
    leadLat:state.calibrationLead?.lat??null,leadLng:state.calibrationLead?.lng??null,distanceMeters:dist,
    payload:{testAppVersion:"7.1-property-door-learning",propertyPresence:presence.property.status,propertyPresenceReason:presence.property.reason,doorConfidence:presence.door.status,doorConfidenceReason:presence.door.reason,observedDoorCount:presence.door.observedDoorCount,learnedWalkwayDoorOffsetMeters:presence.door.learnedWalkwayDoorOffsetMeters??null,propertyThresholdsMeters:{strongMatch:30,probableMatch:60}}
  });

  requestFreshGpsInBackground(fresh=>{
    if(state.activeDoorVisit && state.activeDoorVisit.lead.id===lead.id && !state.activeDoorVisit.arrivalGps){state.activeDoorVisit.arrivalGps={...fresh,snapshotAt:arrivedAt,ageMs:0};}
  });
});

document.querySelectorAll("[data-disp]").forEach(btn=>{
  btn.addEventListener("click",()=>{
    if(!state.session){alert("Start a field session first.");return;}
    const leadId=Number(document.getElementById("fieldLeadSelect").value);
    const lead=state.leads.find(l=>l.id===leadId);
    if(!state.activeDoorVisit || state.activeDoorVisit.lead.id!==leadId){alert("Tap ARRIVE AT DOOR / START VISIT first so the app can measure time at this door.");return;}

    const endedAt=Date.now();
    const gps=snapshotGpsInstant();
    const disposition=btn.dataset.disp;
    const dwellMs=endedAt-state.activeDoorVisit.arrivedAt;
    const gpsQuality=classifyGps(gps);
    const dist=distanceToCalibrationLead(gps);
    const propertyPresence=classifyPropertyPresence(gps,dist);
    learnDoorAndWalkway(leadId,gps,propertyPresence);
    const doorConfidence=classifyDoorConfidence(leadId,gps,propertyPresence);
    updateGpsQualityBox(gps);
    updatePresenceBoxes(leadId,gps,dist);

    lead.disposition=disposition;
    const activity={lead,disposition,at:new Date(endedAt),gps,gpsQuality,propertyPresence,doorConfidence,distanceMeters:dist,arrivalGps:state.activeDoorVisit.arrivalGps,arrivedAt:new Date(state.activeDoorVisit.arrivedAt),dwellMs};
    state.activities.unshift(activity);
    if(gps) state.breadcrumbs.push({...gps,eventType:"disposition",leadId:lead.id,disposition});

    saveTestEvent({
      eventType:"disposition",leadLabel:lead.address,disposition,eventTime:endedAt,gps,dwellMs,gpsQuality:gpsQuality.quality,isGpsVerified:gpsQuality.verified,
      leadLat:state.calibrationLead?.lat??null,leadLng:state.calibrationLead?.lng??null,distanceMeters:dist,
      payload:{testAppVersion:"7.1-property-door-learning",arrivalGps:state.activeDoorVisit.arrivalGps,propertyPresence:propertyPresence.status,propertyPresenceReason:propertyPresence.reason,doorConfidence:doorConfidence.status,doorConfidenceReason:doorConfidence.reason,observedDoorCount:doorConfidence.observedDoorCount,observedDoorDistanceMeters:doorConfidence.observedDoorDistanceMeters??null,learnedWalkwayDoorOffsetMeters:doorConfidence.learnedWalkwayDoorOffsetMeters??null,walkwayOffsetSamples:state.neighborhoodWalkwayDoorOffsets.length,propertyThresholdsMeters:{strongMatch:30,probableMatch:60}}
    });

    state.activeDoorVisit=null;
    clearInterval(doorTimerHandle);
    document.getElementById("doorElapsed").textContent="00:00";
    document.getElementById("doorVisitStatus").innerHTML=`Visit completed • GPS <strong>${gpsQuality.quality}</strong> • Property <strong>${propertyPresence.status}</strong> • Door confidence <strong>${doorConfidence.status}</strong> • ${formatDistance(dist)}`;
    renderActivities();renderStats();renderLeads();renderEfficiency();
    requestFreshGpsInBackground(fresh=>{activity.postClickGps=fresh;});
  });
});

function renderActivities(){
  document.getElementById("activityLog").innerHTML=state.activities.slice(0,8).map(a=>`
    <div class="activity-item"><strong>${a.disposition}</strong> — ${a.lead.address}
      <div class="muted">${a.at.toLocaleTimeString()} • Door time ${fmtDoor(a.dwellMs)} • GPS ${a.gpsQuality?.quality||"Unknown"} • Property ${a.propertyPresence?.status||"Unknown"} • Door confidence ${a.doorConfidence?.status||"Unknown"} • ${formatDistance(a.distanceMeters)}</div>
    </div>`).join("");
}

function avgFor(disposition){
  const matches=state.activities.filter(a=>a.disposition===disposition);
  if(!matches.length) return null;
  return matches.reduce((sum,a)=>sum+a.dwellMs,0)/matches.length;
}
function displayAvg(ms){return ms===null?"—":fmtDoor(ms);}
function renderEfficiency(){
  const notHome=avgFor("Not Home"), contacted=avgFor("Contacted"), sale=avgFor("Sale");
  const total=state.activities.length;
  const gpsVerified=state.activities.filter(a=>a.gpsQuality?.verified).length;
  const strongProperty=state.activities.filter(a=>a.propertyPresence?.status==="On Property / Strong Match").length;
  const highDoor=state.activities.filter(a=>a.doorConfidence?.status==="High").length;
  const walkwayOffset=median(state.neighborhoodWalkwayDoorOffsets);
  document.getElementById("efficiencySummary").innerHTML=`
    <h2 style="margin-bottom:10px">Door-Time, Property & Learning</h2>
    <div class="efficiency-grid">
      <div><span>Avg Not Home</span><strong>${displayAvg(notHome)}</strong></div>
      <div><span>Avg Contacted</span><strong>${displayAvg(contacted)}</strong></div>
      <div><span>Avg Sale</span><strong>${displayAvg(sale)}</strong></div>
      <div><span>GPS Verified</span><strong>${total?Math.round(gpsVerified/total*100):0}%</strong></div>
      <div><span>Strong Property Match</span><strong>${total?Math.round(strongProperty/total*100):0}%</strong></div>
      <div><span>High Door Confidence</span><strong>${total?Math.round(highDoor/total*100):0}%</strong></div>
      <div><span>Learned Walkway→Door</span><strong>${walkwayOffset==null?"—":`${walkwayOffset.toFixed(1)}m`}</strong></div>
    </div>
    <p class="muted small">The address pin is treated as a property reference, not a front-door coordinate. Repeated verified visit endpoints learn an observed door cluster. Repeated verified approach/transit breadcrumbs learn a probable neighborhood walkway-to-door offset. These are confidence signals, not absolute proof.</p>`;
}

function renderAll(){renderDashboard();renderTeams();renderLeads();renderStats();renderActivities();renderEfficiency();}
renderAll();
