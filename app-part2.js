// Authoritative field-door client. Competitive analytics remain server-side.
let doorTimerHandle=null;
state.lastDispositionEndedAt=state.lastDispositionEndedAt||null;

function fmtDoor(ms){const s=Math.max(0,Math.floor(Number(ms||0)/1000)),m=Math.floor(s/60),sec=s%60;return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;}
function startDoorTimer(){clearInterval(doorTimerHandle);doorTimerHandle=setInterval(()=>{if(state.activeDoorVisit){const el=document.getElementById('doorElapsed');if(el)el.textContent=fmtDoor(Date.now()-state.activeDoorVisit.arrivedAt);}},250);}
function rawLeadReference(){return state.calibrationLead?{lat:state.calibrationLead.lat,lng:state.calibrationLead.lng}:null;}
function leadAddressContext(){
  const controlled=window.MCCOY_LEAD_ADDRESS?.current?.();if(controlled)return controlled;
  const value=String(document.getElementById('fieldLeadSelect')?.value||''),lead=(state.leads||[]).find(item=>String(item.id)===value||String(item.dbId)===value)||null;
  return lead?{kind:'assigned',address:lead.fullAddress||lead.address,lead,valid:true}:{kind:'empty',address:'',lead:null,valid:false};
}
function leadBySelect(){return leadAddressContext().lead||null;}
function currentGps(){const gps=snapshotGpsInstant?.()||state.latestGps||null;return gps&&Number.isFinite(Number(gps.lat))&&Number.isFinite(Number(gps.lng))?gps:null;}
function gpsAuditParams(gps){
  const latitude=Number(gps?.lat),longitude=Number(gps?.lng),accuracy=Number(gps?.accuracy),capturedAt=Number(gps?.capturedAt),validCoordinates=Number.isFinite(latitude)&&latitude>=-90&&latitude<=90&&Number.isFinite(longitude)&&longitude>=-180&&longitude<=180;
  return{p_latitude:validCoordinates?latitude:null,p_longitude:validCoordinates?longitude:null,p_accuracy_meters:Number.isFinite(accuracy)&&accuracy>=0?accuracy:null,p_gps_captured_at:Number.isFinite(capturedAt)&&capturedAt>0?new Date(capturedAt).toISOString():null};
}
function doorErrorMessage(error){
  const value=String(error?.message||error||'').replace(/_/g,' ');
  if(/active visit must/i.test(value))return 'Finish this visit or use CORRECT LEAD before starting another door.';
  if(/lead not assigned|outside assigned pool/i.test(value))return 'This lead is outside your assigned lead pool.';
  if(/typed address required/i.test(value))return 'Type a complete ad-hoc service address before starting this activity.';
  return value||'Door workflow could not be saved. Check connection and retry.';
}
function setDoorStatus(message,error=false){const status=document.getElementById('doorVisitStatus');if(status){status.textContent=message;status.style.color=error?'#991b1b':'';}}
function selectedPinDisposition(){
  const core=window.MCCOY_DOOR_WORKFLOW_CORE,activityType=core?.activityType(document.getElementById('leadActivityType')?.value),visitResult=core?.visitResult(document.getElementById('leadVisitResult')?.value),stage=core?.stage(document.getElementById('leadStage')?.value);
  return{activityType,visitResult,stage};
}
function renderPinDispositionControls(){
  const lead=state.activeDoorVisit?.lead||leadBySelect(),selection=selectedPinDisposition(),core=window.MCCOY_DOOR_WORKFLOW_CORE;
  const preview=core?.pinState({stage:selection.stage,visitResult:selection.visitResult,previousColor:lead?.pinColor,previousSource:lead?.pinColorSource});
  const previewBox=document.getElementById('pinDispositionPreview'),dot=previewBox?.querySelector('.pin-preview-dot'),label=previewBox?.querySelector('span:last-child');
  if(dot)dot.style.background=preview?.color||'#fbbf24';
  if(label)label.textContent=selection.stage?`Stage will control the pin: ${selection.stage}.`:selection.visitResult?`Visit Result will control the pin: ${selection.visitResult}.`:'Select a Visit Result or Stage.';
  const current=document.getElementById('currentPinDisposition');if(current){const currentLabel=lead?.pinDisposition||lead?.stage||lead?.visitResult||lead?.disposition||'Prospecting';current.textContent=`Current pin: ${currentLabel}`;current.style.borderColor=lead?.pinColor||'';}
}

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
  const addressContext=leadAddressContext(),isTyped=addressContext.kind==='typed'&&addressContext.valid,selectedLead=addressContext.lead;
  if(!isTyped&&!selectedLead?.dbId){if(!automatic)alert(addressContext.kind==='invalid'?'Type a complete address (at least 5 characters).':'Choose an assigned lead or type an ad-hoc address first.');return false;}
  const lead=isTyped?window.MCCOY_LEAD_ADDRESS_CORE.adHocLead(addressContext.address):selectedLead;
  const gps=currentGps(),gpsParams=gpsAuditParams(gps);
  if(!window.MCCOY_DOOR_WORKFLOW_CORE?.isFreshGps(gps))window.requestFreshGpsInBackground?.();
  const button=document.getElementById('arriveDoorBtn');doorStartInFlight=true;if(button)button.disabled=true;setDoorStatus(isTyped?'Starting ad-hoc address activity; location is coaching-only…':'Starting activity; door location will be recorded for coaching when available…');
  try{
    const rpc=isTyped?'record_ad_hoc_door_visit_start':'record_door_visit_start',params=isTyped?{
      p_session_id:telemetrySessionId,p_service_address:addressContext.address,...gpsParams
    }:{p_session_id:telemetrySessionId,p_lead_id:lead.dbId,p_selection_source:automatic?'automatic_nearest':'manual_lead',...gpsParams};
    const {data,error}=await sb.rpc(rpc,params);
    if(error||!data?.ok)throw error||new Error(data?.reason||'door_visit_start_failed');
    const arrivedAt=Date.parse(data.started_at)||Date.now();
    if(state.lastDispositionEndedAt)saveTestEvent({eventType:'transition_interval',leadLabel:lead.address,eventTime:arrivedAt,gps,dwellMs:arrivedAt-state.lastDispositionEndedAt,payload:{rawEvent:true,fromDispositionToNextPhysicalKnock:true}});
    state.activeDoorVisit={serverVisitId:data.visit_id,lead,arrivedAt,arrivalGps:gps,automaticSelection:isTyped?false:automatic,arrivalDistanceMeters:data.distance_meters==null?null:Number(data.distance_meters),doorLocationVerified:Boolean(data.door_location_verified),selectionSource:isTyped?'typed_address':(automatic?'automatic_nearest':'manual_lead')};
    const timer=document.getElementById('doorElapsed');if(timer)timer.textContent='00:00';startDoorTimer();
    if(gps)state.breadcrumbs.push({...gps,eventType:'door_arrival',leadId:lead.id});
    const coachingStatus=data.door_location_verified?'Door location verified for coaching.':'Door location not verified; disposition remains available.';
    setDoorStatus(`${isTyped?'Ad-hoc activity started':automatic?'Closest lead auto-selected and arrival recorded':'Activity started'} for ${lead.address}. ${coachingStatus}`);
    window.dispatchEvent(new CustomEvent('mccoy-door-visit-started',{detail:{visitId:data.visit_id,leadId:lead.dbId||null,automatic:isTyped?false:automatic,selectionSource:state.activeDoorVisit.selectionSource,address:lead.address}}));
    return true;
  }catch(error){console.error('Door visit start failed',error);setDoorStatus(doorErrorMessage(error),true);if(!automatic)alert(doorErrorMessage(error));return false;}
  finally{doorStartInFlight=false;if(button)button.disabled=false;}
};

