(()=>{
  if(window.MCCOY_LEAD_MAP_WINDOW_ENTRY_FIX)return
  window.MCCOY_LEAD_MAP_WINDOW_ENTRY_FIX=true

  let selectedLeadId=null
  const byId=id=>document.getElementById(id)

  const style=document.createElement('style')
  style.id='leadMapWindowEntryFixStyles'
  style.textContent=`
    #leadCorrectionPanel{display:none!important}
    #leadMapMovePinLauncher{position:absolute;z-index:1375;right:18px;bottom:22px;display:none;align-items:center;justify-content:center;min-width:92px;min-height:44px;padding:0 13px;border:0;border-radius:999px;background:rgba(255,255,255,.94);box-shadow:0 3px 14px rgba(15,23,42,.26);font:800 11px/1 system-ui;letter-spacing:.025em;color:#172033;touch-action:manipulation;-webkit-tap-highlight-color:transparent}
    #leadMapMovePinLauncher.show{display:flex}
  `
  document.head.appendChild(style)

  function ensureLauncher(){
    const canvas=byId('leadMapFrame')
    if(!canvas)return null
    let button=byId('leadMapMovePinLauncher')
    if(button)return button
    button=document.createElement('button')
    button.id='leadMapMovePinLauncher'
    button.type='button'
    button.textContent='MOVE PIN'
    button.setAttribute('aria-label','MOVE PIN')
    button.addEventListener('click',event=>{
      event.preventDefault();event.stopPropagation()
      if(!selectedLeadId)return
      window.MCCOY_LEAD_MAP_WINDOW?.beginMovePin?.(selectedLeadId)
    })
    canvas.appendChild(button)
    window.L?.DomEvent?.disableClickPropagation?.(button)
    return button
  }

  function syncLauncher(){
    const button=ensureLauncher()
    if(!button)return
    const standard=window.MCCOY_LEAD_MAP_WINDOW?.getMode?.()==='standard'
    const leadsActive=byId('leads')?.classList.contains('active')
    button.classList.toggle('show',Boolean(selectedLeadId&&standard&&leadsActive))
  }

  window.addEventListener('mccoy-map-lead-selected',event=>{
    selectedLeadId=event.detail?.leadId||null
    setTimeout(syncLauncher,0)
  })
  window.addEventListener('mccoy-map-lead-deleted',event=>{
    if(String(event.detail?.leadId||'')===String(selectedLeadId||''))selectedLeadId=null
    setTimeout(syncLauncher,0)
  })
  window.addEventListener('mccoy-lead-map-window-mode-changed',syncLauncher)
  document.addEventListener('click',event=>{
    const view=event.target?.closest?.('[data-view]')?.dataset?.view
    if(view!==undefined)setTimeout(syncLauncher,0)
    if(event.target?.closest?.('#clearMapSelectionBtn')){selectedLeadId=null;setTimeout(syncLauncher,0)}
  },true)
  window.addEventListener('pageshow',()=>setTimeout(syncLauncher,0))
  setTimeout(syncLauncher,0)
  setTimeout(syncLauncher,250)
})()
