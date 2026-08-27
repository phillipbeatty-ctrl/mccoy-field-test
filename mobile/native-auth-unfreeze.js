// Capacitor-only auth recovery. Bypasses a stalled Supabase client lock, verifies access directly, and opens Field Coach without reloading.
(function(){
  const isNative=['localhost','127.0.0.1'].includes(location.hostname)||location.protocol==='capacitor:'||location.protocol==='ionic:';
  if(!isNative)return;

  const PROJECT_REF='athxxrfqxwlfnuvbqadp';
  const STORAGE_KEY=`sb-${PROJECT_REF}-auth-token`;
  let busy=false,lastHandledAt=0;
  const withTimeout=(promise,ms,label)=>Promise.race([promise,new Promise((_,reject)=>setTimeout(()=>reject(new Error(label)),ms))]);
  const cfg=()=>({
    url:(typeof SUPABASE_URL!=='undefined'&&SUPABASE_URL)||window.sb?.supabaseUrl||'https://athxxrfqxwlfnuvbqadp.supabase.co',
    key:(typeof SUPABASE_PUBLISHABLE_KEY!=='undefined'&&SUPABASE_PUBLISHABLE_KEY)||window.sb?.supabaseKey||''
  });
  const gate=()=>document.getElementById('authGate');
  const setMessage=(text,ok=false)=>{const el=document.getElementById('authMsg');if(el){el.textContent=text;el.style.color=ok?'#166534':'#991b1b';}};

  function makeInteractive(){
    if(!document.getElementById('nativeAuthUnfreezeStyle')){
      const style=document.createElement('style');
      style.id='nativeAuthUnfreezeStyle';
      style.textContent=`#authGate{pointer-events:auto!important}#authGate .auth-card,#authGate input,#authGate button,#authGate select,#authGate textarea{pointer-events:auto!important;touch-action:manipulation!important}#authGate[data-native-unlocked="1"]{display:none!important}`;
      document.head.appendChild(style);
    }
    const root=gate();
    if(root&&!root.dataset.nativeUnlocked)root.classList.remove('auth-checking');
  }

  function normalizedSession(raw){
    if(!raw?.access_token||!raw?.refresh_token)return null;
    const expiresIn=Number(raw.expires_in||3600);
    return {...raw,token_type:raw.token_type||'bearer',expires_in:expiresIn,expires_at:Number(raw.expires_at||Math.floor(Date.now()/1000)+expiresIn)};
  }

  function saveSession(session){
    try{localStorage.setItem(STORAGE_KEY,JSON.stringify(session));}catch(_error){}
  }

  function readStoredSession(){
    try{return normalizedSession(JSON.parse(localStorage.getItem(STORAGE_KEY)||'null'));}catch(_error){return null;}
  }

  async function statusFor(accessToken){
    const {url,key}=cfg();
    const response=await withTimeout(fetch(`${url}/functions/v1/rep-onboarding`,{
      method:'POST',
      headers:{Authorization:`Bearer ${accessToken}`,apikey:key,'Content-Type':'application/json'},
      body:JSON.stringify({action:'status'})
    }),12000,'Access check timed out.');
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data?.error||`Access check failed (${response.status}).`);
    return data;
  }

  function installUserStrip(user,access){
    let strip=document.getElementById('userStrip');
    if(!strip){strip=document.createElement('div');strip.id='userStrip';strip.className='user-strip';document.body.appendChild(strip);}
    strip.innerHTML=`<span>${access.display_name||user?.email||''} · ${access.role||''}</span><button id="signOutBtn">Sign out</button>`;
    const out=document.getElementById('signOutBtn');
    if(out)out.onclick=async()=>{try{await window.sb?.auth?.signOut({scope:'local'});}catch(_error){}try{localStorage.removeItem(STORAGE_KEY);}catch(_error){}location.reload();};
  }

  function applyAccess(session,status){
    const access=status?.access;
    if(!access?.active)return false;
    const user=session.user||status.user||{email:access.email};
    window.MCCOY_ACCESS={user,access};
    document.body.classList.toggle('blind-tester',String(access.role||'').toLowerCase()!=='admin');
    const root=gate();
    if(root){root.dataset.nativeUnlocked='1';root.classList.remove('auth-checking');root.classList.add('hidden');root.style.display='none';}
    if(String(access.role||'').toLowerCase()!=='admin'){
      const title=document.getElementById('pageTitle');if(title)title.textContent='McCoy Field Coach V9.2';
      const arrive=document.getElementById('arriveDoorBtn');if(arrive)arrive.textContent='PHYSICALLY KNOCKED';
      document.querySelectorAll('.view').forEach(view=>view.classList.remove('active'));
      document.getElementById('field')?.classList.add('active');
    }else{
      const arrive=document.getElementById('arriveDoorBtn');if(arrive)arrive.textContent='ARRIVE AT DOOR / START VISIT';
    }
    installUserStrip(user,access);
    window.dispatchEvent(new Event('mccoy-access-ready'));
    window.dispatchEvent(new CustomEvent('mccoy-native-auth-ready',{detail:{role:access.role,email:user?.email||access.email||null}}));
    return true;
  }

  async function openSession(session){
    const normalized=normalizedSession(session);
    if(!normalized)return false;
    const status=await statusFor(normalized.access_token);
    return applyAccess(normalized,status);
  }

  async function passwordGrant(email,password){
    const {url,key}=cfg();
    const response=await withTimeout(fetch(`${url}/auth/v1/token?grant_type=password`,{
      method:'POST',
      headers:{apikey:key,'Content-Type':'application/json'},
      body:JSON.stringify({email,password})
    }),15000,'Sign in timed out. Check the connection and retry.');
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data?.error_description||data?.msg||data?.message||'Unable to sign in.');
    const session=normalizedSession(data);
    if(!session)throw new Error('Supabase did not return a usable session.');
    saveSession(session);
    try{await withTimeout(window.sb.auth.setSession({access_token:session.access_token,refresh_token:session.refresh_token}),3500,'Client session sync timed out.');}catch(_error){}
    return session;
  }

  async function handleSignIn(event){
    const button=event.target?.closest?.('#signInBtn');
    if(!button)return;
    const now=Date.now();
    if(now-lastHandledAt<700)return;
    lastHandledAt=now;
    event.preventDefault();event.stopImmediatePropagation();
    if(busy)return;
    const email=document.getElementById('authEmail')?.value.trim().toLowerCase()||'';
    const password=document.getElementById('authPassword')?.value||'';
    if(!email||!password){setMessage('Enter your email and password.');return;}
    busy=true;button.disabled=true;button.textContent='SIGNING IN…';setMessage('Signing in…',true);
    try{
      const session=await passwordGrant(email,password);
      const opened=await openSession(session);
      if(!opened)throw new Error('This account is signed in but does not have active Field Coach access.');
      setMessage('Signed in.',true);
    }catch(error){
      setMessage(error?.message||'Unable to sign in.');
      button.disabled=false;button.textContent='SIGN IN';busy=false;
    }
  }

  document.addEventListener('pointerup',handleSignIn,true);
  document.addEventListener('click',handleSignIn,true);
  document.addEventListener('keydown',event=>{
    if(event.key!=='Enter'||!document.getElementById('loginStep')?.classList.contains('active'))return;
    event.preventDefault();document.getElementById('signInBtn')?.click();
  },true);

  makeInteractive();
  setTimeout(async()=>{
    makeInteractive();
    let session=null;
    try{session=(await withTimeout(window.sb?.auth?.getSession?.(),2500,'Session restore timed out.'))?.data?.session||null;}catch(_error){}
    session=normalizedSession(session)||readStoredSession();
    if(!session)return;
    try{await openSession(session);}catch(error){makeInteractive();setMessage(error?.message||'Sign in to continue.');}
  },50);
})();
