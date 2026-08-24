// Lightweight foreground heartbeat for active field sessions.
// The server supplies the event timestamp and verifies ownership/open status.
(function(){
  if(window.MCCOY_FIELD_HEARTBEAT)return;

  const HEARTBEAT_EVERY_MS=5*60*1000;
  const RETRY_AFTER_MS=30*1000;
  const MIN_RESUME_GAP_MS=60*1000;
  let activeSessionId=null;
  let timer=null;
  let inFlight=false;
  let lastSuccessAt=0;

  function clearTimer(){
    if(timer!==null)clearTimeout(timer);
    timer=null;
  }

  function schedule(delay=HEARTBEAT_EVERY_MS){
    clearTimer();
    if(!activeSessionId||document.visibilityState!=='visible'||navigator.onLine===false)return;
    timer=setTimeout(()=>sendHeartbeat('interval'),Math.max(1000,delay));
  }

  async function sendHeartbeat(trigger='interval'){
    clearTimer();
    if(!activeSessionId)return false;
    if(document.visibilityState!=='visible'||navigator.onLine===false)return false;
    if(!state?.session||telemetrySessionId!==activeSessionId){stop();return false;}
    if(inFlight){schedule(RETRY_AFTER_MS);return false;}
    inFlight=true;
    const sessionId=activeSessionId;
    try{
      const {data,error}=await sb.rpc('record_field_session_heartbeat',{p_session_id:sessionId});
      if(error)throw error;
      if(!data?.ok){
        console.warn('Field-session heartbeat rejected',data?.reason||'session_not_open');
        window.MCCOY_SESSION_CONTROL?.runCheck?.();
        schedule(RETRY_AFTER_MS);
        return false;
      }
      if(activeSessionId!==sessionId)return false;
      lastSuccessAt=Date.now();
      document.getElementById('fieldState')?.setAttribute('data-heartbeat','connected');
      schedule();
      return true;
    }catch(error){
      console.error('Field-session heartbeat failed',error);
      document.getElementById('fieldState')?.setAttribute('data-heartbeat','retrying');
      schedule(RETRY_AFTER_MS);
      return false;
    }finally{
      inFlight=false;
    }
  }

  function start(sessionId){
    if(!sessionId||activeSessionId===sessionId)return;
    activeSessionId=sessionId;
    lastSuccessAt=0;
    clearTimer();
    sendHeartbeat('session_start');
  }

  function stop(){
    activeSessionId=null;
    lastSuccessAt=0;
    clearTimer();
    document.getElementById('fieldState')?.removeAttribute('data-heartbeat');
  }

  function resumeIfDue(trigger){
    if(!activeSessionId)return;
    const elapsed=Date.now()-lastSuccessAt;
    if(lastSuccessAt===0||elapsed>=MIN_RESUME_GAP_MS)sendHeartbeat(trigger);
    else schedule(HEARTBEAT_EVERY_MS-elapsed);
  }

  window.addEventListener('mccoy-field-session-started',event=>start(event.detail?.sessionId));
  window.addEventListener('mccoy-field-session-ended',stop);
  window.addEventListener('online',()=>resumeIfDue('online_resume'));
  window.addEventListener('offline',clearTimer);
  window.addEventListener('pageshow',()=>resumeIfDue('page_restore'));
  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='visible')resumeIfDue('visibility_resume');
    else clearTimer();
  });
  window.addEventListener('pagehide',clearTimer);

  if(state?.session&&telemetrySessionId)start(telemetrySessionId);
  window.MCCOY_FIELD_HEARTBEAT={sendNow:()=>sendHeartbeat('manual_check'),stop};
})();
