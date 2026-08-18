// V9.1 secure session initializer.
// This capture-phase handler prevents the legacy local session-start listener from running.
// A field session becomes active only after auth, authorization, consent, version, and Supabase session creation succeed.
(function(){
  const CLIENT_VERSION='9.0-server-analytics';
  const startBtn=document.getElementById('startKnockingBtn');
  if(!startBtn) return;

  function setStartBusy(busy,label){
    startBtn.disabled=busy;
    startBtn.textContent=busy?(label||'CONNECTING…'):'START KNOCKING';
  }
  function fail(message){
    telemetryStatus(message,false);
    document.getElementById('fieldState').textContent='Not knocking';
    setStartBusy(false);
  }
  async function oneConfig(key){
    const {data,error}=await sb.from('app_config').select('value').eq('key',key).maybeSingle();
    if(error) throw new Error(`Configuration check failed: ${error.message}`);
    return data?.value||null;
  }
  async function hasConsent(userId,noticeVersion){
    const {data,error}=await sb.from('privacy_acceptances')
      .select('id')
      .eq('user_id',userId)
      .eq('notice_version',noticeVersion)
      .eq('precise_location_consent',true)
      .eq('work_activity_analytics_consent',true)
      .limit(1);
    if(error) throw new Error(`Privacy consent check failed: ${error.message}`);
    return !!data?.length;
  }

  startBtn.addEventListener('click',async(e)=>{
    // Block every previously registered bubble-phase Start Knocking handler immediately.
    e.preventDefault();
    e.stopImmediatePropagation();
    if(state.session) return;
    setStartBusy(true,'VERIFYING…');
    telemetryStatus('Verifying secure field session…',true);

    try{
      const {data:{user},error:userError}=await sb.auth.getUser();
      if(userError||!user) throw new Error('You are not signed in. Sign in again before starting a field session.');

      const access=window.MCCOY_ACCESS?.access;
      if(!access?.active && !access?.role) throw new Error('Your McCoy Field access could not be verified. Sign out and sign back in.');

      const [minimumVersion,noticeVersion]=await Promise.all([
        oneConfig('min_supported_version'),
        oneConfig('privacy_notice_version')
      ]);
      if(minimumVersion!==CLIENT_VERSION){
        document.getElementById('updateGate')?.classList.add('show');
        throw new Error(`Update required. Server requires ${minimumVersion||'a newer version'}.`);
      }

      const consented=await hasConsent(user.id,noticeVersion);
      if(!consented){
        document.getElementById('privacyModal')?.classList.add('show');
        throw new Error('Privacy and location consent must be accepted before starting a tracked session.');
      }

      setStartBusy(true,'CONNECTING…');
      const startedAt=Date.now();
      const newSessionId=uuidv4();
      const {error:insertError}=await sb.from('test_sessions').insert({
        id:newSessionId,
        tester_name:access.display_name||user.email,
        tester_user_id:user.id,
        tester_email:user.email,
        started_at:new Date(startedAt).toISOString(),
        user_agent:navigator.userAgent,
        app_version:CLIENT_VERSION
      });
      if(insertError) throw new Error(`Telemetry session rejected: ${insertError.message}`);

      telemetrySessionId=newSessionId;

      // Only now is the field session allowed to become active and request/capture location.
      let gps=null;
      try{gps=await getGPSOnce();state.latestGps=gps;}catch(err){
        console.warn('Initial GPS unavailable',err);
      }
      state.session={startedAt,startGps:gps};
      state.lastTelemetryBreadcrumbAt=0;
      if(gps) state.breadcrumbs.push({...gps,eventType:'session_start'});
      startGpsWatch();
      startTimer();

      document.getElementById('fieldState').textContent='Knocking — Session Active';
      startBtn.classList.add('hidden');
      document.getElementById('stopKnockingBtn').classList.remove('hidden');
      document.getElementById('geoBox').textContent=gps
        ?`Start GPS: ${gps.lat.toFixed(6)}, ${gps.lng.toFixed(6)} (±${Math.round(gps.accuracy)}m)`
        :'Session connected; waiting for a location fix.';
      updateGpsQualityBox(gps?{...gps,ageMs:0}:null);
      telemetryStatus('Live test telemetry connected.',true);
      setStartBusy(false);
      await saveTestEvent({eventType:'session_start',eventTime:startedAt,gps,payload:{rawEvent:true,clientVersion:CLIENT_VERSION}});
    }catch(err){
      console.error('Secure session start failed',err);
      telemetrySessionId=null;
      fail(err?.message||'Secure session could not be started.');
    }
  },true);
})();
