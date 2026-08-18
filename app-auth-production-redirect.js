// Force all new McCoy Field Coach account confirmations to the production app.
(()=>{
  const PROD_FIELD_COACH='https://mccoy-field-test.vercel.app/field-coach.html';
  function patchSignup(){
    const btn=document.getElementById('createAccountBtn');
    if(!btn||btn.dataset.prodRedirectPatched==='1')return false;
    btn.dataset.prodRedirectPatched='1';
    btn.onclick=async()=>{
      const name=document.getElementById('signupName')?.value.trim()||'';
      const email=document.getElementById('signupEmail')?.value.trim().toLowerCase()||'';
      const password=document.getElementById('signupPassword')?.value||'';
      const team=document.getElementById('signupTeam')?.value||'';
      const msg=document.getElementById('signupMsg');
      const set=(text,ok=false)=>{if(msg){msg.textContent=text;msg.style.color=ok?'#166534':'#991b1b';}};
      if(name.length<2){set('Enter your full name.');return;}
      if(password.length<8){set('Use a password at least 8 characters long.');return;}
      set('Creating account...',true);
      const {data,error}=await sb.auth.signUp({
        email,password,
        options:{
          data:{display_name:name,requested_team:team},
          emailRedirectTo:PROD_FIELD_COACH
        }
      });
      if(error){set(error.message);return;}
      if(data.session){
        location.href=PROD_FIELD_COACH;
      }else{
        set('Account created. Check your email and confirm your address. The confirmation will return you to McCoy Field Coach.',true);
      }
    };
    return true;
  }
  if(!patchSignup()){
    const obs=new MutationObserver(()=>{if(patchSignup())obs.disconnect();});
    obs.observe(document.documentElement,{childList:true,subtree:true});
  }
})();
