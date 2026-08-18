// McCoy Field Coach V9.2 persistent admin logout control.
(function(){
  const css=document.createElement('style');
  css.textContent=`#adminLogoutBtn{position:fixed;top:12px;right:12px;z-index:200000;display:none;border:1px solid #d1d5db;border-radius:10px;padding:9px 12px;background:#fff;color:#111827;font-size:12px;font-weight:700;box-shadow:0 4px 16px rgba(0,0,0,.12);cursor:pointer}#adminLogoutBtn:disabled{opacity:.6;cursor:default}`;
  document.head.appendChild(css);

  const btn=document.createElement('button');
  btn.id='adminLogoutBtn';
  btn.type='button';
  btn.textContent='SIGN OUT';
  document.body.appendChild(btn);

  btn.onclick=async()=>{
    btn.disabled=true;
    btn.textContent='SIGNING OUT…';
    try{await sb.auth.signOut();}catch(e){console.error('Sign out failed',e);}
    window.MCCOY_ACCESS={user:null,access:null};
    location.reload();
  };

  function sync(){
    const isAdmin=window.MCCOY_ACCESS?.access?.role==='admin';
    btn.style.display=isAdmin?'block':'none';
  }
  sync();
  const timer=setInterval(sync,300);
  window.addEventListener('beforeunload',()=>clearInterval(timer));
})();