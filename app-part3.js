// V7.2 — Customer comfort + rep effort analytics
// This layer is descriptive/coaching-oriented. It surfaces movement and idle patterns
// for manager review rather than making automatic employment decisions.

state.effortAnalytics = state.effortAnalytics || {
  samples: [],
  stopBlocks: [],
  currentStop: null,
  lastProcessedBreadcrumbCount: 0,
  lastTelemetryAt: 0,
  comfortEvents: []
};

const EFFORT_CFG = {
  crowdingFeet: 5,
  crowdingMeters: 1.524,
  nearDoorComfortFeet: 8,
  stationarySpeedMps: 0.35,
  walkingMinMps: 0.5,
  walkingMaxMps: 2.4,
  offRouteDistanceMeters: 75,
  stopMinMs: 15000,
  longIdleMs: 5 * 60 * 1000,
  telemetryEveryMs: 30000
};

function metersToFeet(m){ return m==null ? null : m * 3.28084; }

function learnedDoorForLead(leadId){
  try{return observedDoorModel(leadId);}catch(e){return null;}
}

function distanceToObservedDoor(leadId,gps){
  const model=learnedDoorForLead(leadId);
  if(!model || !gps) return null;
  return haversineMeters(gps.lat,gps.lng,model.lat,model.lng);
}

function nearestKnownDoorDistance(gps){
  if(!gps) return null;
  let best=null;
  for(const lead of state.leads||[]){
    const model=learnedDoorForLead(lead.id);
    if(!model) continue;
    const d=haversineMeters(gps.lat,gps.lng,model.lat,model.lng);
    if(best==null || d<best) best=d;
  }
  // During controlled testing, the calibration point is also a known property reference.
  if(state.calibrationLead){
    const d=haversineMeters(gps.lat,gps.lng,state.calibrationLead.lat,state.calibrationLead.lng);
    if(best==null || d<best) best=d;
  }
  return best;
}

function customerComfortStatus(leadId,gps){
  const q=classifyGps(gps);
  if(!gps || !q.verified) return {status:"Unknown",reason:"GPS fix not verified",distanceMeters:null};
  const d=distanceToObservedDoor(leadId,gps);
  if(d==null) return {status:"Not Established",reason:"Observed door point not established",distanceMeters:null};
  const ft=metersToFeet(d);
  if(ft < EFFORT_CFG.crowdingFeet) return {status:"Too Close",reason:`${ft.toFixed(1)} ft from observed door`,distanceMeters:d,distanceFeet:ft};
  if(ft < EFFORT_CFG.nearDoorComfortFeet) return {status:"Close",reason:`${ft.toFixed(1)} ft from observed door`,distanceMeters:d,distanceFeet:ft};
  return {status:"Comfortable",reason:`${ft.toFixed(1)} ft from observed door`,distanceMeters:d,distanceFeet:ft};
}

function movementBetween(a,b){
  if(!a||!b||!a.capturedAt||!b.capturedAt) return null;
  const dt=(b.capturedAt-a.capturedAt)/1000;
  if(dt<=0) return null;
  const distance=haversineMeters(a.lat,a.lng,b.lat,b.lng);
  return {distanceMeters:distance,seconds:dt,speedMps:distance/dt};
}

function closeCurrentStop(endAt){
  const ea=state.effortAnalytics;
  const stop=ea.currentStop;
  if(!stop) return;
  stop.endAt=endAt;
  stop.durationMs=endAt-stop.startAt;
  if(stop.durationMs>=EFFORT_CFG.stopMinMs) ea.stopBlocks.push(stop);
  ea.currentStop=null;
}

