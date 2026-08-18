// V8.1 privacy, consent, and version-security layer.
// Browser code is never a secret. This layer reduces retention/casual copying and makes obsolete clients operationally unusable through a server-enforced version gate.
const MCCOY_CLIENT_VERSION='8.1-security-privacy';
const MCCOY_PRIVACY_CONTACT='phillip.beatty@gmail.com';
let mccoyPrivacyVersion='2026-08-17-v1';
let mccoyConsentAccepted=false;
let mccoyVersionAllowed=false;

(function(){
  const style=document.createElement('style');
  style.textContent=`
  #privacyModal,#updateGate{position:fixed;inset:0;z-index:100000;background:rgba(17,24,39,.76);display:none;align-items:center;justify-content:center;padding:16px}
  #privacyModal.show,#updateGate.show{display:flex!important}.privacy-card{width:min(680px,100%);max-height:88vh;overflow:auto;background:#fff;border-radius:16px;padding:22px;box-shadow:0 18px 60px rgba(0,0,0,.25)}
  .privacy-card h2{margin:0 0 8px}.privacy-card h3{margin:18px 0 6px;font-size:15px}.privacy-card p,.privacy-card li{font-size:13px;line-height:1.45;color:#4b5563}.privacy-check{display:flex;gap:9px;align-items:flex-start;margin:12px 0;padding:11px;background:#f8fafc;border-radius:10px}.privacy-check input{margin-top:3px}.privacy-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}.privacy-link{background:none;border:0;text-decoration:underline;cursor:pointer;font-size:12px}.privacy-footer-link{position:fixed;left:12px;bottom:12px;z-index:9999;background:#fff;border:1px solid #ddd;border-radius:999px;padding:6px 9px;font-size:11px;cursor:pointer}
  `;
  document.head.appendChild(style);

  const modal=document.createElement('div');modal.id='privacyModal';
  modal.innerHTML=`<div class="privacy-card"><h2>Privacy Notice & Location Consent</h2><p><strong>McCoy Platform LLC</strong> uses McCoy Field for authorized field-sales operations. This notice explains the data collected while you use the app, including during active knocking sessions.</p>
  <h3>Information collected</h3><p>Account identity (name/email), device/browser information, precise geolocation, GPS accuracy and timestamps, movement/route breadcrumbs, selected leads, physical-knock actions, dispositions, visit/dwell timing, door/property proximity, walking and stop patterns, off-route/idle patterns, and analytics inferred from those records.</p>
  <h3>Why we use it</h3><p>Lead and territory operations; documenting field activity; improving route and door-to-door efficiency; coaching and quality review; customer-comfort and safety analysis; detecting inaccurate or incomplete field records; troubleshooting; security; compensation/operational review where applicable; and improving McCoy Field.</p>
  <h3>Who may receive it</h3><p>Authorized McCoy Platform administrators/managers and service providers that host or process the app and data (currently including Supabase and Vercel), plus disclosures required for legal, safety, security, or business-compliance purposes. McCoy Platform does not use this test app to sell precise location data or share it for cross-context behavioral advertising.</p>
  <h3>When location is collected</h3><p>Precise location and work-activity telemetry are collected during an active <strong>Start Knocking</strong> session and at field actions such as physical knocks and dispositions. Device location permission can also be controlled through your operating-system/browser settings; disabling required location access may prevent field-session use.</p>
  <h3>Retention & security</h3><p>Records are retained only for as long as reasonably necessary for testing, field operations, coaching, security, disputes, legal obligations, and system improvement, using role-based access and database security controls. Retention may vary according to operational and legal requirements.</p>
  <h3>Your choices and rights</h3><p>You may stop an active knocking session to stop session-based field tracking. Depending on where you live and applicable law, you may also have rights to request access, correction, deletion, or limits on certain uses of personal information. Requests or privacy questions may be sent to <strong>${MCCOY_PRIVACY_CONTACT}</strong>. Some records may be retained where legally or operationally required.</p>
  <h3>Workplace notice</h3><p>McCoy Field is a work/contractor field-operations tool. Location and activity records may be reviewed by authorized managers/admins for coaching, operations, verification, safety, and related business purposes. The tester interface intentionally does not display all analytics, but this notice discloses that those analytics are collected and generated.</p>
  <div class="privacy-check"><input id="consentLocation" type="checkbox"><label for="consentLocation"><strong>I consent to precise location collection</strong> during active field sessions and field actions for the purposes described above.</label></div>
  <div class="privacy-check"><input id="consentAnalytics" type="checkbox"><label for="consentAnalytics"><strong>I acknowledge work-activity analytics</strong>, including movement, door/visit timing, stops, proximity and inferred field-effort patterns, may be generated and reviewed as described above.</label></div>
  <div class="privacy-actions"><button id="acceptPrivacyBtn" class="primary">ACCEPT & CONTINUE</button><button id="closePrivacyBtn" class="assign-btn">CLOSE</button></div><p class="muted small">Notice version <span id="privacyVersionLabel"></span></p></div>`;
  document.body.appendChild(modal);

  const updateGate=document.createElement('div');updateGate.id='updateGate';updateGate.innerHTML=`<div class="privacy-card"><h2>Update Required</h2><p>This build is no longer supported. Reload the official McCoy Field site to obtain the current version. Older or copied builds cannot create valid field telemetry sessions.</p><button id="reloadCurrentBtn" class="primary">RELOAD CURRENT VERSION</button></div>`;document.body.appendChild(updateGate);
  document.getElementById('reloadCurrentBtn').onclick=()=>location.reload();
  document.getElementById('closePrivacyBtn').onclick=()=>modal.classList.remove('show');

  const privacyLink=document.createElement('button');privacyLink.className='privacy-footer-link';privacyLink.textContent='Privacy & Location Notice';privacyLink.onclick=()=>showPrivacy();document.body.appendChild(privacyLink);

  async function configValue(key){const {data,error}=await sb.from('app_config').select('value').eq('key',key).maybeSingle();return error?null:data?.value;}
  async function refreshSecurityState(){
    const access=window.MCCOY_ACCESS?.access,user=window.MCCOY_ACCESS?.user;if(!access||!user)return false;
    const [minVersion,noticeVersion]=await Promise.all([configValue('min_supported_version'),configValue('privacy_notice_version')]);
    if(noticeVersion)mccoyPrivacyVersion=noticeVersion;
    document.getElementById('privacyVersionLabel').textContent=mccoyPrivacyVersion;
    mccoyVersionAllowed=minVersion===MCCOY_CLIENT_VERSION;
    if(!mccoyVersionAllowed){document.getElementById('updateGate').classList.add('show');return false;}
    const {data}=await sb.from('privacy_acceptances').select('id').eq('user_id',user.id).eq('notice_version',mccoyPrivacyVersion).eq('precise_location_consent',true).eq('work_activity_analytics_consent',true).limit(1);
    mccoyConsentAccepted=!!data?.length;return true;
  }
  function showPrivacy(){document.getElementById('privacyVersionLabel').textContent=mccoyPrivacyVersion;modal.classList.add('show');}
  document.getElementById('acceptPrivacyBtn').onclick=async()=>{
    const user=window.MCCOY_ACCESS?.user;if(!user)return;
    if(!document.getElementById('consentLocation').checked||!document.getElementById('consentAnalytics').checked){alert('Both acknowledgments are required before a tracked field session can begin.');return;}
    const {error}=await sb.from('privacy_acceptances').insert({user_id:user.id,email:user.email,notice_version:mccoyPrivacyVersion,precise_location_consent:true,work_activity_analytics_consent:true,user_agent:navigator.userAgent});
    if(error){console.error(error);alert('Consent could not be recorded. Please try again.');return;}
    mccoyConsentAccepted=true;modal.classList.remove('show');
  };

  // Stop the existing Start Knocking handler before it can collect location unless current-version + consent checks pass.
  document.getElementById('startKnockingBtn')?.addEventListener('click',async(e)=>{
    await refreshSecurityState();
    if(!mccoyVersionAllowed){e.preventDefault();e.stopImmediatePropagation();document.getElementById('updateGate').classList.add('show');return;}
    if(!mccoyConsentAccepted){e.preventDefault();e.stopImmediatePropagation();showPrivacy();}
  },true);

  // Override the prototype writer so the server-enforced version exactly matches this client.
  const originalGetAccess=()=>window.MCCOY_ACCESS?.access;
  saveTestSessionStart=async function(startedAt){
    const {data:{user},error:userError}=await sb.auth.getUser();if(userError||!user)return false;
    await refreshSecurityState();if(!mccoyVersionAllowed||!mccoyConsentAccepted)return false;
    const access=originalGetAccess();if(!access)return false;
    telemetrySessionId=uuidv4();
    const {error}=await sb.from('test_sessions').insert({id:telemetrySessionId,tester_name:access.display_name||user.email,tester_user_id:user.id,tester_email:user.email,started_at:new Date(startedAt).toISOString(),user_agent:navigator.userAgent,app_version:MCCOY_CLIENT_VERSION});
    if(error){console.error('Telemetry session insert failed',error);telemetrySessionId=null;if(String(error.message||'').includes('unsupported_app_version'))document.getElementById('updateGate').classList.add('show');return false;}return true;
  };

  const authPoll=setInterval(async()=>{if(window.MCCOY_ACCESS?.user){clearInterval(authPoll);await refreshSecurityState();}},500);
})();