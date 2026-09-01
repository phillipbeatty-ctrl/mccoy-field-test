// V9.2 consent + server version gate. Proprietary analytics and session-control rules run only on the server.
const MCCOY_CLIENT_VERSION='9.2-auto-stop';
const MCCOY_PRIVACY_NOTICE='2026-08-24-v2';
const MCCOY_CANONICAL_PRODUCTION_URL='https://mccoy-field-test.vercel.app/';
const MCCOY_PRODUCTION_HOSTS=new Set([
  'mccoy-field-test.vercel.app',
  'mccoyplatform.com',
  'www.mccoyplatform.com',
  'mccoy-field-test-phillipbeatty-6762s-projects.vercel.app',
  'mccoy-field-test-git-main-phillipbeatty-6762s-projects.vercel.app'
]);
const MCCOY_APP_SHELL_CACHE_PREFIXES=['mccoy-app-shell-','field-coach-app-shell-'];
let mccoyConsentAccepted=false;
let mccoyVersionAllowed=false;

(function(){
  const css=document.createElement('style');
  css.textContent=`
    #privacyModal,#updateGate{position:fixed;inset:0;z-index:100000;background:rgba(17,24,39,.78);display:none;align-items:center;justify-content:center;padding:16px}
    #privacyModal.show,#updateGate.show{display:flex}
    .privacy-card{width:min(680px,100%);max-height:88vh;overflow:auto;background:white;border-radius:16px;padding:22px}
    .privacy-card p,.privacy-card li{font-size:13px;line-height:1.45;color:#4b5563}
    .privacy-check{display:flex;gap:8px;margin:12px 0;padding:10px;background:#f8fafc;border-radius:10px}
    .privacy-footer-link{position:fixed;left:12px;bottom:12px;z-index:9999;background:white;border:1px solid #ddd;border-radius:999px;padding:6px 9px;font-size:11px}
    .app-update-action{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:11px 16px;border-radius:10px;text-decoration:none;cursor:pointer;font-weight:800}
    .app-update-action[aria-busy="true"]{cursor:progress;opacity:.8}
    .app-update-status{min-height:20px;margin:10px 0 0}
  `;
  document.head.appendChild(css);

  const privacy=document.createElement('div');
  privacy.id='privacyModal';
  privacy.innerHTML=`<div class="privacy-card"><h2>Privacy & Location Notice</h2><p>McCoy Platform LLC collects account/device information and, with consent, precise location while you are signed in and the app is open for field work. This includes lightweight Sales/Hour workday samples whether or not Start Knocking is active, route breadcrumbs, door actions, dispositions, visit timing, sales, and session events. A private Home location may be saved by you solely for workday-exit detection.</p><p>Server systems may derive Sales/Hour workday windows, assigned-area entry and exit, homeward or outbound travel, coaching, safety, customer-comfort, proximity, movement, stop, idle, session-control, and compensation-related analytics. Authorized McCoy Admins may review those analytics; Managers and Trainers remain assignment-scoped. One lunch hour is excluded from Sales/Hour, and Sunday is excluded. McCoy does not sell precise location data or use it for cross-context behavioral advertising. Questions or applicable privacy-rights requests may be sent to phillip.beatty@gmail.com.</p><label class="privacy-check"><input id="consentLocation" type="checkbox"><span>I consent to precise location collection while signed in for field work, including Sales/Hour presence samples outside an active Start Knocking session.</span></label><label class="privacy-check"><input id="consentAnalytics" type="checkbox"><span>I acknowledge that workday, location, Sales/Hour, coaching, and session-control analytics may be generated server-side and reviewed by authorized McCoy personnel.</span></label><button id="acceptPrivacyBtn" class="primary">ACCEPT & CONTINUE</button> <button id="closePrivacyBtn" class="assign-btn">CLOSE</button><p class="muted small">Notice ${MCCOY_PRIVACY_NOTICE}</p></div>`;
  document.body.appendChild(privacy);

  const update=document.createElement('div');
  update.id='updateGate';
  update.innerHTML='<div class="privacy-card"><h2>Update Required</h2><p>This build is no longer supported. Open the current production app to continue. Older, cached, preview, or copied builds cannot create valid production field sessions.</p><a id="reloadCurrentBtn" class="primary app-update-action" href="https://mccoy-field-test.vercel.app/?app_update=manual">UPDATE APP</a><p id="appUpdateStatus" class="muted small app-update-status" aria-live="polite">The update opens the current production build and removes only stale McCoy/Field Coach app-shell caches.</p></div>';
  document.body.appendChild(update);

  const updateButton=document.getElementById('reloadCurrentBtn');
  const updateStatus=document.getElementById('appUpdateStatus');
  let updateInProgress=false;
  let updateNavigationStarted=false;

  function buildProductionUpdateUrl(){
    const host=String(window.location.hostname||'').toLowerCase();
    const protocol=String(window.location.protocol||'').toLowerCase();
    const currentOriginIsProduction=MCCOY_PRODUCTION_HOSTS.has(host)&&(protocol==='https:'||protocol==='http:');
    const base=currentOriginIsProduction?window.location.origin:MCCOY_CANONICAL_PRODUCTION_URL;
    const target=new URL('/',base);
    target.searchParams.set('app_update',String(Date.now()));
    return target;
  }

  function navigateToProduction(target){
    if(updateNavigationStarted)return;
    updateNavigationStarted=true;
    try{window.location.replace(target.href);}
    catch(error){console.warn('App update replace navigation failed',error);window.location.href=target.href;}
  }

  async function removeStaleAppShell(){
    if('serviceWorker' in navigator&&typeof navigator.serviceWorker.getRegistrations==='function'){
      try{
        const registrations=await navigator.serviceWorker.getRegistrations();
        const sameOrigin=registrations.filter(registration=>{
          try{return new URL(registration.scope).origin===window.location.origin;}
          catch(_error){return false;}
        });
        await Promise.all(sameOrigin.map(async registration=>{
          try{await registration.update();}catch(_error){}
          try{registration.waiting?.postMessage({type:'SKIP_WAITING'});}catch(_error){}
          try{registration.installing?.postMessage({type:'SKIP_WAITING'});}catch(_error){}
          try{await registration.unregister();}catch(_error){}
        }));
      }catch(error){console.warn('Unable to unregister the stale app worker',error);}
    }

    if('caches' in window&&typeof window.caches.keys==='function'){
      try{
        const keys=await window.caches.keys();
        const appShellKeys=keys.filter(key=>MCCOY_APP_SHELL_CACHE_PREFIXES.some(prefix=>key.startsWith(prefix)));
        await Promise.all(appShellKeys.map(key=>window.caches.delete(key)));
      }catch(error){console.warn('Unable to clear the stale app shell cache',error);}
    }
  }

  async function registerFreshProductionWorker(target){
    if(target.origin!==window.location.origin)return;
    if(!('serviceWorker' in navigator)||typeof navigator.serviceWorker.register!=='function')return;
    try{
      const registration=await navigator.serviceWorker.register('/service-worker.js',{scope:'/',updateViaCache:'none'});
      try{await registration.update();}catch(_error){}
      try{registration.waiting?.postMessage({type:'SKIP_WAITING'});}catch(_error){}
      try{registration.installing?.postMessage({type:'SKIP_WAITING'});}catch(_error){}
    }catch(error){console.warn('Unable to register the current app worker before navigation',error);}
  }

  async function refreshInstalledApp(target){
    await removeStaleAppShell();
    await registerFreshProductionWorker(target);
  }

  async function forceProductionUpdate(event){
    event?.preventDefault();
    if(updateInProgress)return;
    updateInProgress=true;
    const target=buildProductionUpdateUrl();
    updateButton.href=target.href;
    updateButton.setAttribute('aria-busy','true');
    updateButton.textContent='OPENING CURRENT APP…';
    updateStatus.textContent='Removing the stale app shell and opening the current production build…';

    // Navigation is guaranteed even when an older browser hangs while inspecting
    // service workers or caches. The anchor href remains a no-JavaScript fallback.
    const forcedNavigation=setTimeout(()=>navigateToProduction(target),1600);
    try{
      await Promise.race([
        refreshInstalledApp(target),
        new Promise(resolve=>setTimeout(resolve,1100))
      ]);
    }catch(error){
      console.warn('App update cleanup failed; continuing to production',error);
      updateStatus.textContent='Opening the current production build…';
    }finally{
      clearTimeout(forcedNavigation);
      navigateToProduction(target);
    }
  }

  const initialTarget=buildProductionUpdateUrl();
  updateButton.href=initialTarget.href;
  updateButton.addEventListener('click',forceProductionUpdate);
  window.MCCOY_FORCE_PRODUCTION_UPDATE=forceProductionUpdate;

  document.getElementById('closePrivacyBtn').onclick=()=>privacy.classList.remove('show');
  const link=document.createElement('button');
  link.className='privacy-footer-link';
  link.textContent='Privacy & Location Notice';
  link.onclick=()=>privacy.classList.add('show');
  document.body.appendChild(link);

  async function cfg(key){
    const {data}=await sb.from('app_config').select('value').eq('key',key).maybeSingle();
    return data?.value||null;
  }

  async function refresh(){
    const user=window.MCCOY_ACCESS?.user;
    if(!user)return false;
    const min=await cfg('min_supported_version');
    mccoyVersionAllowed=min===MCCOY_CLIENT_VERSION;
    if(!mccoyVersionAllowed){
      updateNavigationStarted=false;
      updateInProgress=false;
      updateButton.removeAttribute('aria-busy');
      updateButton.textContent='UPDATE APP';
      updateButton.href=buildProductionUpdateUrl().href;
      updateStatus.textContent=`Installed build ${MCCOY_CLIENT_VERSION}; current required build ${min||'unavailable'}.`;
      update.classList.add('show');
      return false;
    }
    const {data}=await sb.from('privacy_acceptances').select('id').eq('user_id',user.id).eq('notice_version',MCCOY_PRIVACY_NOTICE).eq('precise_location_consent',true).eq('work_activity_analytics_consent',true).limit(1);
    mccoyConsentAccepted=!!data?.length;
    return true;
  }

  document.getElementById('acceptPrivacyBtn').onclick=async()=>{
    const user=window.MCCOY_ACCESS?.user;
    if(!user)return;
    if(!document.getElementById('consentLocation').checked||!document.getElementById('consentAnalytics').checked){
      alert('Both acknowledgments are required before a tracked field session can begin.');
      return;
    }
    const {error}=await sb.from('privacy_acceptances').insert({
      user_id:user.id,
      email:user.email,
      notice_version:MCCOY_PRIVACY_NOTICE,
      precise_location_consent:true,
      work_activity_analytics_consent:true,
      user_agent:navigator.userAgent
    });
    if(error){
      console.error(error);
      alert('Consent could not be recorded.');
      return;
    }
    mccoyConsentAccepted=true;
    privacy.classList.remove('show');
  };

  document.getElementById('startKnockingBtn')?.addEventListener('click',async event=>{
    await refresh();
    if(!mccoyVersionAllowed){
      event.preventDefault();
      event.stopImmediatePropagation();
      update.classList.add('show');
      return;
    }
    if(!mccoyConsentAccepted){
      event.preventDefault();
      event.stopImmediatePropagation();
      privacy.classList.add('show');
    }
  },true);

  saveTestSessionStart=async function(startedAt){
    const {data:{user}}=await sb.auth.getUser();
    if(!user)return false;
    await refresh();
    if(!mccoyVersionAllowed||!mccoyConsentAccepted)return false;
    const access=window.MCCOY_ACCESS?.access;
    if(!access)return false;
    telemetrySessionId=uuidv4();
    const {error}=await sb.from('test_sessions').insert({
      id:telemetrySessionId,
      tester_name:access.display_name||user.email,
      tester_user_id:user.id,
      tester_email:user.email,
      started_at:new Date(startedAt).toISOString(),
      user_agent:navigator.userAgent,
      app_version:MCCOY_CLIENT_VERSION
    });
    if(error){
      console.error(error);
      telemetrySessionId=null;
      return false;
    }
    return true;
  };

  const poll=setInterval(async()=>{
    if(window.MCCOY_ACCESS?.user){
      clearInterval(poll);
      await refresh();
      if(!mccoyConsentAccepted)privacy.classList.add('show');
    }
  },500);
})();
