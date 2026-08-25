// Field-session heartbeat + best-effort browser background mode.
// Browsers may suspend JavaScript and geolocation after the user switches apps.
// This control preserves the session, keeps trying where the browser permits it,
// and immediately reconciles heartbeat/GPS when McCoy becomes visible again.
(function(){
  if(window.MCCOY_FIELD_HEARTBEAT)return;

  const HEARTBEAT_EVERY_MS=5*60*1000;
  const BACKGROUND_HEARTBEAT_EVERY_MS=2*60*1000;
  const RETRY_AFTER_MS=30*1000;
  const MIN_RESUME_GAP_MS=60*1000;
  const STORAGE_KEY='mccoy_background_mode_enabled';
  let activeSessionId=null;
  let timer=null;
  let inFlight=false;
  let lastSuccessAt=0;
  let hiddenAt=0;
  let wakeLock=null;
  let backgroundEnabled=localStorage.getItem(STORAGE_KEY)==='1';

  function clearTimer(){
    if(timer!==null)clearTimeout(timer);
    timer=null;
  }

  function sessionActive(){return Boolean(activeSessionId&&state?.session&&telemetrySessionId===activeSessionId);}

  function statusText(){
    if(!backgroundEnabled)return 'Background Mode OFF — tracking is optimized only while McCoy is open.';
    if(!sessionActive())return 'Background Mode ON — it will activate with the next field session.';
    if(document.visibilityState==='visible')return 'Background Mode ON — session continuity enabled. Browser/OS background limits still apply.';
    return 'Background Mode ON — McCoy is hidden and is attempting to maintain session/GPS where the browser permits it.';
  }

  function renderBackgroundStatus(){
    const el=document.getElementById('backgroundModeStatus');if(el)el.textContent=statusText();
    const button=document.getElementById('backgroundModeToggle');
    if(button){button.textContent=`BACKGROUND MODE: ${backgroundEnabled?'ON':'OFF'}`;button.className=backgroundEnabled?'primary':'assign-btn';button.setAttribute('aria-pressed',backgroundEnabled?'true':'false');}
  }

  function ensureBackgroundControl(){
    const fieldControls=document.querySelector('.field-controls');
    if(!fieldControls||document.getElementById('backgroundModePanel'))return;
    const panel=document.createElement('div');panel.id='backgroundModePanel';panel.className='geo-box';
    panel.style.cssText='display:grid;gap:7px;margin-top:8px';
    panel.innerHTML='<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><button id="backgroundModeToggle" type="button" class="assign-btn" aria-pressed="false">BACKGROUND MODE: OFF</button><strong>Keep field session active while using other apps</strong></div><div id="backgroundModeStatus" class="muted small"></div><div class="muted small">Browser mode is best-effort: iOS/Android may suspend GPS or JavaScript after McCoy is backgrounded. McCoy records no fake locations during a suspension and refreshes GPS/session state immediately when you return.</div>';
    fieldControls.appendChild(panel);
    document.getElementById('backgroundModeToggle')?.addEventListener('click',()=>setBackgroundEnabled(!backgroundEnabled,true));
    renderBackgroundStatus();
  }

  async function acquireWakeLock(){
    if(!backgroundEnabled||!sessionActive()||document.visibilityState!=='visible'||!navigator.wakeLock?.request)return false;
    if(wakeLock&&!wakeLock.released)return true;
    try{
      wakeLock=await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release',()=>{wakeLock=null;renderBackgroundStatus();});
      return true;
    }catch(error){console.warn('Background Mode wake lock unavailable',error);wakeLock=null;return false;}
  }

  async function releaseWakeLock(){
    const lock=wakeLock;wakeLock=null;
    try{if(lock&&!lock.released)await lock.release();}catch{}
  }

  function schedule(delay){
    clearTimer();
    if(!activeSessionId||navigator.onLine===false)return;
    if(document.visibilityState!=='visible'&&!backgroundEnabled)return;
    const normalDelay=document.visibilityState==='visible'?HEARTBEAT_EVERY_MS:BACKGROUND_HEARTBEAT_EVERY_MS;
    timer=setTimeout(()=>sendHeartbeat(document.visibilityState==='visible'?'interval':'background_interval'),Math.max(1000,delay??normalDelay));
  }

  async function sendHeartbeat(trigger='interval'){
    clearTimer();
    if(!activeSessionId||navigator.onLine===false)return false;
    if(document.visibilityState!=='visible'&&!backgroundEnabled)return false;
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
      schedule();renderBackgroundStatus();
      return true;
    }catch(error){
      console.error('Field-session heartbeat failed',error);
      document.getElementById('fieldState')?.setAttribute('data-heartbeat','retrying');
      schedule(RETRY_AFTER_MS);renderBackgroundStatus();
      return false;
    }finally{inFlight=false;}
  }

  function start(sessionId){
    if(!sessionId)return;
    activeSessionId=sessionId;lastSuccessAt=0;hiddenAt=0;clearTimer();
    sendHeartbeat('session_start');
    if(backgroundEnabled)acquireWakeLock();
    renderBackgroundStatus();
  }

  function stop(){
    activeSessionId=null;lastSuccessAt=0;hiddenAt=0;clearTimer();releaseWakeLock();
    document.getElementById('fieldState')?.removeAttribute('data-heartbeat');renderBackgroundStatus();
  }

  function resumeIfDue(trigger){
    if(!activeSessionId)return;
    const elapsed=Date.now()-lastSuccessAt;
    if(lastSuccessAt===0||elapsed>=MIN_RESUME_GAP_MS)sendHeartbeat(trigger);
    else schedule(HEARTBEAT_EVERY_MS-elapsed);
  }

  function refreshGpsAfterResume(){
    if(!sessionActive())return;
    try{startGpsWatch?.();}catch{}
    try{requestFreshGpsInBackground?.(gps=>{if(gps)telemetryStatus('Background Mode resumed — fresh GPS acquired.',true);});}catch{}
  }

  async function setBackgroundEnabled(enabled,fromUser=false){
    backgroundEnabled=Boolean(enabled);localStorage.setItem(STORAGE_KEY,backgroundEnabled?'1':'0');
    if(backgroundEnabled){
      if(sessionActive()){await acquireWakeLock();resumeIfDue(fromUser?'background_mode_enabled':'background_mode_restore');}
    }else{
      await releaseWakeLock();
      if(document.visibilityState!=='visible')clearTimer();else schedule();
    }
    renderBackgroundStatus();
    window.dispatchEvent(new CustomEvent('mccoy-background-mode-changed',{detail:{enabled:backgroundEnabled}}));
  }

  window.addEventListener('mccoy-field-session-started',event=>start(event.detail?.sessionId));
  window.addEventListener('mccoy-field-session-ended',stop);
  window.addEventListener('online',()=>resumeIfDue('online_resume'));
  window.addEventListener('offline',clearTimer);
  window.addEventListener('pageshow',()=>{resumeIfDue('page_restore');if(backgroundEnabled){acquireWakeLock();refreshGpsAfterResume();}});
  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='visible'){
      const hiddenDuration=hiddenAt?Date.now()-hiddenAt:0;hiddenAt=0;
      resumeIfDue('visibility_resume');
      if(backgroundEnabled){acquireWakeLock();refreshGpsAfterResume();if(hiddenDuration>30_000)telemetryStatus(`Background Mode resumed after ${Math.round(hiddenDuration/1000)}s away. GPS is being refreshed.`,true);}
    }else{
      hiddenAt=Date.now();releaseWakeLock();
      if(backgroundEnabled){sendHeartbeat('visibility_hidden');schedule(BACKGROUND_HEARTBEAT_EVERY_MS);}else clearTimer();
    }
    renderBackgroundStatus();
  });
  window.addEventListener('pagehide',()=>{if(backgroundEnabled&&sessionActive())sendHeartbeat('pagehide');else clearTimer();});

  ensureBackgroundControl();
  if(state?.session&&telemetrySessionId)start(telemetrySessionId);
  window.MCCOY_FIELD_HEARTBEAT={sendNow:()=>sendHeartbeat('manual_check'),stop,setBackgroundEnabled,isBackgroundEnabled:()=>backgroundEnabled};
})();
