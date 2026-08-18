// McCoy Field Coach V9.2 secure session initializer.
// This is the authoritative Start Knocking controller for V9.2.
(function(){
  window.MCCOY_SECURE_SESSION_INIT=true;
  const CLIENT_VERSION='9.2-auto-stop';
  const startBtn=document.getElementById('startKnockingBtn');
  if(!startBtn) return;
  function setStartBusy(busy,label){startBtn.disabled=busy;startBtn.textContent=busy?(label||'CONNECTING…'):'START KNOCKING';}
  function fail(message){telemetryStatus(message,false);document.getElementById('fieldState').textContent='Not knocking';setStartBusy(false);}
  async function oneConfig(key){const {data,error}=await sb.from('app_config').select('value').eq('key',key).maybeSingle();if(error)throw new Error(`Configuration check failed: ${error.message}`);return data?.value||null;}
  async function hasConsent(userId,noticeVersion){const {data,error}=await sb.from('privacy_acceptances').select('id').eq('user_id',userId).eq('notice_version',noticeVersion).eq('precise_location_consent',true).eq('work_activity_analytics_consent',true).limit(1);if(error)throw new Error(`Privacy consent check failed: ${error.message}`);return !!data?.length;}
  startBtn.addEventListener('click',async(e)=>{
    e.preventDefault();e.stopImmediatePropagation();if(state.session)return;setStartBusy(true,'VERIFYING…');telemetryStatus('Verifying field session…',true);
    try{
      const {data:{user},error:userError}=await sb.auth.getUser();if(userError||!user)throw new Error('You are not signed in. Sign in again before starting a field session.');
      const access=window.MCCOY_ACCESS?.access;if(!access?.role)throw new Error('Your McCoy Field Coach access could not be verified. Sign out and sign back in.');
      const [minimumVersion,noticeVersion]=await Promise.all([oneConfig('min_supported_version'),oneConfig('privacy_notice_version')]);
      if(minimumVersion!==CLIENT_VERSION){document.getElementById('updateGate')?.classList.add('show');throw new Error('This version needs to be refreshed before starting a field session.');}
      if(!(await hasConsent(user.id,noticeVersion))){document.getElementById('privacyModal')?.classList.add('show');throw new Error('Privacy and location consent must be accepted before starting a tracked session.');}
      setStartBusy(true,'CONNECTING…');const startedAt=Date.now(),newSessionId=uuidv4();
      const {error:insertError}=await sb.from('test_sessions').insert({id:newSessionId,tester_name:access.display_name||user.email,tester_user_id:user.id,tester_email:user.email,started_at:new Date(startedAt).toISOString(),user_agent:navigator.userAgent,app_version:CLIENT_VERSION});
      if(insertError)throw new Error(`Field session connection failed: ${insertError.message}`);
      telemetrySessionId=newSessionId;let gps=null;try{gps=await getGPSOnce();state.latestGps=gps;}catch(err){console.warn('Initial GPS unavailable',err);}
      state.session={startedAt,startGps:gps};state.lastTelemetryBreadcrumbAt=0;state.lastDispositionEndedAt=null;if(gps)state.breadcrumbs.push({...gps,eventType:'session_start'});startGpsWatch();startTimer();
      document.getElementById('fieldState').textContent='Knocking — Session Active';startBtn.classList.add('hidden');document.getElementById('stopKnockingBtn').classList.remove('hidden');
      document.getElementById('geoBox').textContent=gps?`Start GPS: ${gps.lat.toFixed(6)}, ${gps.lng.toFixed(6)} (±${Math.round(gps.accuracy)}m)`:'Session connected; waiting for a location fix.';updateGpsQualityBox(gps?{...gps,ageMs:0}:null);telemetryStatus('Field session connected.',true);setStartBusy(false);
      await saveTestEvent({eventType:'session_start',eventTime:startedAt,gps,payload:{rawEvent:true,clientVersion:CLIENT_VERSION}});
      window.MCCOY_SESSION_CONTROL?.beginControlLoop?.();
    }catch(err){console.error('Secure session start failed',err);telemetrySessionId=null;fail(err?.message||'Field session could not be started.');}
  },true);
})();