function processEffortBreadcrumbs(){
  const ea=state.effortAnalytics;
  const crumbs=state.breadcrumbs||[];
  let i=Math.max(1,ea.lastProcessedBreadcrumbCount);
  for(;i<crumbs.length;i++){
    const a=crumbs[i-1], b=crumbs[i];
    if(!a||!b||a.lat==null||b.lat==null) continue;
    const mv=movementBetween(a,b);
    if(!mv) continue;
    const q=classifyGps({...b,ageMs:0});
    if(!q.verified) continue;
    const nearestDoor=nearestKnownDoorDistance(b);
    const sample={at:b.capturedAt||Date.now(),speedMps:mv.speedMps,distanceMeters:mv.distanceMeters,seconds:mv.seconds,nearestDoorMeters:nearestDoor};
    ea.samples.push(sample);
    if(ea.samples.length>2000) ea.samples.shift();

    if(mv.speedMps < EFFORT_CFG.stationarySpeedMps){
      if(!ea.currentStop){
        ea.currentStop={startAt:a.capturedAt||Date.now(),lat:b.lat,lng:b.lng,nearestDoorMeters:nearestDoor,samples:1};
      }else{
        ea.currentStop.samples++;
        ea.currentStop.lat=b.lat; ea.currentStop.lng=b.lng;
        if(nearestDoor!=null) ea.currentStop.nearestDoorMeters=nearestDoor;
      }
    }else{
      closeCurrentStop(b.capturedAt||Date.now());
    }
  }
  ea.lastProcessedBreadcrumbCount=crumbs.length;
}

function effortSummary(){
  processEffortBreadcrumbs();
  const ea=state.effortAnalytics;
  const samples=ea.samples;
  const walking=samples.filter(s=>s.speedMps>=EFFORT_CFG.walkingMinMps && s.speedMps<=EFFORT_CFG.walkingMaxMps);
  const avgWalking=walking.length?walking.reduce((a,b)=>a+b.speedMps,0)/walking.length:null;
  const totalWalkDistance=samples.reduce((a,b)=>a+b.distanceMeters,0);
  const stops=[...ea.stopBlocks];
  if(ea.currentStop){
    const live={...ea.currentStop,endAt:Date.now(),durationMs:Date.now()-ea.currentStop.startAt};
    if(live.durationMs>=EFFORT_CFG.stopMinMs) stops.push(live);
  }
  const offRoute=stops.filter(s=>s.nearestDoorMeters==null || s.nearestDoorMeters>EFFORT_CFG.offRouteDistanceMeters);
  const longOffRoute=offRoute.filter(s=>s.durationMs>=EFFORT_CFG.longIdleMs);
  const offRouteMs=offRoute.reduce((a,b)=>a+b.durationMs,0);
  return {avgWalkingMps:avgWalking,totalWalkDistanceMeters:totalWalkDistance,stopCount:stops.length,offRouteStopCount:offRoute.length,longOffRouteStopCount:longOffRoute.length,offRouteIdleMs:offRouteMs,longOffRouteStops:longOffRoute};
}

function fmtMinutes(ms){ return `${(ms/60000).toFixed(ms>=600000?0:1)} min`; }
function fmtSpeed(mps){ return mps==null?"—":`${(mps*2.23694).toFixed(1)} mph`; }
function fmtDistanceMeters(m){ return m==null?"—":m<1000?`${Math.round(m)} m`:`${(m/1000).toFixed(2)} km`; }