window.MCCOY_COMPLETE_DOOR_VISIT=async function(disposition,{automatic=false,autoReason=null,saleId=null,serviceAddress=null,activityType=null,visitResult=null,stage=null}={}){
  if(doorCompletionInFlight)return false;
  const visit=state.activeDoorVisit;
  if(!visit?.serverVisitId){
    if(disposition==='sale'&&window.MCCOY_SALE_CONFIRMED){setDoorStatus('Completed sale recorded. The customer address is linked to the sale record.');return true;}
    if(!automatic)alert('Arrive at the selected door first.');
    return false;
  }
  const gps=currentGps(),gpsParams=gpsAuditParams(gps);
  if(!window.MCCOY_DOOR_WORKFLOW_CORE?.isFreshGps(gps))window.requestFreshGpsInBackground?.();
  const button=disposition==='sale'?document.querySelector('[data-disp="Sale"]'):document.getElementById('savePinDispositionBtn');doorCompletionInFlight=true;if(button)button.disabled=true;
  setDoorStatus(automatic?'Applying automatic door outcome…':'Saving door outcome…');
  try{
    let data,error;
    if(disposition==='sale')({data,error}=await sb.rpc('record_door_visit_completion',{
      p_visit_id:visit.serverVisitId,p_disposition:'sale',...gpsParams,p_automatic:automatic,p_auto_reason:autoReason,p_provider_sale_id:saleId,p_service_address:serviceAddress
    }));
    else{
      let selection={activityType,visitResult,stage};
      if(disposition==='auto')selection=window.MCCOY_DOOR_WORKFLOW_CORE.autoDispositionForDwell(Date.now()-visit.arrivedAt);
      ({data,error}=await sb.rpc('record_spotio_door_visit_completion',{
        p_visit_id:visit.serverVisitId,p_activity_type:selection.activityType,p_visit_result:selection.visitResult,p_stage:selection.stage||null,
        ...gpsParams,p_automatic:automatic,p_auto_reason:autoReason
      }));
    }
    if(error||!data?.ok)throw error||new Error(data?.reason||'door_visit_completion_failed');
    const endedAt=Date.now(),lead=visit.lead,isSale=disposition==='sale',display=isSale?'Sale Made':(data.effective_disposition||data.visit_result||data.visit_outcome||disposition),contactStatus=data.contact_status||null,dwellMs=Number(data.dwell_ms??endedAt-visit.arrivedAt);
    if(lead){lead.disposition=display;lead.lastActivityType=isSale?'Visit':data.activity_type;lead.visitResult=isSale?'Contacted':data.visit_result;lead.stage=isSale?'Sale Made':(data.stage||lead.stage||'Prospecting');lead.pinColor=isSale?'#22c55e':(data.pin_color||lead.pinColor);lead.pinColorSource=isSale?'stage':(data.pin_color_source||lead.pinColorSource);lead.pinDisposition=display;}
    state.activities.unshift({lead:lead||{address:serviceAddress||'Customer address'},disposition:display,activityType:isSale?'Visit':data.activity_type,visitOutcome:data.visit_result||display,contactStatus,stage:isSale?'Sale Made':data.stage,at:new Date(endedAt),gps,dwellMs,automatic});
    if(gps&&lead)state.breadcrumbs.push({...gps,eventType:'disposition',leadId:lead.id,disposition:display});
    state.lastDispositionEndedAt=endedAt;state.activeDoorVisit=null;clearInterval(doorTimerHandle);
    const timer=document.getElementById('doorElapsed');if(timer)timer.textContent='00:00';
    const coachingStatus=data.door_location_verified?'Door location verified for coaching.':'Door location not verified; the disposition was still saved.';
    setDoorStatus(`${automatic?'Auto-dispositioned':'Visit completed'}: ${display}${data.activity_type?` · ${data.activity_type}`:''}. ${coachingStatus}`);
    renderActivities();renderStats();renderLeads();
    renderPinDispositionControls();window.MCCOY_APPLY_DISPOSITION_COLORS?.();
    window.dispatchEvent(new CustomEvent('mccoy-door-visit-completed',{detail:{visitId:visit.serverVisitId,leadId:lead?.dbId||null,disposition:display,activityType:data.activity_type||null,visitResult:data.visit_result||null,stage:data.stage||null,contactStatus,automatic}}));
    return true;
  }catch(error){console.error('Door visit completion failed',error);setDoorStatus(doorErrorMessage(error),true);if(!automatic)alert(doorErrorMessage(error));return false;}
  finally{doorCompletionInFlight=false;if(button)button.disabled=false;}
};

