// Home location is managed by Admin; field users only see configuration status.
(()=>{
  if(window.MCCOY_SPH_HOME_ADMIN_ONLY)return
  window.MCCOY_SPH_HOME_ADMIN_ONLY=true
  let configured=null
  const apply=detail=>{
    if(typeof detail?.homeConfigured==='boolean')configured=detail.homeConfigured
    document.getElementById('sphEditHome')?.remove()
    document.getElementById('sphHomeEditor')?.remove()
    document.body.classList.remove('sph-home-editor-open')
    const display=document.getElementById('sphHomeAddressDisplay')
    if(display)display.textContent=configured===true?'Home address configured by Admin':'Ask Admin to configure your Home address'
    const title=document.getElementById('sphWorkdayTitle')
    if(title)title.textContent='Automatic Sales / Hour Workday'
  }
  window.addEventListener('mccoy-sph-workday-ready',event=>apply(event.detail))
  window.addEventListener('mccoy-access-ready',()=>setTimeout(()=>apply(),0))
  new MutationObserver(()=>apply()).observe(document.body,{childList:true,subtree:true})
})();