function renderEffortPanel(){
  const host=document.getElementById("efficiencySummary");
  if(!host) return;
  let panel=document.getElementById("repEffortPanel");
  if(!panel){
    panel=document.createElement("div");
    panel.id="repEffortPanel";
    panel.style.marginTop="18px";
    panel.style.paddingTop="14px";
    panel.style.borderTop="1px solid var(--line)";
    host.appendChild(panel);
  }
  const s=effortSummary();
  const recentComfort=state.effortAnalytics.comfortEvents[0];
  const longest=s.longOffRouteStops.length?Math.max(...s.longOffRouteStops.map(x=>x.durationMs)):0;
  panel.innerHTML=`
    <h2 style="margin-bottom:10px">Rep Effort & Customer Comfort</h2>
    <div class="efficiency-grid">
      <div><span>Avg Walking Speed</span><strong>${fmtSpeed(s.avgWalkingMps)}</strong></div>
      <div><span>Tracked Walking</span><strong>${fmtDistanceMeters(s.totalWalkDistanceMeters)}</strong></div>
      <div><span>Stops Between Doors</span><strong>${s.stopCount}</strong></div>
      <div><span>Off-Route Stops</span><strong>${s.offRouteStopCount}</strong></div>
      <div><span>Off-Route Idle</span><strong>${fmtMinutes(s.offRouteIdleMs)}</strong></div>
      <div><span>Long Off-Route Blocks</span><strong>${s.longOffRouteStopCount}</strong></div>
      <div><span>Longest Off-Route Block</span><strong>${longest?fmtMinutes(longest):"—"}</strong></div>
      <div><span>Latest Door Spacing</span><strong>${recentComfort?recentComfort.status:"—"}</strong></div>
    </div>
    <p class="muted small">Customer comfort flags &lt;5 ft from a learned observed door as Too Close. Off-route idle means stationary time more than ${EFFORT_CFG.offRouteDistanceMeters} m from a known property/door reference. Place type is not inferred without map/POI data.</p>`;
}

function saveEffortSnapshot(eventType="effort_snapshot"){
  if(!state.session || !telemetrySessionId) return;
  const now=Date.now();
  if(eventType==="effort_snapshot" && now-state.effortAnalytics.lastTelemetryAt<EFFORT_CFG.telemetryEveryMs) return;
  state.effortAnalytics.lastTelemetryAt=now;
  const s=effortSummary();
  const gps=snapshotGpsInstant();
  saveTestEvent({eventType,eventTime:now,gps,payload:{testAppVersion:"7.2-effort-comfort",effortSummary:s,thresholds:{crowdingFeet:5,offRouteDistanceMeters:EFFORT_CFG.offRouteDistanceMeters,longIdleMinutes:EFFORT_CFG.longIdleMs/60000}}});
}

// Capture door spacing at the exact disposition click, before the existing handler clears activeDoorVisit.
document.querySelectorAll("[data-disp]").forEach(btn=>{
  btn.addEventListener("click",()=>{
    if(!state.activeDoorVisit) return;
    const gps=snapshotGpsInstant();
    const leadId=state.activeDoorVisit.lead.id;
    const comfort=customerComfortStatus(leadId,gps);
    const evt={at:Date.now(),leadId,status:comfort.status,distanceMeters:comfort.distanceMeters,distanceFeet:comfort.distanceFeet,reason:comfort.reason};
    state.effortAnalytics.comfortEvents.unshift(evt);
    if(state.effortAnalytics.comfortEvents.length>100) state.effortAnalytics.comfortEvents.pop();
    if(telemetrySessionId){
      saveTestEvent({eventType:"customer_comfort",leadLabel:state.activeDoorVisit.lead.address,eventTime:evt.at,gps,gpsQuality:classifyGps(gps).quality,isGpsVerified:classifyGps(gps).verified,payload:{testAppVersion:"7.2-effort-comfort",comfortStatus:comfort.status,distanceToObservedDoorMeters:comfort.distanceMeters,distanceToObservedDoorFeet:comfort.distanceFeet,crowdingThresholdFeet:5}});
    }
    setTimeout(renderEffortPanel,0);
  },true);
});

document.getElementById("stopKnockingBtn")?.addEventListener("click",()=>{
  processEffortBreadcrumbs();
  closeCurrentStop(Date.now());
  saveEffortSnapshot("effort_session_summary");
  setTimeout(renderEffortPanel,0);
},true);

setInterval(()=>{
  if(state.session){
    processEffortBreadcrumbs();
    renderEffortPanel();
    saveEffortSnapshot();
  }
},5000);

// Keep the build badge accurate without requiring another full HTML rewrite.
const badge=document.getElementById("modeBadge");
if(badge) badge.textContent="EFFORT + CUSTOMER COMFORT V7.2";
renderEffortPanel();
