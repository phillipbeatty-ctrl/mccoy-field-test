(()=>{
  if(window.__FIELD_COACH_ORGANIZATION_GATE_INSTALLED__)return;
  window.__FIELD_COACH_ORGANIZATION_GATE_INSTALLED__=true;

  const verifiedEventFlag='organizationAccessVerified';
  let verificationPromise=null;
  let lastOriginalDetail={};
  let replaying=false;

  const reasonCopy={
    organization_inactive:'Your organization is inactive in Field Coach.',
    subscription_required:'Your organization does not have an active Field Coach subscription.',
    subscription_payment_required:'Your organization subscription requires billing attention.',
    subscription_cancelled:'Your organization subscription has been cancelled.',
    subscription_suspended:'Your organization subscription is suspended.',
    subscription_expired:'Your organization subscription has expired.',
    subscription_inactive:'Your organization subscription is not active.',
    field_coach_access_entitlement_required:'Field Coach access is not enabled for this organization.',
    user_access_inactive:'Your individual Field Coach access is inactive.',
    organization_access_record_required:'Your account is not connected to an authorized organization.'
  };

  const style=document.createElement('style');
  style.id='fieldCoachOrganizationAccessStyles';
  style.textContent=`
    #fieldCoachOrganizationGate{position:fixed;inset:0;z-index:2147483000;display:none;place-items:center;padding:20px;background:rgba(17,24,39,.82);font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    #fieldCoachOrganizationGate.show{display:grid}
    #fieldCoachOrganizationGate .organization-gate-card{width:min(560px,100%);background:#fff;color:#111827;border-radius:18px;padding:24px;box-shadow:0 24px 80px rgba(0,0,0,.34)}
    #fieldCoachOrganizationGate h2{margin:0 0 10px;font-size:24px}
    #fieldCoachOrganizationGate p{margin:8px 0;color:#4b5563;line-height:1.5}
    #fieldCoachOrganizationGate .organization-gate-detail{margin-top:14px;padding:12px;border-radius:10px;background:#f3f4f6;font-size:13px}
    #fieldCoachOrganizationGate .organization-gate-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:18px}
    #fieldCoachOrganizationGate button{border:0;border-radius:10px;padding:11px 15px;font-weight:800;cursor:pointer}
    #fieldCoachOrganizationGate .organization-gate-primary{background:#111827;color:#fff}
    #fieldCoachOrganizationGate .organization-gate-secondary{background:#e5e7eb;color:#111827}
    body.organization-access-blocked #app{visibility:hidden!important;pointer-events:none!important}
  `;
  document.head.appendChild(style);

  const gate=document.createElement('div');
  gate.id='fieldCoachOrganizationGate';
  gate.setAttribute('role','dialog');
  gate.setAttribute('aria-modal','true');
  gate.setAttribute('aria-labelledby','fieldCoachOrganizationGateTitle');
  gate.innerHTML=`
    <div class="organization-gate-card">
      <h2 id="fieldCoachOrganizationGateTitle">Checking organization access…</h2>
      <p id="fieldCoachOrganizationGateMessage">Field Coach is confirming your organization's access before loading business data.</p>
      <div id="fieldCoachOrganizationGateDetail" class="organization-gate-detail" hidden></div>
      <div class="organization-gate-actions">
        <button id="fieldCoachOrganizationGateRetry" class="organization-gate-primary" type="button">CHECK AGAIN</button>
        <button id="fieldCoachOrganizationGateSignOut" class="organization-gate-secondary" type="button">SIGN OUT</button>
      </div>
      <p><small>Organization subscriptions are managed outside the mobile app. Contact your organization administrator for access or billing assistance.</small></p>
    </div>`;
  document.body.appendChild(gate);

  const title=gate.querySelector('#fieldCoachOrganizationGateTitle');
  const message=gate.querySelector('#fieldCoachOrganizationGateMessage');
  const detail=gate.querySelector('#fieldCoachOrganizationGateDetail');
  const retry=gate.querySelector('#fieldCoachOrganizationGateRetry');
  const signOut=gate.querySelector('#fieldCoachOrganizationGateSignOut');

  function showChecking(){
    document.body.classList.add('organization-access-blocked');
    gate.classList.add('show');
    title.textContent='Checking organization access…';
    message.textContent='Field Coach is confirming your organization subscription and access entitlement.';
    detail.hidden=true;
    retry.disabled=true;
    retry.textContent='CHECKING…';
  }

  function showBlocked(state,error){
    document.body.classList.add('organization-access-blocked');
    gate.classList.add('show');
    const reason=String(state?.denial_reason||'organization_access_unavailable');
    const unavailable=!!error;
    title.textContent=unavailable?'Access check unavailable':'Organization access required';
    message.textContent=unavailable
      ?'Field Coach could not verify organization access. Business data remains locked until the server check succeeds.'
      :(reasonCopy[reason]||'Your organization is not currently authorized to use Field Coach.');
    const values=[];
    if(state?.organization_name)values.push(`Organization: ${state.organization_name}`);
    if(state?.plan_code)values.push(`Plan: ${state.plan_code}`);
    if(state?.subscription_status)values.push(`Subscription: ${state.subscription_status}`);
    values.push(`Reason: ${reason}`);
    detail.textContent=values.join(' · ');
    detail.hidden=false;
    retry.disabled=false;
    retry.textContent='CHECK AGAIN';
    window.FIELD_COACH_ORGANIZATION_ACCESS={verified:!unavailable,allowed:false,state,error:error?String(error.message||error):null};
  }

  function allow(state){
    window.FIELD_COACH_ORGANIZATION_ACCESS={verified:true,allowed:true,state,error:null};
    gate.classList.remove('show');
    document.body.classList.remove('organization-access-blocked');
  }

  async function loadState(){
    if(typeof sb==='undefined'||!sb?.rpc)throw new Error('organization_access_client_unavailable');
    const {data,error}=await sb.rpc('current_organization_access_state');
    if(error)throw error;
    if(!data||typeof data!=='object')throw new Error('organization_access_state_missing');
    return data;
  }

  async function verify({replayEvent=true,originalDetail=null}={}){
    if(originalDetail)lastOriginalDetail=originalDetail;
    if(verificationPromise)return verificationPromise;

    verificationPromise=(async()=>{
      showChecking();
      try{
        const state=await loadState();
        if(state.access_allowed!==true){
          showBlocked(state,null);
          return state;
        }
        allow(state);
        if(replayEvent&&window.MCCOY_ACCESS?.user&&!replaying){
          replaying=true;
          try{
            window.dispatchEvent(new CustomEvent('mccoy-access-ready',{
              detail:{...(lastOriginalDetail||{}),[verifiedEventFlag]:true,organizationAccess:state}
            }));
          }finally{
            replaying=false;
          }
        }
        return state;
      }catch(error){
        console.error('Field Coach organization access verification failed',error);
        showBlocked(null,error);
        return null;
      }finally{
        verificationPromise=null;
      }
    })();
    return verificationPromise;
  }

  window.addEventListener('mccoy-access-ready',event=>{
    if(event?.detail?.[verifiedEventFlag]===true)return;
    event.stopImmediatePropagation();
    lastOriginalDetail=event?.detail||{};
    void verify({replayEvent:true,originalDetail:lastOriginalDetail});
  },true);

  retry.addEventListener('click',()=>void verify({replayEvent:!!window.MCCOY_ACCESS?.user}));
  signOut.addEventListener('click',async()=>{
    signOut.disabled=true;
    signOut.textContent='SIGNING OUT…';
    try{if(typeof sb!=='undefined')await sb.auth.signOut({scope:'local'});}catch(error){console.warn('Organization gate sign out failed',error);}
    location.replace('/');
  });

  async function inspectAuthenticatedSession(){
    try{
      if(typeof sb==='undefined'||!sb?.auth)return;
      const {data}=await sb.auth.getUser();
      if(!data?.user)return;
      if(window.FIELD_COACH_ORGANIZATION_ACCESS?.verified)return;
      const state=await loadState();
      if(state.access_allowed!==true)showBlocked(state,null);
      else if(window.MCCOY_ACCESS?.user)await verify({replayEvent:true});
    }catch(error){
      console.warn('Deferred organization access inspection failed',error);
    }
  }

  setTimeout(()=>void inspectAuthenticatedSession(),250);
  setTimeout(()=>void inspectAuthenticatedSession(),1200);
  window.FIELD_COACH_RECHECK_ORGANIZATION_ACCESS=()=>verify({replayEvent:!!window.MCCOY_ACCESS?.user});
})();
