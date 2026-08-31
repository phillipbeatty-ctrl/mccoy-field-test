// Keep McCoy signup on the production confirmation flow and fail closed when production email is not ready.
(()=>{
  const PROD_APP='https://mccoy-field-test.vercel.app/';
  const PROD_CONFIRM='https://mccoy-field-test.vercel.app/confirm-email.html';
  async function productionEmailReady(){
    try{
      const {data,error}=await sb.functions.invoke('auth-email-status',{body:{}});
      return !error&&data?.production_ready===true;
    }catch(_error){return false;}
  }
  function patchSignup(){
    const btn=document.getElementById('createAccountBtn');
    if(!btn||btn.dataset.prodRedirectPatched==='20260831.3')return false;
    btn.dataset.prodRedirectPatched='20260831.3';
    btn.onclick=async()=>{
      const name=document.getElementById('signupName')?.value.trim()||'';
      const email=document.getElementById('signupEmail')?.value.trim().toLowerCase()||'';
      const password=document.getElementById('signupPassword')?.value||'';
      const team=document.getElementById('signupTeam')?.value||'';
      const msg=document.getElementById('signupMsg');
      const set=(text,ok=false)=>{if(msg){msg.textContent=text;msg.style.color=ok?'#166534':'#991b1b';}};
      if(name.length<2){set('Enter your full name.');return;}
      if(!email.includes('@')){set('Enter a valid email address.');return;}
      if(password.length<8){set('Use a password at least 8 characters long.');return;}
      btn.disabled=true;
      set('Checking production email delivery…',true);
      try{
        if(!(await productionEmailReady())){
          set('Account creation is temporarily paused because McCoy production confirmation email is not active. Admin must finish the verified SMTP setup before new accounts can be created.');
          return;
        }
        set('Creating account and requesting confirmation…',true);
        const {data,error}=await sb.auth.signUp({
          email,password,
          options:{
            data:{display_name:name,requested_team:team},
            emailRedirectTo:PROD_CONFIRM
          }
        });
        if(error){set(error.message);return;}
        if(data.session){location.href=PROD_APP;}
        else{
          set('Account created. A McCoy confirmation was requested through the production email provider. Check inbox, spam, and junk. The link returns to McCoy.',true);
        }
      }finally{btn.disabled=false;}
    };
    return true;
  }
  if(!patchSignup()){
    const obs=new MutationObserver(()=>{if(patchSignup())obs.disconnect();});
    obs.observe(document.documentElement,{childList:true,subtree:true});
  }
})();
