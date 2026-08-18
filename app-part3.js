// V7.3 — Rep effort, door-zone dwell, and GPS-aware customer comfort
// Coaching-oriented analytics only. Surface patterns for manager review; do not automate employment decisions.

state.effortAnalytics = state.effortAnalytics || {};
Object.assign(state.effortAnalytics, {
  samples: state.effortAnalytics.samples || [],
  stopBlocks: state.effortAnalytics.stopBlocks || [],
  currentCluster: state.effortAnalytics.currentCluster || null,
  lastProcessedBreadcrumbCount: state.effortAnalytics.lastProcessedBreadcrumbCount || 0,
  lastTelemetryAt: state.effortAnalytics.lastTelemetryAt || 0,
  comfortEvents: state.effortAnalytics.comfortEvents || [],
  visitZoneTrack: state.effortAnalytics.visitZoneTrack || null
});

const EFFORT_CFG = {
  crowdingFeet: 5,
  comfortableFeet: 8,
  walkingMinMps: 0.5,
  walkingMaxMps: 2.4,
  stopClusterRadiusMeters: 8,
  stopMinMs: 15000,
  offRouteDistanceMeters: 75,
  longIdleMs: 5*60*1000,
  doorZoneMeters: 30,
  telemetryEveryMs: 30000
};

function metersToFeet(m){return m==null?null:m*3.28084;}
function learnedDoorForLead(leadId){try{return observedDoorModel(leadId);}catch(e){return null;}}
function distanceToObservedDoor(leadId,gps){const m=learnedDoorForLead(leadId);return (!m||!gps)?null:haversineMeters(gps.lat,gps.lng,m.lat,m.lng);}

function nearestKnownDoorDistance(gps){
  if(!gps) return null;
  let best=null;
  for(const lead of state.leads||[]){
    const model=learnedDoorForLead(lead.id);
    if(!model) continue;
    const d=haversineMeters(gps.lat,gps.lng,model.lat,model.lng);
    if(best==null||d<best) best=d;
  }
  if(state.calibrationLead){
    const d=haversineMeters(gps.lat,gps.lng,state.calibrationLead.lat,state.calibrationLead.lng);
    if(best==null||d<best) best=d;
  }
  return best;
}

function comfortAssessment(leadId,gps){
  const q=classifyGps(gps);
  if(!gps||!q.verified) return {status:"Unknown",confidence:"Low",reason:"GPS fix not verified"};
  const d=distanceToObservedDoor(leadId,gps);
  if(d==null) return {status:"Not Established",confidence:"Low",reason:"Observed door point not established"};
  const ft=metersToFeet(d), accFt=metersToFeet(gps.accuracy||999);
  const low=Math.max(0,ft-accFt), high=ft+accFt;
  let status="Uncertain", confidence="Medium";
  if(high<5){status="Likely Too Close";confidence="High";}
  else if(low>=8){status="Comfortable";confidence="High";}
  else if(low<5 && high>=5){status="Uncertain / Could Be Too Close";confidence="Medium";}
  else if(low>=5 && high<8){status="Close";confidence="Medium";}
  else if(low<8 && high>=8){status="Uncertain / Near Comfort Boundary";confidence="Medium";}
  return {status,confidence,reason:`Observed ${ft.toFixed(1)} ft; GPS ±${accFt.toFixed(1)} ft`,distanceMeters:d,distanceFeet:ft,accuracyFeet:accFt,possibleMinFeet:low,possibleMaxFeet:high};
}

function movementBetween(a,b){
  if(!a||!b||!a.capturedAt||!b.capturedAt) return null;
  const seconds=(b.capturedAt-a.capturedAt)/1000;
  if(seconds<=0) return null;
  const distanceMeters=haversineMeters(a.lat,a.lng,b.lat,b.lng);
  return {seconds,distanceMeters,speedMps:distanceMeters/seconds};
}

