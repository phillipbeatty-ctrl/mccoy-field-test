// McCoy Field Coach V9.2 account switch helper.
(function(){
  function install(){
    const pending=document.getElementById('pendingStep');
    if(!pending||document.getElementById('switchAccountBtn')) return false;
    const btn=document.createElement('button');
    btn.id='switchAccountBtn';
    btn.className='assign-btn';
    btn.style.width='100%';
    btn.style.marginTop='8px';
    btn.textContent='SIGN IN AS ADMIN / DIFFERENT ACCOUNT';
    const signOut=document.getElementById('pendingSignOutBtn');
    pending.insertBefore(btn,signOut||null);
    btn.onclick=async()=>{
      btn.disabled=true;
      btn.textContent='SIGNING OUT…';
      try{await sb.auth.signOut();}catch(e){console.error(e);}
      const gate=document.getElementById('authGate');
      if(gate) gate.classList.remove('hidden');
      document.querySelectorAll('#authGate .auth-step').forEach(x=>x.classList.remove('active'));
      document.getElementById('loginStep')?.classList.add('active');
      const email=document.getElementById('authEmail'); if(email){email.value='';email.focus();}
      const pw=document.getElementById('authPassword'); if(pw)pw.value='';
      btn.disabled=false;btn.textContent='SIGN IN AS ADMIN / DIFFERENT ACCOUNT';
    };
    return true;
  }
  if(!install()){
    const timer=setInterval(()=>{if(install())clearInterval(timer);},250);
    setTimeout(()=>clearInterval(timer),10000);
  }
})();