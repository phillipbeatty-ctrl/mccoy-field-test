// The current end-of-shift destination is maintained by the user's manager or Admin.
(()=>{
  if(window.MCCOY_SPH_HOME_ADMIN_ONLY)return
  window.MCCOY_SPH_HOME_ADMIN_ONLY=true
  let configured=null,label=''
  const setText=(element,value)=>{if(element&&element.textContent!==value)element.textContent=value}
  const apply=detail=>{
    if(typeof detail?.homeConfigured==='boolean')configured=detail.homeConfigured
    if(typeof detail?.homeLabel==='string')label=detail.homeLabel
    // Reapply after every base-module render, including sign-in and visibility refresh.
    document.getElementById('sphEditHome')?.remove()
    document.getElementById('sphHomeEditor')?.remove()
    document.body.classList.remove('sph-home-editor-open')
    const display=document.getElementById('sphHomeAddressDisplay')
    setText(display,configured===true&&label?label:'Ask your manager to set your end-of-shift address')
    setText(document.getElementById('sphWorkdayTitle'),'End-of-shift address · Home / Blitz lodging')
    const card=document.getElementById('sphWorkdayControl')
    if(!card)return
    let note=document.getElementById('sphDestinationNote')
    if(!note){note=document.createElement('p');note.id='sphDestinationNote';note.className='muted small';card.appendChild(note)}
    setText(note,'Where you will go after the shift. Your manager or Admin can update it when lodging changes.')
    const allowed=window.MCCOY_ACCESS?.access?.active===true&&['admin','manager','trainer'].includes(window.MCCOY_ACCESS?.access?.role)
    let manage=document.getElementById('sphManageHomes')
    if(allowed&&!manage){
      manage=document.createElement('button');manage.id='sphManageHomes';manage.type='button';manage.className='assign-btn'
      manage.textContent='MANAGE END-OF-SHIFT ADDRESSES';manage.style.minHeight='44px'
      manage.onclick=()=>window.MCCOY_HOME_SETTINGS?.open()
      card.appendChild(manage)
    }
    if(!allowed)manage?.remove()
  }
  window.addEventListener('mccoy-sph-workday-ready',event=>apply(event.detail))
  window.addEventListener('mccoy-access-ready',()=>{configured=null;label='';apply()})
  window.addEventListener('mccoy-home-settings-updated',event=>{
    if(event.detail?.userIds?.includes(window.MCCOY_ACCESS?.user?.id))window.MCCOY_SPH_PRESENCE?.refresh?.().catch(()=>{})
  })
  if(document.getElementById('sphWorkdayControl')){
    window.MCCOY_SPH_PRESENCE?.refresh?.().catch(error=>console.error('Home status refresh failed',error))
  }
})();
