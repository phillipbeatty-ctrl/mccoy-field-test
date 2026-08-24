// Authoritative field-door client. Competitive analytics remain server-side.
let doorTimerHandle=null;
state.lastDispositionEndedAt=state.lastDispositionEndedAt||null;

function fmtDoor(ms){const s=Math.max(0,Math.floor(Number(ms||0)/1000)),m=Math.floor(s/60),sec=s%60;return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;}
function startDoorTimer(){clearInterval(doorTimerHandle);doorTimerHandle=setInterval(()=>{if(state.activeDoorVisit){const el=document.getElementById('doorElapsed');if(el)el.textContent=fmtDoor(Date.now()-state.activeDoorVisit.arrivedAt);}},250);}
function rawLeadReference(){return state.calibrationLead?{lat:state.calibrationLead.lat,lng:state.calibrationLead.lng}:null;}
function leadBySelect(){const value=String(document.getElementById('fieldLeadSelect')?.value||'');return(state.leads||[]).find(lead=>String(lead.id)===value||String(lead.dbId)===value)||null;}
function currentGps(){const gps=snapshotGpsInstant?.()||state.latestGps||null;return gps&&Number.isFinite(Number(gps.lat))&&Number.isFinite(Number(gps.lng))?gps:null;}
function doorErrorMessage(error){
  const value=String(error?.message||error||'').replace(/_/g,' ');
  if(/outside quarter mile sale only/i.test(value))return 'Outside the ¼-mile lead limit. Only SALE is allowed; enter the customer service address in the sale form.';
  if(/fresh current location|required current location|usable location accuracy/i.test(value))return 'A fresh usable GPS fix is required for non-sale door activity. Keep location enabled and retry.';
  if(/verified lead location/i.test(value))return 'This lead does not have a verified door location. Choose another mapped lead or process only a completed sale with its service address.';
  if(/active visit must/i.test(value))return 'Finish this visit or use CORRECT LEAD before starting another door.';
  if(/lead not assigned|outside assigned pool/i.test(value))return 'This lead is outside your assigned lead pool.';
  return value||'Door workflow could not be saved. Check connection and retry.';
}
function setDoorStatus(message,error=false){const status=document.getElementById('doorVisitStatus');if(status){status.textContent=message;status.style.color=error?'#991b1b':'';}}

document.getElementById('setCalibrationLeadBtn')?.addEventListener('click',async()=>{
  if(!state.session){alert('Start a field session first.');return;}
  const status=document.getElementById('calibrationStatus');if(status)status.textContent='Capturing address reference...';
  let gps=null;try{gps=await getGPSOnce();state.latestGps=gps;}catch(_){gps=currentGps();}
  if(!gps){if(status)status.textContent='Location unavailable.';return;}
  state.calibrationLead={lat:gps.lat,lng:gps.lng,setAt:Date.now(),accuracy:gps.accuracy};
  if(status)status.textContent='Address reference captured for this controlled test.';
  const lead=leadBySelect();
  saveTestEvent({eventType:'address_reference',leadLabel:lead?.address||null,eventTime:Date.now(),gps,leadLat:gps.lat,leadLng:gps.lng,payload:{rawEvent:true,referenceType:'tester_calibration'}});
});

let doorStartInFlight=false,doorCompletionInFlight=false;
window.MCCOY_START_DOOR_VISIT=async function({automatic=false}={}){
  if(doorStartInFlight)return false;
  if(!state.session||!telemetrySessionId){if(!automatic)alert('Start a field session first.');return false;}
  if(state.activeDoorVisit)return true;
  const lead=leadBySelect();
  if(!lead?.dbId){if(!automatic)alert('Choose a verified lead first.');return false;}
  let gps=currentGps();
  if(!window.MCCOY_DOOR_WORKFLOW_CORE?.isFreshGps(gps)){
    try{gps=await Promise.race([getGPSOnce(),new Promise(resolve=>setTimeout(()=>resolve(null),4500))]);if(gps)state.latestGps=gps;}catch(_){}
  }
  if(!gps){if(!automatic)alert('A fresh GPS fix is required for this door.');return false;}
  const distance=window.MCCOY_DOOR_WORKFLOW_CORE?.distanceState(lead,gps);
  if(!distance?.withinRange){if(!automatic)alert(distance?.reason==='lead_location_unverified'?'This lead does not have a verified door location.':'Outside the ¼-mile lead limit. Only SALE is allowed; enter the service address in the sale form.');return false;}
  const button=document.getElementById('arriveDoorBtn');doorStartInFlight=true;if(button)button.disabled=true;setDoorStatus('Verifying this door and current distance…');
  try{
    const {data,error}=await sb.rpc('record_door_visit_start',{
      p_session_id:telemetrySessionId,p_lead_id:lead.dbId,p_selection_source:automatic?'automatic_nearest':'manual_lead',
      p_latitude:Number(gps.lat),p_longitude:Number(gps.lng),p_accuracy_meters:Number(gps.accuracy),p_gps_captured_at:new Date(Number(gps.capturedAt)||Date.now()).toISOString()
    });
    if(error||!data?.ok)throw error||new Error(data?.reason||'door_visit_start_failed');
    const arrivedAt=Date.parse(data.started_at)||Date.now();
    if(state.lastDispositionEndedAt)saveTestEvent({eventType:'transition_interval',leadLabel:lead.address,eventTime:arrivedAt,gps,dwellMs:arrivedAt-state.lastDispositionEndedAt,payload:{rawEvent:true,fromDispositionToNextPhysicalKnock:true}});
    state.activeDoorVisit={serverVisitId:data.visit_id,lead,arrivedAt,arrivalGps:gps,automaticSelection:automatic,arrivalDistanceMeters:Number(data.distance_meters)};
    const timer=document.getElementById('doorElapsed');if(timer)timer.textContent='00:00';startDoorTimer();
    if(gps)state.breadcrumbs.push({...gps,eventType:'door_arrival',leadId:lead.id});
    setDoorStatus(`${automatic?'Closest lead auto-selected and arrival recorded':'Arrival recorded'} for ${lead.address}.`);
    window.dispatchEvent(new CustomEvent('mccoy-door-visit-started',{detail:{visitId:data.visit_id,leadId:lead.dbId,automatic}}));
    return true;
  }catch(error){console.error('Door visit start failed',error);setDoorStatus(doorErrorMessage(error),true);if(!automatic)alert(doorErrorMessage(error));return false;}
  finally{doorStartInFlight=false;if(button)button.disabled=false;}
};

