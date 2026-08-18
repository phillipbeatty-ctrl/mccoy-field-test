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
    return;
  }

  const q=classifyGps(gps);
  state.calibrationLead={lat:gps.lat,lng:gps.lng,setAt:Date.now(),accuracy:gps.accuracy};
  status.innerHTML=`Test lead set at ${gps.lat.toFixed(6)}, ${gps.lng.toFixed(6)} • ${q.quality} • ±${Math.round(gps.accuracy)}m`;
  updateGpsQualityBox(gps);

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
    payload:{purpose:"Known-location calibration lead"}
  });
});

document.getElementById("arriveDoorBtn").addEventListener("click", ()=>{
  if(!state.session){alert("Start a field session first.");return;}
  const leadId=Number(document.getElementById("fieldLeadSelect").value);
  const lead=state.leads.find(l=>l.id===leadId);

  const arrivedAt=Date.now();
  const gps=snapshotGpsInstant();

  // Start timing and update the UI immediately.
  state.activeDoorVisit={
    lead,
    arrivedAt,
    arrivalGps:gps
  };
  document.getElementById("doorElapsed").textContent="00:00";
  const gpsQuality=classifyGps(gps);
  const dist=distanceToCalibrationLead(gps);
  updateGpsQualityBox(gps);
  document.getElementById("doorVisitStatus").innerHTML =
    gps
      ? `Arrived: ${lead.address} • <strong>${gpsQuality.quality}${gpsQuality.verified?" ✓":""}</strong> • ${gpsQuality.reason} • ${formatDistance(dist)}`
      : `Arrived: ${lead.address} • GPS unavailable`;
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
    distanceMeters:dist
  });

  // Improve the live GPS in the background; never block the timer.
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
    const gps=snapshotGpsInstant(); // immediate click-time GPS from continuous watch
    const disposition=btn.dataset.disp;
    const dwellMs=endedAt-state.activeDoorVisit.arrivedAt;
    const gpsQuality=classifyGps(gps);
    const dist=distanceToCalibrationLead(gps);
    updateGpsQualityBox(gps);

    lead.disposition=disposition;
    const activity={
      lead,
      disposition,
      at:new Date(endedAt),
      gps,
      arrivalGps:state.activeDoorVisit.arrivalGps,
      arrivedAt:new Date(state.activeDoorVisit.arrivedAt),
      dwellMs
    };

    // Update all visible state immediately.
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
      payload:{arrivalGps:state.activeDoorVisit.arrivalGps}
    });

    state.activeDoorVisit=null;
    clearInterval(doorTimerHandle);
    document.getElementById("doorElapsed").textContent="00:00";
    document.getElementById("doorVisitStatus").textContent="Visit completed. Select the next lead and mark arrival.";
    renderActivities();
    renderStats();
    renderLeads();
    renderEfficiency();

    // Ask for a fresh high-accuracy fix in the background for diagnostics,
    // but do not delay the disposition or alter its click-time audit snapshot.
    requestFreshGpsInBackground(fresh=>{
      activity.postClickGps=fresh;
    });
  });
});

function renderActivities(){
  document.getElementById("activityLog").innerHTML = state.activities.slice(0,8).map(a=>`
    <div class="activity-item">
      <strong>${a.disposition}</strong> — ${a.lead.address}
      <div class="muted">
        ${a.at.toLocaleTimeString()} • Door time ${fmtDoor(a.dwellMs)}
        ${a.gps?` • ${classifyGps(a.gps).quality} • ${classifyGps(a.gps).reason} • ${formatDistance(distanceToCalibrationLead(a.gps))}`:" • GPS unavailable"}
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
  document.getElementById("efficiencySummary").innerHTML=`
    <h2 style="margin-bottom:10px">Door-Time Efficiency</h2>
    <div class="efficiency-grid">
      <div><span>Avg Not Home</span><strong>${displayAvg(notHome)}</strong></div>
      <div><span>Avg Contacted</span><strong>${displayAvg(contacted)}</strong></div>
      <div><span>Avg Sale</span><strong>${displayAvg(sale)}</strong></div>
    </div>
    <p class="muted small">This lets coaching compare dwell time by outcome instead of treating every door the same.</p>
  `;
}

function renderAll(){renderDashboard();renderTeams();renderLeads();renderStats();renderActivities();renderEfficiency();}
renderAll();
