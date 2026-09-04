// Field Coach organization subscription and entitlement gate.
// Loaded before the rest of the application so no business-data initializer
// receives mccoy-access-ready until the server confirms organization access.
(()=>{
  const REQUIRED_ENTITLEMENT='field_coach_access';
  const VERIFIED_EVENT='organization_access_verified';
  const ACCESS_CHECK_TIMEOUT_MS=12000;
  let accessSnapshot=null;
  let checkPromise=null;
  let organizationState=null;
  let verifiedUserKey=null;

  window.FIELD_COACH_ORGANIZATION_ACCESS=null;

  function userKey(user){
    return String(user?.id||user?.email||'').trim().toLowerCase();
  }

  function hasVerifiedAccessFor(current){
    const key=userKey(current?.user);
    return Boolean(
      key&&
      verifiedUserKey===key&&
      organizationState?.access_allowed===true
    );
  }

  function hideGate(){
    document.body.classList.remove('organization-access-blocked');
    document.getElementById('organizationAccessGate')?.classList.remove('show');
  }

  function ensureGate(){
    let gate=document.getElementById('organizationAccessGate');
    if(gate)return gate;
    const style=document.createElement('style');
    style.id='organizationAccessGateStyles';
    style.textContent=`
      #organizationAccessGate{position:fixed;inset:0;z-index:210000;display:none;align-items:center;justify-content:center;padding:18px;background:#f4f6f8;color:#111827}
      #organizationAccessGate.show{display:flex}
      #organizationAccessGate .organization-access-card{width:min(520px,100%);background:#fff;border:1px solid #e5e7eb;border-radius:18px;padding:24px;box-shadow:0 18px 60px rgba(0,0,0,.16)}
      #organizationAccessGate h2{margin:0 0 8px}
      #organizationAccessGate p{font-size:14px;line-height:1.5;color:#4b5563}
      #organizationAccessGate .organization-access-state{margin:14px 0;padding:12px;border-radius:10px;background:#f3f4f6;font-size:13px;line-height:1.45}
      #organizationAccessGate .organization-access-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:16px}
      #organizationAccessGate button{border:0;border-radius:10px;padding:11px 14px;font-weight:800;cursor:pointer}
      #organizationAccessGate .primary{background:#111827;color:#fff}
      #organizationAccessGate .secondary{background:#e5e7eb;color:#111827}
      #organizationAccessGate button:disabled{opacity:.65;cursor:progress}
    `;
    document.head.appendChild(style);
    gate=document.createElement('div');
    gate.id='organizationAccessGate';
    gate.setAttribute('role','dialog');
    gate.setAttribute('aria-modal','true');
    gate.setAttribute('aria-labelledby','organizationAccessTitle');
    gate.innerHTML=`
      <div class="organization-access-card">
        <h2 id="organizationAccessTitle">Checking organization access</h2>
        <p id="organizationAccessMessage">Field Coach is confirming that this account belongs to an active organization with the required access.</p>
        <div id="organizationAccessState" class="organization-access-state">Checking subscription and entitlement status…</div>
        <div class="organization-access-actions">
          <button id="organizationAccessRetry" type="button" class="primary" hidden>RECHECK ACCESS</button>
          <button id="organizationAccessSignOut" type="button" class="secondary">SIGN OUT</button>
        </div>
      </div>`;
    document.body.appendChild(gate);
    document.getElementById('organizationAccessRetry').addEventListener('click',()=>verifyAndRelease(true));
    document.getElementById('organizationAccessSignOut').addEventListener('click',async()=>{
      try{await sb.auth.signOut();}finally{location.reload();}
    });
    return gate;
  }

  function denialMessage(reason){
    const messages={
      organization_inactive:'This organization is inactive.',
      organization_suspended:'Organization access is suspended.',
      organization_cancelled:'Organization access has been cancelled.',
      subscription_missing:'No active organization subscription was found.',
      subscription_inactive:'The organization subscription is not active.',
      subscription_expired:'The organization subscription period has ended.',
      subscription_period_missing:'The organization subscription period could not be verified.',
      trial_subscription_inactive:'The organization trial is not active.',
      trial_expiration_missing:'The organization trial expiration could not be verified.',
      trial_expired:'The organization trial has ended.',
      past_due_status_mismatch:'The organization billing state could not be verified.',
      grace_period_missing:'The organization payment grace period could not be verified.',
      past_due_grace_expired:'The organization payment grace period has ended.',
      entitlement_disabled:'Field Coach access is not enabled for this organization.',
      seat_limit_exceeded:'The organization has more active users than its current seat limit.',
      organization_membership_required:'This account is not attached to an active organization.',
      active_user_access_required:'This account does not have active Field Coach access.',
      auth_user_not_found:'The signed-in account could not be verified.',
      access_check_timeout:'The access check took too long. Check your connection and select RECHECK ACCESS.',
      access_check_unavailable:'Field Coach could not verify organization access. No business data has been loaded.'
    };
    return messages[reason]||'Organization access is not currently available.';
  }

  function showChecking(){
    const gate=ensureGate();
    gate.classList.add('show');
    document.body.classList.add('organization-access-blocked');
    document.getElementById('organizationAccessTitle').textContent='Checking organization access';
    document.getElementById('organizationAccessMessage').textContent='Field Coach is confirming that this account belongs to an active organization with the required access.';
    document.getElementById('organizationAccessState').textContent='Checking subscription and entitlement status…';
    const retry=document.getElementById('organizationAccessRetry');
    retry.hidden=true;
    retry.disabled=true;
  }

  function showDenied(state){
    verifiedUserKey=null;
    const gate=ensureGate();
    const reason=String(state?.denial_reason||'access_check_unavailable');
    const organization=state?.organization_name||'Your organization';
    const billing=state?.billing_status?`Billing status: ${state.billing_status}.`:'';
    const subscription=state?.subscription_status?` Subscription status: ${state.subscription_status}.`:'';
    gate.classList.add('show');
    document.body.classList.add('organization-access-blocked');
    document.getElementById('organizationAccessTitle').textContent='Organization access unavailable';
    document.getElementById('organizationAccessMessage').textContent=`${organization} does not currently have verified access to Field Coach. Contact your organization administrator or billing administrator.`;
    document.getElementById('organizationAccessState').textContent=`${denialMessage(reason)} ${billing}${subscription}`.trim();
    const retry=document.getElementById('organizationAccessRetry');
    retry.hidden=false;
    retry.disabled=false;
    retry.textContent='RECHECK ACCESS';
  }

  function releaseApplication(state){
    organizationState=state;
    verifiedUserKey=userKey(accessSnapshot?.user);
    window.FIELD_COACH_ORGANIZATION_ACCESS=state;
    window.MCCOY_ACCESS=accessSnapshot;
    hideGate();
    window.dispatchEvent(new CustomEvent('mccoy-access-ready',{
      detail:{
        [VERIFIED_EVENT]:true,
        organization_access:state
      }
    }));
  }

  async function fetchState(entitlement=REQUIRED_ENTITLEMENT){
    let timeoutId;
    const timeout=new Promise((_,reject)=>{
      timeoutId=setTimeout(()=>{
        const timeoutError=new Error('organization_access_timeout');
        timeoutError.code='access_check_timeout';
        reject(timeoutError);
      },ACCESS_CHECK_TIMEOUT_MS);
    });
    let response;
    try{
      response=await Promise.race([
        sb.functions.invoke('organization-access',{body:{action:'status',entitlement}}),
        timeout
      ]);
    }finally{
      clearTimeout(timeoutId);
    }
    const {data,error}=response;
    if(error)throw error;
    const state=data?.organization_access||data;
    if(!state||typeof state.access_allowed!=='boolean')throw new Error('invalid_organization_access_response');
    return state;
  }

  async function verifyAndRelease(manual=false){
    if(checkPromise)return checkPromise;
    const retry=document.getElementById('organizationAccessRetry');
    if(manual&&retry){retry.disabled=true;retry.textContent='CHECKING…';}
    checkPromise=(async()=>{
      try{
        const state=await fetchState(REQUIRED_ENTITLEMENT);
        organizationState=state;
        window.FIELD_COACH_ORGANIZATION_ACCESS=state;
        if(state.access_allowed===true){
          releaseApplication(state);
          return state;
        }
        showDenied(state);
        return state;
      }catch(error){
        console.error('Organization access verification failed',error);
        const denied={
          schema_version:1,
          access_allowed:false,
          denial_reason:error?.code==='access_check_timeout'?'access_check_timeout':'access_check_unavailable',
          entitlement_key:REQUIRED_ENTITLEMENT,
          purchase_model:'organization_managed_external',
          purchase_action_available:false
        };
        organizationState=denied;
        window.FIELD_COACH_ORGANIZATION_ACCESS=denied;
        showDenied(denied);
        return denied;
      }finally{
        checkPromise=null;
      }
    })();
    return checkPromise;
  }

  window.FIELD_COACH_CHECK_ORGANIZATION_ACCESS=fetchState;
  window.FIELD_COACH_REQUIRE_ENTITLEMENT=async entitlement=>{
    const state=await fetchState(entitlement||REQUIRED_ENTITLEMENT);
    if(state.access_allowed!==true){
      const error=new Error(`organization_access_denied:${state.denial_reason||'access_denied'}`);
      error.organization_access=state;
      throw error;
    }
    return state;
  };

  window.addEventListener('mccoy-access-ready',event=>{
    if(event.detail?.[VERIFIED_EVENT]===true)return;
    const current=window.MCCOY_ACCESS;
    if(!current?.user||!current?.access?.active)return;

    const currentUserKey=userKey(current.user);
    if(verifiedUserKey&&verifiedUserKey!==currentUserKey){
      verifiedUserKey=null;
      organizationState=null;
      window.FIELD_COACH_ORGANIZATION_ACCESS=null;
    }

    accessSnapshot={user:current.user,access:current.access};

    // Supabase may emit repeated SIGNED_IN or TOKEN_REFRESHED events while the
    // same user remains signed in. app-auth replays mccoy-access-ready for those
    // events. Once this page has verified that user, let the replay continue
    // without blocking the app or showing the full-screen checking gate again.
    if(hasVerifiedAccessFor(current)){
      window.FIELD_COACH_ORGANIZATION_ACCESS=organizationState;
      hideGate();
      return;
    }

    // This listener is loaded before all business modules. Stop the first
    // access event for a user, remove effective access synchronously, verify
    // server state, then replay the event only after the organization gate passes.
    event.stopImmediatePropagation();
    window.MCCOY_ACCESS={user:current.user,access:null};
    showChecking();
    verifyAndRelease(false);
  },true);
})();