window.MCCOY_COMPLETE_DOOR_VISIT=async function(disposition,{automatic=false,autoReason=null,saleId=null,serviceAddress=null}={}){
  if(doorCompletionInFlight)return false;
  const visit=state.activeDoorVisit;
  if(!visit?.serverVisitId){
    if(disposition==='sale'&&window.MCCOY_SALE_CONFIRMED){setDoorStatus('Completed sale recorded. The customer address is linked to the sale record.');return true;}
    if(!automatic)alert('Arrive at the selected door first.');
    return false;
  }
  const gps=currentGps(),button=document.querySelector(`[data-disp="${disposition}"]`);doorCompletionInFlight=true;if(button)button.disabled=true;
  setDoorStatus(automatic?'Applying automatic door outcome…':'Saving door outcome…');
  try{
    const {data,error}=await sb.rpc('record_door_visit_completion',{
      p_visit_id:visit.serverVisitId,p_disposition:disposition,p_latitude:gps?Number(gps.lat):null,p_longitude:gps?Number(gps.lng):null,
      p_accuracy_meters:gps&&Number.isFinite(Number(gps.accuracy))?Number(gps.accuracy):null,p_gps_captured_at:gps?new Date(Number(gps.capturedAt)||Date.now()).toISOString():null,
      p_automatic:automatic,p_auto_reason:autoReason,p_provider_sale_id:saleId,p_service_address:serviceAddress
    });
    if(error||!data?.ok)throw error||new Error(data?.reason||'door_visit_completion_failed');
    const endedAt=Date.now(),lead=visit.lead,display=data.visit_outcome||disposition,contactStatus=data.contact_status||null,dwellMs=Number(data.dwell_ms??endedAt-visit.arrivedAt);
    if(lead)lead.disposition=display;
    state.activities.unshift({lead:lead||{address:serviceAddress||'Customer address'},disposition:display,visitOutcome:display,contactStatus,at:new Date(endedAt),gps,dwellMs,automatic});
    if(gps&&lead)state.breadcrumbs.push({...gps,eventType:'disposition',leadId:lead.id,disposition:display});
    state.lastDispositionEndedAt=endedAt;state.activeDoorVisit=null;clearInterval(doorTimerHandle);
    const timer=document.getElementById('doorElapsed');if(timer)timer.textContent='00:00';
    setDoorStatus(`${automatic?'Auto-dispositioned':'Visit completed'}: ${display}${contactStatus?` · ${contactStatus}`:''}.`);
    renderActivities();renderStats();renderLeads();
    window.dispatchEvent(new CustomEvent('mccoy-door-visit-completed',{detail:{visitId:visit.serverVisitId,leadId:lead?.dbId||null,disposition:display,contactStatus,automatic}}));
    return true;
  }catch(error){console.error('Door visit completion failed',error);setDoorStatus(doorErrorMessage(error),true);if(!automatic)alert(doorErrorMessage(error));return false;}
  finally{doorCompletionInFlight=false;if(button)button.disabled=false;}
};

document.getElementById('arriveDoorBtn')?.addEventListener('click',()=>window.MCCOY_START_DOOR_VISIT({automatic:false}));
document.querySelectorAll('[data-disp]').forEach(button=>button.addEventListener('click',()=>{
  const disposition=String(button.dataset.disp||'');
  if(disposition==='Sale'&&!window.MCCOY_SALE_CONFIRMED)return;
  window.MCCOY_COMPLETE_DOOR_VISIT(disposition.toLowerCase(),{automatic:false});
}));

function renderStats(){
  const startedAt=state.session?.startedAt;
  const activities=startedAt?state.activities.filter(activity=>activity.at.getTime()>=startedAt):state.activities;
  const stats={doorsCount:activities.length,contactsCount:activities.filter(activity=>activity.contactStatus==='Contacted'||activity.disposition==='Sale').length,salesCount:activities.filter(activity=>activity.disposition==='Sale').length};
  Object.entries(stats).forEach(([id,value])=>{const el=document.getElementById(id);if(el)el.textContent=String(value);});
}
function renderActivities(){const el=document.getElementById('activityLog');if(!el)return;el.innerHTML=state.activities.slice(0,8).map(activity=>`<div class="activity-item"><strong>${activity.disposition}</strong>${activity.contactStatus?` · ${activity.contactStatus}`:''} — ${activity.lead?.address||'Customer address'}<div class="muted">${activity.at.toLocaleTimeString()} • Visit ${fmtDoor(activity.dwellMs)}${activity.automatic?' • Automatic':''}</div></div>`).join('');}
function renderEfficiency(){const el=document.getElementById('efficiencySummary');if(el)el.innerHTML='<p class="muted small">Competitive field analytics are computed on the McCoy server and are not contained in this browser build.</p>';}
function renderAll(){renderDashboard();renderTeams();renderLeads();renderStats();renderActivities();renderEfficiency();}
renderAll();
