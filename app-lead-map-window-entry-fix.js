(()=>{
  if(window.MCCOY_LEAD_MAP_WINDOW_ENTRY_FIX)return
  window.MCCOY_LEAD_MAP_WINDOW_ENTRY_FIX=true

  const style=document.createElement('style')
  style.id='leadMapWindowEntryFixStyles'
  style.textContent=`
    #leadCorrectionPanel{display:none!important}
  `
  document.head.appendChild(style)

  const maximizeLeadPool=()=>{
    const leads=document.getElementById('leads')
    if(!leads?.classList.contains('active'))return
    const controller=window.MCCOY_LEAD_MAP_WINDOW
    if(!controller)return
    if(controller.getMode?.()==='standard')controller.maximize?.()
  }

  document.addEventListener('click',event=>{
    const view=event.target?.closest?.('[data-view]')?.dataset?.view
    if(view==='leads')setTimeout(maximizeLeadPool,0)
  },true)

  window.addEventListener('mccoy-map-lead-selected',()=>setTimeout(maximizeLeadPool,0))
  window.addEventListener('mccoy-real-leads-loaded',()=>setTimeout(maximizeLeadPool,0))
  window.addEventListener('pageshow',()=>setTimeout(maximizeLeadPool,0))

  setTimeout(maximizeLeadPool,0)
  setTimeout(maximizeLeadPool,250)
})()
