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

// V7: GPS quality and door presence are deliberately separate concepts.
// We only make a door-presence assertion when the GPS fix itself is Verified.
function classifyDoorPresence(gps, distanceMeters){
  const gpsQuality=classifyGps(gps);
  if(distanceMeters==null || !gpsQuality.verified){
    return {status:"Unknown", verified:false, reason:distanceMeters==null?"No lead coordinate":"GPS fix not verified"};
  }
  if(distanceMeters<=15) return {status:"At Door", verified:true, reason:`${distanceMeters.toFixed(1)}m from lead`};
  if(distanceMeters<=30) return {status:"Near Door", verified:false, reason:`${distanceMeters.toFixed(1)}m from lead`};
  return {status:"Outside Door Radius", verified:false, reason:`${distanceMeters.toFixed(1)}m from lead`};
}

function updateDoorPresenceBox(gps, distanceMeters){
  const p=classifyDoorPresence(gps,distanceMeters);
  const box=document.getElementById("doorPresenceBox");
  if(box){
    box.innerHTML=`<strong>Door Presence:</strong> ${p.status}${p.verified?" ✓":""} — ${p.reason}`;
    if(p.status==="At Door") box.style.color="#166534";
    else if(p.status==="Near Door") box.style.color="#92400e";
    else if(p.status==="Outside Door Radius") box.style.color="#991b1b";
    else box.style.color="#4b5563";
  }
  return p;
}

