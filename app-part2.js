// V9 raw field client. Competitive analytics are intentionally server-side.
let doorTimerHandle=null;
function fmtDoor(ms){const s=Math.floor(ms/1000),m=Math.floor(s/60),sec=s%60;return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;}
function startDoorTimer(){clearInterval(doorTimerHandle);doorTimerHandle=setInterval(()=>{if(state.activeDoorVisit){const el=document.getElementById('doorElapsed');if(el)el.textContent=fmtDoor(Date.now()-state.activeDoorVisit.arrivedAt);}},250);}

function rawLeadReference(){return state.calibrationLead?{lat:state.calibrationLead.lat,lng:state.calibrationLead.lng}:null;}
function rawGpsPayload(gps){return gps?{capturedAt:gps.capturedAt??Date.now(),snapshotAt:gps.snapshotAt??Date.now()}:null;}

// Admin-only controlled test reference. It records a raw coordinate; no proximity or door inference happens in the browser.
document.getElementById('setCalibrationLeadBtn')?.addEventListener('click',async()=>{
  if(!state.session){alert('Start a field session first.');return;}
  const status=document.getElementById('calibrationStatus');if(status)status.textContent='Capturing address reference...';
  let gps=null;try{gps=await getGPSOnce();state.latestGps=gps;}catch(_){gps=snapshotGpsInstant();}
  if(!gps){if(status)status.textContent='Location unavailable.';return;}
  state.calibrationLead={lat:gps.lat,lng:gps.lng,setAt:Date.now(),accuracy:gps.accuracy};
  if(status)status.textContent='Address reference captured for this controlled test.';
  saveTestEvent({eventType:'address_reference',leadLabel:state.leads.find(l=>l.id===Number(document.getElementById('fieldLeadSelect').value))?.address||null,eventTime:Date.now(),gps,leadLat:gps.lat,leadLng:gps.lng,payload:{rawEvent:true,referenceType:'tester_calibration'}});
});

// For testers this button is relabeled PHYSICALLY KNOCKED by app-auth.js.
document.getElementById('arriveDoorBtn')?.addEventListener('click',()=>{
  if(!state.session){alert('Start a field session first.');return;}
  const leadId=Number(document.getElementById('fieldLeadSelect').value),lead=state.leads.find(l=>l.id===leadId);if(!lead)return;
  const arrivedAt=Date.now(),gps=snapshotGpsInstant();
  state.activeDoorVisit={lead,arrivedAt,arrivalGps:gps};
  const timer=document.getElementById('doorElapsed');if(timer)timer.textContent='00:00';
  const status=document.getElementById('doorVisitStatus');if(status)status.textContent=`Physical knock recorded for ${lead.address}.`;
  startDoorTimer();
  if(gps)state.breadcrumbs.push({...gps,eventType:'door_arrival',leadId:lead.id});
  const ref=rawLeadReference();
  saveTestEvent({eventType:'door_arrival',leadLabel:lead.address,eventTime:arrivedAt,gps,leadLat:ref?.lat??null,leadLng:ref?.lng??null,payload:{rawEvent:true,reportedAction:'physically_knocked',leadId,arrivalGps:rawGpsPayload(gps)}});
  requestFreshGpsInBackground?.(()=>{});
});

document.querySelectorAll('[data-disp]').forEach(btn=>btn.addEventListener('click',()=>{
  if(!state.session){alert('Start a field session first.');return;}
  const leadId=Number(document.getElementById('fieldLeadSelect').value),lead=state.leads.find(l=>l.id===leadId);if(!lead)return;
  if(!state.activeDoorVisit||state.activeDoorVisit.lead.id!==leadId){alert('Tap PHYSICALLY KNOCKED first.');return;}
  const endedAt=Date.now(),gps=snapshotGpsInstant(),disposition=btn.dataset.disp,dwellMs=endedAt-state.activeDoorVisit.arrivedAt,ref=rawLeadReference();
  lead.disposition=disposition;
  state.activities.unshift({lead,disposition,at:new Date(endedAt),gps,dwellMs});
  if(gps)state.breadcrumbs.push({...gps,eventType:'disposition',leadId:lead.id,disposition});
  saveTestEvent({eventType:'disposition',leadLabel:lead.address,disposition,eventTime:endedAt,gps,dwellMs,leadLat:ref?.lat??null,leadLng:ref?.lng??null,payload:{rawEvent:true,leadId,arrivalTime:new Date(state.activeDoorVisit.arrivedAt).toISOString(),arrivalGps:rawGpsPayload(state.activeDoorVisit.arrivalGps)}});
  state.activeDoorVisit=null;clearInterval(doorTimerHandle);const timer=document.getElementById('doorElapsed');if(timer)timer.textContent='00:00';
  const status=document.getElementById('doorVisitStatus');if(status)status.textContent='Visit completed. Select the next lead.';
  renderActivities();renderStats();renderLeads();
}));

function renderActivities(){const el=document.getElementById('activityLog');if(!el)return;el.innerHTML=state.activities.slice(0,8).map(a=>`<div class="activity-item"><strong>${a.disposition}</strong> — ${a.lead.address}<div class="muted">${a.at.toLocaleTimeString()} • Visit ${fmtDoor(a.dwellMs)}</div></div>`).join('');}
function renderEfficiency(){const el=document.getElementById('efficiencySummary');if(el)el.innerHTML='<p class="muted small">Competitive field analytics are computed on the McCoy server and are not contained in this browser build.</p>';}
function renderAll(){renderDashboard();renderTeams();renderLeads();renderStats();renderActivities();renderEfficiency();}
renderAll();