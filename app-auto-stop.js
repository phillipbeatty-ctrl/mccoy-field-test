// V9.2 server-controlled field-session stop layer.
// The browser does not contain the decision thresholds; it asks the protected session-control Edge Function.
(function(){
  const CHECK_EVERY_MS=15000;
  let controlTimer=null;
  let controlBusy=false;

  function clearLocalSession(reasonLabel){
    clearInterval(controlTimer);controlTimer=null;
    clearInterval(timerHandle);
    if(typeof doorTimerHandle!=='undefined') clearInterval(doorTimerHandle);
    stopGpsWatch();
    state.activeDoorVisit=null;
    state.session=null;
    state.lastDispositionEndedAt=null;
    telemetrySessionId=null;
    const start=document.getElementById('startKnockingBtn'),stop=document.getElementById('stopKnockingBtn');
    start?.classList.remove('hidden');stop?.classList.add('hidden');
    if(start){start.disabled=false;start.textContent='START KNOCKING';}
    const timer=document.getElementById('doorElapsed');if(timer)timer.textContent='00:00';
    const visit=document.getElementById('doorVisitStatus');if(visit)visit.textContent='No active door visit.';
    document.getElementById('fieldState').textContent=reasonLabel||'Session stopped';
  }

  async function callControl(action='check'){
    if(controlBusy||!state.session||!telemetrySessionId)return null;
    controlBusy=true;
    try{
      const {data,error}=await sb.functions.invoke('session-control',{body:{session_id:telemetrySessionId,action}});
      if(error) throw error;
      return data;
    }catch(err){
      console.error('Session control check failed',err);
      telemetryStatus('Session control temporarily unavailable; telemetry remains connected.',false);
      return null;
    }finally{controlBusy=false;}
  }

  async function runCheck(){
    const data=await callControl('check');
    if(!data||data.action!=='stop')return;
    let label='Knocking auto-stopped';
    if(data.reason==='outside_assigned_area') label='Auto-stopped — outside assigned working area';
    else if(data.reason==='stationary_after_disposition') label='Auto-stopped — inactive after last disposition';
    else if(data.reason==='session_already_ended') label='Session ended';
    telemetryStatus(label,true);
    clearLocalSession(label);
    // Admin/manager sessions can immediately generate protected analytics; testers receive no formulas/results.
    try{await sb.functions.invoke('field-analytics',{body:{}});}catch(_){/* analytics may be admin-only */}
  }

  function beginControlLoop(){
    clearInterval(controlTimer);
    controlTimer=setInterval(runCheck,CHECK_EVERY_MS);
  }

  // Observe successful secure session start without modifying its logic.
  const observer=setInterval(()=>{
    if(state.session&&telemetrySessionId){
      clearInterval(observer);
      state.lastDispositionEndedAt=null;
      beginControlLoop();
    }
  },500);

  // Replace the legacy manual Stop handler. Server closes the session first, then local tracking stops.
  document.getElementById('stopKnockingBtn')?.addEventListener('click',async(e)=>{
    e.preventDefault();e.stopImmediatePropagation();
    if(!state.session||!telemetrySessionId)return;
    const stopBtn=document.getElementById('stopKnockingBtn');
    if(stopBtn){stopBtn.disabled=true;stopBtn.textContent='STOPPING…';}
    telemetryStatus('Closing field session…',true);
    const data=await callControl('manual_stop');
    if(!data?.ok){
      if(stopBtn){stopBtn.disabled=false;stopBtn.textContent='STOP KNOCKING';}
      telemetryStatus('Could not close the session on the server. Try Stop Knocking again.',false);
      return;
    }
    const label='Session Complete';
    clearLocalSession(label);
    telemetryStatus('Session closed and saved.',true);
    try{await sb.functions.invoke('field-analytics',{body:{}});}catch(_){/* admin viewer can retry later */}
  },true);

  window.MCCOY_SESSION_CONTROL={runCheck,beginControlLoop};
})();