document.getElementById("setCalibrationLeadBtn").addEventListener("click", async ()=>{
  if(!state.session){
    alert("Start a field session first so GPS tracking is active.");
    return;
  }

  const status=document.getElementById("calibrationStatus");
  status.textContent="Requesting a fresh calibration fix...";

  let gps=null;
  try{
    const fresh=await getGPSOnce();
    state.latestGps=fresh;
    gps={...fresh,ageMs:0,snapshotAt:Date.now()};
  }catch(e){
    gps=snapshotGpsInstant();
  }

  if(!gps){
    status.textContent="Could not obtain a GPS location.";
    updateDoorPresenceBox(null,null);
    return;
  }

  const q=classifyGps(gps);
  state.calibrationLead={lat:gps.lat,lng:gps.lng,setAt:Date.now(),accuracy:gps.accuracy};
  status.innerHTML=`Test lead set at ${gps.lat.toFixed(6)}, ${gps.lng.toFixed(6)} • ${q.quality} • ±${Math.round(gps.accuracy)}m`;
  updateGpsQualityBox(gps);
  const doorPresence=updateDoorPresenceBox(gps,0);

  saveTestEvent({
    eventType:"calibration_lead_set",
    leadLabel:"Battle Ground Local Calibration Lead",
    eventTime:Date.now(),
    gps,
    gpsQuality:q.quality,
    isGpsVerified:q.verified,
    leadLat:gps.lat,
    leadLng:gps.lng,
    distanceMeters:0,
    payload:{
      purpose:"Known-location calibration lead",
      testAppVersion:"7.0-door-verification",
      doorPresence:doorPresence.status,
      doorPresenceVerified:doorPresence.verified,
      doorThresholdsMeters:{atDoor:15,nearDoor:30}
    }
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
  const doorPresence=classifyDoorPresence(gps,dist);
  updateGpsQualityBox(gps);
  updateDoorPresenceBox(gps,dist);
  document.getElementById("doorVisitStatus").innerHTML = gps
    ? `Arrived: ${lead.address} • GPS <strong>${gpsQuality.quality}${gpsQuality.verified?" ✓":""}</strong> • Door <strong>${doorPresence.status}${doorPresence.verified?" ✓":""}</strong> • ${formatDistance(dist)}`
    : `Arrived: ${lead.address} • GPS unavailable • Door Presence Unknown`;
  startDoorTimer();

  if(gps) state.breadcrumbs.push({...gps,eventType:"door_arrival",leadId:lead.id});
  saveTestEvent({
    eventType:"door_arrival",
    leadLabel:lead.address,
    eventTime:arrivedAt,
    gps,
    gpsQuality:gpsQuality.quality,
    isGpsVerified:gpsQuality.verified,
    leadLat:state.calibrationLead?.lat ?? null,
    leadLng:state.calibrationLead?.lng ?? null,
    distanceMeters:dist,
    payload:{
      testAppVersion:"7.0-door-verification",
      doorPresence:doorPresence.status,
      doorPresenceVerified:doorPresence.verified,
      doorPresenceReason:doorPresence.reason,
      doorThresholdsMeters:{atDoor:15,nearDoor:30}
    }
  });

  requestFreshGpsInBackground(fresh=>{
    if(state.activeDoorVisit && state.activeDoorVisit.lead.id===lead.id && !state.activeDoorVisit.arrivalGps){
      state.activeDoorVisit.arrivalGps={...fresh,snapshotAt:arrivedAt,ageMs:0};
    }
  });
});

document.querySelectorAll("[data-disp]").forEach(btn=>{
  btn.addEventListener("click",()=>{
    if(!state.session){alert("Start a field session first.");return;}
    const leadId=Number(document.getElementById("fieldLeadSelect").value);
    const lead=state.leads.find(l=>l.id===leadId);

    if(!state.activeDoorVisit || state.activeDoorVisit.lead.id!==leadId){
      alert("Tap ARRIVE AT DOOR / START VISIT first so the app can measure time at this door.");
      return;
    }

    const endedAt=Date.now();
    const gps=snapshotGpsInstant();
    const disposition=btn.dataset.disp;
    const dwellMs=endedAt-state.activeDoorVisit.arrivedAt;
    const gpsQuality=classifyGps(gps);
    const dist=distanceToCalibrationLead(gps);
    const doorPresence=classifyDoorPresence(gps,dist);
    updateGpsQualityBox(gps);
    updateDoorPresenceBox(gps,dist);

    lead.disposition=disposition;
    const activity={
      lead,
      disposition,
      at:new Date(endedAt),
      gps,
      gpsQuality,
      doorPresence,
      distanceMeters:dist,
      arrivalGps:state.activeDoorVisit.arrivalGps,
      arrivedAt:new Date(state.activeDoorVisit.arrivedAt),
      dwellMs
    };

    state.activities.unshift(activity);
    if(gps) state.breadcrumbs.push({...gps,eventType:"disposition",leadId:lead.id,disposition});
    saveTestEvent({
      eventType:"disposition",
      leadLabel:lead.address,
      disposition,
      eventTime:endedAt,
      gps,
      dwellMs,
      gpsQuality:gpsQuality.quality,
      isGpsVerified:gpsQuality.verified,
      leadLat:state.calibrationLead?.lat ?? null,
      leadLng:state.calibrationLead?.lng ?? null,
      distanceMeters:dist,
      payload:{
        testAppVersion:"7.0-door-verification",
        arrivalGps:state.activeDoorVisit.arrivalGps,
        doorPresence:doorPresence.status,
        doorPresenceVerified:doorPresence.verified,
        doorPresenceReason:doorPresence.reason,
        doorThresholdsMeters:{atDoor:15,nearDoor:30}
      }
    });

    state.activeDoorVisit=null;
    clearInterval(doorTimerHandle);
    document.getElementById("doorElapsed").textContent="00:00";
    document.getElementById("doorVisitStatus").innerHTML=`Visit completed • GPS <strong>${gpsQuality.quality}</strong> • Door <strong>${doorPresence.status}${doorPresence.verified?" ✓":""}</strong> • ${formatDistance(dist)}`;
    renderActivities();
    renderStats();
    renderLeads();
    renderEfficiency();

    requestFreshGpsInBackground(fresh=>{activity.postClickGps=fresh;});
  });
});

function renderActivities(){
  document.getElementById("activityLog").innerHTML = state.activities.slice(0,8).map(a=>`
    <div class="activity-item">
      <strong>${a.disposition}</strong> — ${a.lead.address}
      <div class="muted">
        ${a.at.toLocaleTimeString()} • Door time ${fmtDoor(a.dwellMs)}
        ${a.gps?` • GPS ${a.gpsQuality?.quality||classifyGps(a.gps).quality} • Door ${a.doorPresence?.status||classifyDoorPresence(a.gps,a.distanceMeters).status} • ${formatDistance(a.distanceMeters)}`:" • GPS unavailable • Door Unknown"}
      </div>
    </div>
  `).join("");
}

function avgFor(disposition){
  const matches=state.activities.filter(a=>a.disposition===disposition);
  if(!matches.length) return null;
  return matches.reduce((sum,a)=>sum+a.dwellMs,0)/matches.length;
}
function displayAvg(ms){ return ms===null ? "—" : fmtDoor(ms); }
function renderEfficiency(){
  const notHome=avgFor("Not Home");
  const contacted=avgFor("Contacted");
  const sale=avgFor("Sale");
  const atDoorCount=state.activities.filter(a=>a.doorPresence?.status==="At Door").length;
  const verifiedGpsCount=state.activities.filter(a=>a.gpsQuality?.verified).length;
  const total=state.activities.length;
  document.getElementById("efficiencySummary").innerHTML=`
    <h2 style="margin-bottom:10px">Door-Time & Presence Efficiency</h2>
    <div class="efficiency-grid">
      <div><span>Avg Not Home</span><strong>${displayAvg(notHome)}</strong></div>
      <div><span>Avg Contacted</span><strong>${displayAvg(contacted)}</strong></div>
      <div><span>Avg Sale</span><strong>${displayAvg(sale)}</strong></div>
      <div><span>GPS Verified</span><strong>${total?Math.round(verifiedGpsCount/total*100):0}%</strong></div>
      <div><span>At Door</span><strong>${total?Math.round(atDoorCount/total*100):0}%</strong></div>
    </div>
    <p class="muted small">GPS Verified means the location fix is trustworthy. At Door separately means a verified fix was within 15 meters of the mapped lead.</p>
  `;
}

function renderAll(){renderDashboard();renderTeams();renderLeads();renderStats();renderActivities();renderEfficiency();}
renderAll();
