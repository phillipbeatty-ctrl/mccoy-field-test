// Google verification is deliberately bounded to one Admin-confirmed batch per
// click. Never auto-resume a paid geocoding run after reload.
(()=>{
  async function sync(){
    const btn=document.getElementById('geocodeRealLeadsBtn');
    if(!btn)return;
    const access=window.MCCOY_ACCESS?.access;
    if(!access?.active||access.role!=='admin')return;
    btn.textContent='VERIFY NEXT 25 WITH GOOGLE';
  }
  window.MCCOY_RESUME_GEOCODING=()=>Promise.resolve({ok:false,reason:'admin_confirmation_required'});
  window.addEventListener('mccoy-real-leads-loaded',()=>setTimeout(sync,100));
  window.addEventListener('mccoy-access-ready',()=>setTimeout(sync,100));
  setTimeout(sync,800);
})();