function closeCluster(endAt){
  const ea=state.effortAnalytics,c=ea.currentCluster;
  if(!c) return;
  c.endAt=endAt;c.durationMs=endAt-c.startAt;
  if(c.durationMs>=EFFORT_CFG.stopMinMs) ea.stopBlocks.push(c);
  ea.currentCluster=null;
}

function processClusterPoint(p){
  const ea=state.effortAnalytics;
  const q=classifyGps({...p,ageMs:0});
  if(!q.verified) return;
  const nearest=nearestKnownDoorDistance(p);
  if(!ea.currentCluster){
    ea.currentCluster={startAt:p.capturedAt,anchorLat:p.lat,anchorLng:p.lng,lastAt:p.capturedAt,lat:p.lat,lng:p.lng,maxRadiusMeters:0,nearestDoorMeters:nearest,samples:1};
    return;
  }
  const c=ea.currentCluster;
  const d=haversineMeters(c.anchorLat,c.anchorLng,p.lat,p.lng);
  if(d<=EFFORT_CFG.stopClusterRadiusMeters){
    c.lastAt=p.capturedAt;c.lat=p.lat;c.lng=p.lng;c.samples++;c.maxRadiusMeters=Math.max(c.maxRadiusMeters,d);
    if(nearest!=null&&(c.nearestDoorMeters==null||nearest<c.nearestDoorMeters)) c.nearestDoorMeters=nearest;
  }else{
    closeCluster(p.capturedAt);
    ea.currentCluster={startAt:p.capturedAt,anchorLat:p.lat,anchorLng:p.lng,lastAt:p.capturedAt,lat:p.lat,lng:p.lng,maxRadiusMeters:0,nearestDoorMeters:nearest,samples:1};
  }
}

function processEffortBreadcrumbs(){
  const ea=state.effortAnalytics, crumbs=state.breadcrumbs||[];
  let i=Math.max(0,ea.lastProcessedBreadcrumbCount);
  for(;i<crumbs.length;i++){
    const b=crumbs[i];
    if(!b||b.lat==null||b.lng==null||!b.capturedAt) continue;
    if(i>0){
      const a=crumbs[i-1];
      const mv=movementBetween(a,b);
      if(mv&&classifyGps({...b,ageMs:0}).verified){
        ea.samples.push({at:b.capturedAt,speedMps:mv.speedMps,distanceMeters:mv.distanceMeters,seconds:mv.seconds,nearestDoorMeters:nearestKnownDoorDistance(b)});
        if(ea.samples.length>3000) ea.samples.shift();
      }
    }
    processClusterPoint(b);
  }
  ea.lastProcessedBreadcrumbCount=crumbs.length;
}

function activeStops(){
  const ea=state.effortAnalytics, stops=[...ea.stopBlocks];
  if(ea.currentCluster){
    const live={...ea.currentCluster,endAt:Date.now(),durationMs:Date.now()-ea.currentCluster.startAt};
    if(live.durationMs>=EFFORT_CFG.stopMinMs) stops.push(live);
  }
  return stops;
}

function effortSummary(){
  processEffortBreadcrumbs();
  const ea=state.effortAnalytics, samples=ea.samples;
  const walking=samples.filter(s=>s.speedMps>=EFFORT_CFG.walkingMinMps&&s.speedMps<=EFFORT_CFG.walkingMaxMps);
  const avgWalking=walking.length?walking.reduce((a,b)=>a+b.speedMps,0)/walking.length:null;
  const totalWalkDistance=samples.reduce((a,b)=>a+b.distanceMeters,0);
  const stops=activeStops();
  const offRoute=stops.filter(s=>s.nearestDoorMeters==null||s.nearestDoorMeters>EFFORT_CFG.offRouteDistanceMeters);
  const longOffRoute=offRoute.filter(s=>s.durationMs>=EFFORT_CFG.longIdleMs);
  return {avgWalkingMps:avgWalking,totalWalkDistanceMeters:totalWalkDistance,stopCount:stops.length,offRouteStopCount:offRoute.length,longOffRouteStopCount:longOffRoute.length,offRouteIdleMs:offRoute.reduce((a,b)=>a+b.durationMs,0),longOffRouteStops:longOffRoute};
}