document.getElementById('arriveDoorBtn')?.addEventListener('click',()=>window.MCCOY_START_DOOR_VISIT({automatic:false}));
document.getElementById('savePinDispositionBtn')?.addEventListener('click',()=>{
  const selection=selectedPinDisposition();
  if(!selection.activityType){alert('Choose an Activity Type.');return;}
  if(!selection.visitResult){alert('Choose a Visit Result before saving.');document.getElementById('leadVisitResult')?.focus();return;}
  if(selection.stage==='Sale Made'){document.getElementById('processSaleBtn')?.click();return;}
  window.MCCOY_COMPLETE_DOOR_VISIT('spotio',{automatic:false,...selection});
});
document.querySelector('[data-disp="Sale"]')?.addEventListener('click',()=>{if(window.MCCOY_SALE_CONFIRMED)window.MCCOY_COMPLETE_DOOR_VISIT('sale',{automatic:false});});
for(const id of ['leadActivityType','leadVisitResult','leadStage','fieldLeadSelect'])document.getElementById(id)?.addEventListener('change',renderPinDispositionControls);
window.addEventListener('mccoy-lead-address-changed',renderPinDispositionControls);
for(const eventName of ['mccoy-real-leads-progress','mccoy-real-leads-loaded','mccoy-door-visit-started'])window.addEventListener(eventName,renderPinDispositionControls);

function renderStats(){
  const startedAt=state.session?.startedAt;
  const activities=startedAt?state.activities.filter(activity=>activity.at.getTime()>=startedAt):state.activities;
  const stats={doorsCount:activities.length,contactsCount:activities.filter(activity=>activity.contactStatus==='Contacted'||activity.disposition==='Sale Made').length,salesCount:activities.filter(activity=>activity.disposition==='Sale'||activity.disposition==='Sale Made').length};
  Object.entries(stats).forEach(([id,value])=>{const el=document.getElementById(id);if(el)el.textContent=String(value);});
}
function renderActivities(){const el=document.getElementById('activityLog');if(!el)return;el.innerHTML=state.activities.slice(0,8).map(activity=>`<div class="activity-item"><strong>${activity.disposition}</strong>${activity.activityType?` · ${activity.activityType}`:''} — ${activity.lead?.address||'Customer address'}<div class="muted">${activity.at.toLocaleTimeString()} • Visit ${fmtDoor(activity.dwellMs)}${activity.automatic?' • Automatic':''}</div></div>`).join('');}
function renderEfficiency(){const el=document.getElementById('efficiencySummary');if(el)el.innerHTML='<p class="muted small">Competitive field analytics are computed on the McCoy server and are not contained in this browser build.</p>';}
function renderAll(){renderDashboard();renderTeams();renderLeads();renderStats();renderActivities();renderEfficiency();}
renderAll();
renderPinDispositionControls();
