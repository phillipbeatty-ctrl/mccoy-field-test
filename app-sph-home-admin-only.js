// Home location is managed by Admin; field users only see configuration status.
(()=>{
  if(window.MCCOY_SPH_HOME_ADMIN_ONLY)return
  window.MCCOY_SPH_HOME_ADMIN_ONLY=true
  let configured=null
  let editorRemoved=false
  const setText=(element,value)=>{if(element&&element.textContent!==value)element.textContent=value}
  const apply=detail=>{
    if(typeof detail?.homeConfigured==='boolean')configured=detail.homeConfigured
    if(!editorRemoved){
      document.getElementById('sphEditHome')?.remove()
      document.getElementById('sphHomeEditor')?.remove()
      editorRemoved=true
    }
    document.body.classList.remove('sph-home-editor-open')
    const display=document.getElementById('sphHomeAddressDisplay')
    setText(display,configured===true?'Home address configured by Admin':'Ask Admin to configure your Home address')
    const title=document.getElementById('sphWorkdayTitle')
    setText(title,'Automatic Sales / Hour Workday')
  }
  window.addEventListener('mccoy-sph-workday-ready',event=>apply(event.detail))
  if(document.getElementById('sphWorkdayControl')){
    window.MCCOY_SPH_PRESENCE?.refresh?.().catch(error=>console.error('Home status refresh failed',error))
  }
})();