function beginVisitZoneTracking(){
  if(!state.activeDoorVisit) return;
  const gps=snapshotGpsInstant();
  state.effortAnalytics.visitZoneTrack={leadId:state.activeDoorVisit.lead.id,startAt:Date.now(),lastAt:Date.now(),lastInside:null,doorZoneMs:0,awayZoneMs:0,maxDistanceMeters:0};
  updateVisitZoneTracking(gps);
}

function updateVisitZoneTracking(gps){
  const z=state.effortAnalytics.visitZoneTrack;
  if(!z||!gps) return;
  const now=Date.now();
  const propertyDist=distanceToCalibrationLead(gps);
  const doorDist=distanceToObservedDoor(z.leadId,gps);
  const d=doorDist!=null?doorDist:propertyDist;
  if(d==null) return;
  if(z.lastInside!=null){
    const dt=now-z.lastAt;
    if(z.lastInside) z.doorZoneMs+=dt; else z.awayZoneMs+=dt;
  }
  z.lastInside=d<=EFFORT_CFG.doorZoneMeters;
  z.lastAt=now;
  z.maxDistanceMeters=Math.max(z.maxDistanceMeters,d);
}

function finalizeVisitZoneTracking(gps){
  updateVisitZoneTracking(gps);
  const z=state.effortAnalytics.visitZoneTrack;
  state.effortAnalytics.visitZoneTrack=null;
  return z;
}

function fmtMinutes(ms){return `${(ms/60000).toFixed(ms>=600000?0:1)} min`;}
function fmtSpeed(mps){return mps==null?"—":`${(mps*2.23694).toFixed(1)} mph`;}
function fmtDistanceMeters(m){return m==null?"—":m<1000?`${Math.round(m)} m`:`${(m/1000).toFixed(2)} km`;}

function renderEffortPanel(){
  const host=document.getElementById("efficiencySummary");if(!host) return;
  let panel=document.getElementById("repEffortPanel");
  if(!panel){panel=document.createElement("div");panel.id="repEffortPanel";panel.style.marginTop="18px";panel.style.paddingTop="14px";panel.style.borderTop="1px solid var(--line)";host.appendChild(panel);}
  const s=effortSummary(),recent=state.effortAnalytics.comfortEvents[0],longest=s.longOffRouteStops.length?Math.max(...s.longOffRouteStops.map(x=>x.durationMs)):0;
  panel.innerHTML=`<h2 style="margin-bottom:10px">Rep Effort, Door-Zone Time & Customer Comfort</h2><div class="efficiency-grid">
  <div><span>Avg Walking Speed</span><strong>${fmtSpeed(s.avgWalkingMps)}</strong></div><div><span>Tracked Walking</span><strong>${fmtDistanceMeters(s.totalWalkDistanceMeters)}</strong></div><div><span>Stops</span><strong>${s.stopCount}</strong></div><div><span>Off-Route Stops</span><strong>${s.offRouteStopCount}</strong></div><div><span>Off-Route Idle</span><strong>${fmtMinutes(s.offRouteIdleMs)}</strong></div><div><span>Long Off-Route Blocks</span><strong>${s.longOffRouteStopCount}</strong></div><div><span>Longest Off-Route</span><strong>${longest?fmtMinutes(longest):"—"}</strong></div><div><span>Latest Spacing</span><strong>${recent?recent.status:"—"}</strong></div></div><p class="muted small">Stops are now position-cluster based (within ${EFFORT_CFG.stopClusterRadiusMeters} m) rather than relying on callback speed. Customer spacing uses GPS uncertainty and reports likelihood/confidence, not false precision.</p>`;
}

