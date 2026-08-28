// Keep account confirmations on production and make desktop-browser authentication self-recovering.
// Uses bounded checks and explicit click handling only; no MutationObserver.
(()=>{
  if(window.MCCOY_AUTH_RECOVERY_CONTROL)return;
  window.MCCOY_AUTH_RECOVERY_CONTROL=true;

  const PROD_FIELD_COACH='https://mccoy-field-test.vercel.app/';
  const SIGN_IN_TIMEOUT_MS=12000;
  const ROUTE_TIMEOUT_MS=10000;
  const STARTUP_TIMEOUT_MS=10000;
  const PROJECT_REF='athxxrfqxwlfnuvbqadp';
  const AUTH_STORAGE_KEY=`sb-${PROJECT_REF}-auth-token`;
  let signInBusy=false;

  const byId=id=>document.getElementById(id);
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  function withTimeout(promise,ms,code){
    let timer;
    return Promise.race([
      Promise.resolve(promise).finally(()=>clearTimeout(timer)),
      new Promise((_,reject)=>{timer=setTimeout(()=>{const error=new Error(code);error.code=code;reject(error);},ms);})
    ]);
  }
  function setMessage(id,text,ok=false){
    const message=byId(id);
    if(message){message.textContent=text;message.style.color=ok?'#166534':'#991b1b';}
  }
  function gateFinished(){
    const gate=byId('authGate');
    return !gate||gate.classList.contains('hidden')||!gate.classList.contains('auth-checking')&&!byId('loginStep')?.classList.contains('active');
  }
  async function waitForGate(){
    const deadline=Date.now()+ROUTE_TIMEOUT_MS;
    while(Date.now()<deadline){if(gateFinished())return true;await wait(120);}
    return gateFinished();
  }
  function recoveryClient(){
    if(!window.supabase?.createClient)throw new Error('McCoy authentication library is unavailable.');
    return window.supabase.createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{
      auth:{
        storageKey:AUTH_STORAGE_KEY,
        persistSession:true,
        autoRefreshToken:false,
        detectSessionInUrl:false,
        lock:async(_name,_timeout,fn)=>fn()
      }
    });
  }
  function friendlyError(error){
    const message=String(error?.message||error||'Unable to sign in.');
    if(error?.code==='mccoy_primary_signin_timeout')return 'Chrome did not release the McCoy sign-in session. Retrying through the recovery path…';
    if(error?.code==='mccoy_recovery_signin_timeout')return 'The sign-in request timed out. Check the connection and press SIGN IN again.';
    return message;
  }

  function patchSignup(){
    const btn=byId('createAccountBtn');
    if(!btn||btn.dataset.prodRedirectPatched==='1')return false;
    btn.dataset.prodRedirectPatched='1';
    btn.onclick=async()=>{
      const name=byId('signupName')?.value.trim()||'';
      const email=byId('signupEmail')?.value.trim().toLowerCase()||'';
      const password=byId('signupPassword')?.value||'';
      const team=byId('signupTeam')?.value||'';
      if(name.length<2){setMessage('signupMsg','Enter your full name.');return;}
      if(password.length<8){setMessage('signupMsg','Use a password at least 8 characters long.');return;}
      setMessage('signupMsg','Creating account…',true);
      const {data,error}=await sb.auth.signUp({email,password,options:{data:{display_name:name,requested_team:team},emailRedirectTo:PROD_FIELD_COACH}});
      if(error){setMessage('signupMsg',error.message);return;}
      if(data.session)location.href=PROD_FIELD_COACH;
      else setMessage('signupMsg','Account created. Check your email and confirm your address. The confirmation will return you to McCoy Field Coach.',true);
    };
    return true;
  }

  function patchSignIn(){
    const button=byId('signInBtn');
    if(!button||button.dataset.mccoyAuthRecoveryPatched==='1')return false;
    button.dataset.mccoyAuthRecoveryPatched='1';
    button.onclick=async event=>{
      event?.preventDefault?.();
      if(signInBusy)return;
      const email=byId('authEmail')?.value.trim().toLowerCase()||'';
      const password=byId('authPassword')?.value||'';
      if(!email){setMessage('authMsg','Enter your email address.');return;}
      if(!password){setMessage('authMsg','Enter your password.');return;}

      signInBusy=true;
      button.disabled=true;
      const originalLabel=button.textContent;
      button.textContent='SIGNING IN…';
      setMessage('authMsg','Signing in…',true);
      try{
        let response;
        let usedRecovery=false;
        try{
          response=await withTimeout(sb.auth.signInWithPassword({email,password}),SIGN_IN_TIMEOUT_MS,'mccoy_primary_signin_timeout');
        }catch(error){
          if(error?.code!=='mccoy_primary_signin_timeout')throw error;
          usedRecovery=true;
          setMessage('authMsg','Chrome did not release the prior McCoy session. Recovering this tab…',true);
          const client=recoveryClient();
          response=await withTimeout(client.auth.signInWithPassword({email,password}),SIGN_IN_TIMEOUT_MS,'mccoy_recovery_signin_timeout');
        }
        if(response?.error)throw response.error;
        setMessage('authMsg','Signed in. Opening McCoy…',true);

        if(usedRecovery){
          try{sessionStorage.setItem('mccoy_auth_recovery_reload','1');}catch(_error){}
          location.reload();
          return;
        }

        const routed=await waitForGate();
        if(routed){
          try{sessionStorage.removeItem('mccoy_auth_recovery_reload');sessionStorage.removeItem('mccoy_auth_startup_reload');}catch(_error){}
          return;
        }

        let alreadyReloaded=false;
        try{alreadyReloaded=sessionStorage.getItem('mccoy_auth_recovery_reload')==='1';}catch(_error){}
        if(!alreadyReloaded){
          try{sessionStorage.setItem('mccoy_auth_recovery_reload','1');}catch(_error){}
          location.reload();
          return;
        }
        try{sessionStorage.removeItem('mccoy_auth_recovery_reload');}catch(_error){}
        setMessage('authMsg','Your password was accepted, but this Chrome tab did not finish opening McCoy. Close duplicate McCoy tabs, then press SIGN IN again.');
      }catch(error){
        console.error('McCoy sign-in failed',error);
        setMessage('authMsg',friendlyError(error));
      }finally{
        signInBusy=false;
        button.disabled=false;
        button.textContent=originalLabel||'SIGN IN';
      }
    };

    const password=byId('authPassword');
    if(password&&password.dataset.mccoyEnterSignIn!=='1'){
      password.dataset.mccoyEnterSignIn='1';
      password.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();button.click();}});
    }
    return true;
  }

  function recoverBlankStartup(){
    setTimeout(()=>{
      const gate=byId('authGate');
      if(!gate||gate.classList.contains('hidden')||!gate.classList.contains('auth-checking'))return;
      let alreadyReloaded=false;
      try{alreadyReloaded=sessionStorage.getItem('mccoy_auth_startup_reload')==='1';}catch(_error){}
      if(!alreadyReloaded){
        try{sessionStorage.setItem('mccoy_auth_startup_reload','1');}catch(_error){}
        location.reload();
        return;
      }
      try{sessionStorage.removeItem('mccoy_auth_startup_reload');}catch(_error){}
      gate.classList.remove('auth-checking','hidden');
      gate.querySelectorAll('.auth-step').forEach(step=>step.classList.remove('active'));
      byId('loginStep')?.classList.add('active');
      setMessage('authMsg','Chrome could not restore the prior McCoy session. Sign in again; this tab now uses the recovery path.');
      patchSignIn();
    },STARTUP_TIMEOUT_MS);
  }

  [0,50,150,350,700,1400].forEach(delay=>setTimeout(()=>{patchSignup();patchSignIn();},delay));
  recoverBlankStartup();
})();