function saveEffortSnapshot(eventType="effort_snapshot"){
  if(!state.session||!telemetrySessionId) return;
  const now=Date.now();
  if(eventType==="effort_snapshot"&&now-state.effortAnalytics.lastTelemetryAt<EFFORT_CFG.telemetryEveryMs) return;
  state.effortAnalytics.lastTelemetryAt=now;
  saveTestEvent({eventType,eventTime:now,gps:snapshotGpsInstant(),payload:{testAppVersion:"7.3-effort-zone-comfort",effortSummary:effortSummary(),thresholds:{crowdingFeet:5,comfortableFeet:8,stopClusterRadiusMeters:EFFORT_CFG.stopClusterRadiusMeters,offRouteDistanceMeters:EFFORT_CFG.offRouteDistanceMeters,longIdleMinutes:5,doorZoneMeters:EFFORT_CFG.doorZoneMeters}}});
}

// Start door-zone accounting after the existing arrival handler creates activeDoorVisit.
document.getElementById("arriveDoorBtn")?.addEventListener("click",()=>setTimeout(beginVisitZoneTracking,0));

// Capture spacing + visit-zone accounting before the existing disposition handler clears the visit.
document.querySelectorAll("[data-disp]").forEach(btn=>{
  btn.addEventListener("click",()=>{
    if(!state.activeDoorVisit) return;
    const gps=snapshotGpsInstant(),lead=state.activeDoorVisit.lead,comfort=comfortAssessment(lead.id,gps),zone=finalizeVisitZoneTracking(gps),evtAt=Date.now();
    const evt={at:evtAt,leadId:lead.id,...comfort};state.effortAnalytics.comfortEvents.unshift(evt);if(state.effortAnalytics.comfortEvents.length>100)state.effortAnalytics.comfortEvents.pop();
    if(telemetrySessionId){
      saveTestEvent({eventType:"customer_comfort",leadLabel:lead.address,eventTime:evtAt,gps,gpsQuality:classifyGps(gps).quality,isGpsVerified:classifyGps(gps).verified,payload:{testAppVersion:"7.3-effort-zone-comfort",comfortStatus:comfort.status,comfortConfidence:comfort.confidence,comfortReason:comfort.reason,distanceToObservedDoorMeters:comfort.distanceMeters??null,distanceToObservedDoorFeet:comfort.distanceFeet??null,gpsAccuracyFeet:comfort.accuracyFeet??null,possibleMinFeet:comfort.possibleMinFeet??null,possibleMaxFeet:comfort.possibleMaxFeet??null,crowdingThresholdFeet:5,comfortableThresholdFeet:8}});
      if(zone){saveTestEvent({eventType:"door_zone_summary",leadLabel:lead.address,eventTime:evtAt,gps,payload:{testAppVersion:"7.3-effort-zone-comfort",doorZoneMs:zone.doorZoneMs,awayZoneMs:zone.awayZoneMs,maxDistanceMeters:zone.maxDistanceMeters,doorZoneMeters:EFFORT_CFG.doorZoneMeters}});}
    }
    setTimeout(renderEffortPanel,0);
  },true);
});

document.getElementById("stopKnockingBtn")?.addEventListener("click",()=>{processEffortBreadcrumbs();closeCluster(Date.now());saveEffortSnapshot("effort_session_summary");setTimeout(renderEffortPanel,0);},true);

setInterval(()=>{
  if(state.session){
    processEffortBreadcrumbs();
    if(state.effortAnalytics.visitZoneTrack) updateVisitZoneTracking(snapshotGpsInstant());
    renderEffortPanel();saveEffortSnapshot();
  }
},5000);

const badge=document.getElementById("modeBadge");if(badge) badge.textContent="ZONE + EFFORT ANALYTICS V7.3";
renderEffortPanel();
