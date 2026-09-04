(()=>{
  if(window.MCCOY_LEAD_MAP_WINDOW_CONTROLS)return
  window.MCCOY_LEAD_MAP_WINDOW_CONTROLS=true

  const STANDARD='standard'
  const EXPANDED='expanded'
  const ACTION_MENU='action-menu'
  const DISPOSITION='disposition'
  const MOVE_PIN='move-pin'
  let mode=STANDARD
  let selectedLead=null
  let mountedWorkflow=null
  let hintTimer=null
  let longPressTimer=null
  let suppressClick=false

  const byId=id=>document.getElementById(id)
  const panel=byId('leadMapPanel')
  const canvas=byId('leadMapFrame')
  if(!panel||!canvas)return

  const mapCard=canvas.closest('.card')
  mapCard?.classList.add('lead-map-window-card')

  const style=document.createElement('style')
  style.id='leadMapWindowControlStyles'
  style.textContent=`
    .lead-map-window-card{position:relative}
    #leadMapWindowControls{position:absolute;z-index:1400;top:max(10px,env(safe-area-inset-top));left:max(10px,env(safe-area-inset-left));display:flex;gap:2px;padding:3px;border-radius:999px;background:rgba(255,255,255,.94);box-shadow:0 3px 14px rgba(15,23,42,.28);backdrop-filter:blur(8px)}
    .map-window-control{appearance:none;-webkit-appearance:none;width:44px!important;height:44px!important;min-width:44px!important;min-height:44px!important;margin:0!important;padding:0!important;border:0!important;border-radius:50%!important;background:transparent!important;display:grid!important;place-items:center;touch-action:manipulation;-webkit-tap-highlight-color:transparent;cursor:pointer}
    .map-window-control:focus-visible{outline:3px solid #1455d9!important;outline-offset:1px}
    .map-window-control[aria-disabled="true"]{cursor:default;opacity:.42;filter:saturate(.45)}
    .map-window-lamp{width:16px;height:16px;border-radius:50%;display:grid;place-items:center;box-shadow:inset 0 0 0 1px rgba(15,23,42,.28),0 1px 2px rgba(15,23,42,.24);color:#172033}
    .map-window-lamp svg{width:10px;height:10px;stroke:currentColor;stroke-width:2.1;fill:none;stroke-linecap:round;stroke-linejoin:round}
    .map-window-lamp-green{background:#30d158}.map-window-lamp-yellow{background:#ffd60a}.map-window-lamp-red{background:#ff453a}
    .map-window-more{font:900 8px/1 system-ui;letter-spacing:-1px;transform:translateY(-1px)}
    #leadMapWindowHint{position:absolute;z-index:1450;top:max(61px,calc(env(safe-area-inset-top) + 51px));left:max(10px,env(safe-area-inset-left));padding:6px 9px;border-radius:7px;background:#111827;color:#fff;font:800 11px/1.1 system-ui;letter-spacing:.035em;box-shadow:0 3px 10px rgba(0,0,0,.28);opacity:0;transform:translateY(-4px);pointer-events:none;transition:opacity .14s ease,transform .14s ease}
    #leadMapWindowHint.show{opacity:1;transform:translateY(0)}
    #leadMapActionMenu{position:absolute;z-index:1390;top:max(64px,calc(env(safe-area-inset-top) + 54px));left:max(10px,env(safe-area-inset-left));display:none;gap:8px;padding:10px;border-radius:12px;background:rgba(255,255,255,.97);box-shadow:0 8px 24px rgba(15,23,42,.28)}
    #leadMapActionMenu.show{display:grid}
    #leadMapActionMenu button{min-height:44px;min-width:132px}
    #leadMapSelectedAddress{position:absolute;z-index:1350;left:max(10px,env(safe-area-inset-left));bottom:max(28px,calc(env(safe-area-inset-bottom) + 22px));max-width:min(430px,calc(100% - 20px));display:none;padding:8px 11px;border-radius:10px;background:rgba(17,24,39,.92);color:#fff;font:700 12px/1.35 system-ui;box-shadow:0 4px 14px rgba(0,0,0,.28)}
    #leadMapSelectedAddress.show{display:block}
    #leadMapWorkflowSheet{position:absolute;z-index:1380;left:max(10px,env(safe-area-inset-left));bottom:max(58px,calc(env(safe-area-inset-bottom) + 52px));width:min(430px,calc(100% - 20px));max-height:min(68vh,620px);display:none;overflow:auto;padding:12px;border-radius:14px;background:rgba(255,255,255,.98);box-shadow:0 10px 32px rgba(15,23,42,.34)}
    #leadMapWorkflowSheet.show{display:block}
    .lead-map-workflow-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:9px}
    .lead-map-workflow-head strong{font-size:13px}.lead-map-workflow-head button{min-height:44px;min-width:76px}
    body.lead-map-window-open{overflow:hidden!important;overscroll-behavior:none}
    #leadMapPanel.lead-map-window-expanded{position:fixed!important;inset:0!important;z-index:190000!important;display:block!important;padding:0!important;margin:0!important;background:#e5e7eb}
    #leadMapPanel.lead-map-window-expanded>.grid-2{display:block!important;width:100%!important;height:100%!important;margin:0!important}
    #leadMapPanel.lead-map-window-expanded>.grid-2>.lead-map-window-card{display:flex!important;position:relative!important;width:100%!important;height:100%!important;max-width:none!important;margin:0!important;padding:0!important;border:0!important;border-radius:0!important;overflow:hidden}
    #leadMapPanel.lead-map-window-expanded>.grid-2>.card:not(.lead-map-window-card){display:none!important}
    #leadMapPanel.lead-map-window-expanded #realLeadMapHeader,#leadMapPanel.lead-map-window-expanded #leadGeoControls{display:none!important}
    #leadMapPanel.lead-map-window-expanded #leadMapFrame{width:100%!important;height:100%!important;min-height:100dvh!important;border:0!important;border-radius:0!important}
    #leadMapPanel.lead-map-window-expanded .leaflet-top.leaflet-left{top:max(64px,calc(env(safe-area-inset-top) + 54px))}
    @media(max-width:620px){
      #leadMapWorkflowSheet{left:max(8px,env(safe-area-inset-left));width:calc(100% - max(16px,env(safe-area-inset-left) + env(safe-area-inset-right)));max-height:56vh}
      #leadMapSelectedAddress{left:max(8px,env(safe-area-inset-left));max-width:calc(100% - max(16px,env(safe-area-inset-left) + env(safe-area-inset-right)))}
    }
    @media(prefers-reduced-motion:reduce){#leadMapWindowHint{transition:none}}
  `
  document.head.appendChild(style)

  const controls=document.createElement('div')
  controls.id='leadMapWindowControls'
  controls.className='leaflet-control'
  controls.setAttribute('role','group')
  controls.setAttribute('aria-label','Lead Pool map display and actions')
  controls.innerHTML=`
    <button id="leadMapMaximizeBtn" class="map-window-control" type="button" aria-label="MAXIMIZE MAP" title="MAXIMIZE MAP"><span class="map-window-lamp map-window-lamp-green" aria-hidden="true"><svg viewBox="0 0 12 12"><path d="M4.5 1H1v3.5M7.5 11H11V7.5M1 1l4 4M11 11 7 7"/></svg></span></button>
    <button id="leadMapActionsBtn" class="map-window-control" type="button" aria-label="LEAD ACTIONS" title="LEAD ACTIONS" aria-haspopup="menu" aria-expanded="false"><span class="map-window-lamp map-window-lamp-yellow map-window-more" aria-hidden="true">•••</span></button>
    <button id="leadMapRestoreBtn" class="map-window-control" type="button" aria-label="RESTORE MAP" title="RESTORE MAP"><span class="map-window-lamp map-window-lamp-red" aria-hidden="true"><svg viewBox="0 0 12 12"><path d="M1 4.5h3.5V1M11 7.5H7.5V11M4.5 4.5 1 1M7.5 7.5 11 11"/></svg></span></button>`

  const hint=document.createElement('div')
  hint.id='leadMapWindowHint'
  hint.setAttribute('role','status')
  hint.setAttribute('aria-live','polite')

  const menu=document.createElement('div')
  menu.id='leadMapActionMenu'
  menu.className='leaflet-control'
  menu.setAttribute('role','menu')
  menu.setAttribute('aria-label','Selected lead actions')
  menu.innerHTML='<button id="leadMapDispositionAction" type="button" class="primary" role="menuitem">DISPOSITION</button><button id="leadMapMovePinAction" type="button" class="assign-btn" role="menuitem">MOVE PIN</button>'

  const address=document.createElement('div')
  address.id='leadMapSelectedAddress'
  address.setAttribute('aria-live','polite')

  const sheet=document.createElement('div')
  sheet.id='leadMapWorkflowSheet'
  sheet.className='leaflet-control'
  sheet.setAttribute('role','dialog')
  sheet.setAttribute('aria-modal','false')
  sheet.innerHTML='<div class="lead-map-workflow-head"><strong id="leadMapWorkflowTitle"></strong><button id="leadMapWorkflowCancel" type="button" class="assign-btn">CANCEL</button></div><div id="leadMapWorkflowBody"></div>'

  canvas.append(controls,hint,menu,address,sheet)
  window.L?.DomEvent?.disableClickPropagation?.(controls)
  window.L?.DomEvent?.disableClickPropagation?.(menu)
  window.L?.DomEvent?.disableClickPropagation?.(sheet)

  const maximize=byId('leadMapMaximizeBtn')
  const actions=byId('leadMapActionsBtn')
  const restore=byId('leadMapRestoreBtn')
  const dispositionAction=byId('leadMapDispositionAction')
  const moveAction=byId('leadMapMovePinAction')
  const workflowBody=byId('leadMapWorkflowBody')

  function leadById(id){
    const value=String(id??'')
    const leads=typeof state!=='undefined'&&Array.isArray(state.realLeads)?state.realLeads:[]
    return leads.find(lead=>String(lead.dbId||lead.id)===value||String(lead.id)===value)||null
  }

  function selectedAddress(){
    if(!selectedLead)return'Select a lead to see its actions.'
    return [selectedLead.address,selectedLead.city,selectedLead.stateCode,selectedLead.zip].filter(Boolean).join(', ')||'Selected lead'
  }

  function mayMoveSelectedLead(){
    if(!selectedLead)return false
    const role=String(window.MCCOY_ACCESS?.access?.role||'').toLowerCase()
    const userId=String(window.MCCOY_ACCESS?.user?.id||'')
    return role==='admin'||(role==='rep'&&String(selectedLead.assignedRepId||'')===userId)||(['manager','trainer'].includes(role)&&String(selectedLead.assignedManagerId||'')===userId)
  }

  function showHint(text){
    clearTimeout(hintTimer)
    hint.textContent=text
    hint.classList.add('show')
    hintTimer=setTimeout(()=>hint.classList.remove('show'),1800)
  }

  function setAvailable(button,available){
    button.setAttribute('aria-disabled',available?'false':'true')
  }

  function restoreMountedWorkflow(){
    if(!mountedWorkflow)return
    const {node,parent,nextSibling}=mountedWorkflow
    if(nextSibling?.parentNode===parent)parent.insertBefore(node,nextSibling)
    else parent.appendChild(node)
    mountedWorkflow=null
    workflowBody.replaceChildren()
    byId('leadMapWorkflowCancel').hidden=false
    sheet.classList.remove('show')
  }

  function sync(){
    const expanded=mode!==STANDARD
    const workflow=mode===DISPOSITION||mode===MOVE_PIN
    panel.classList.toggle('lead-map-window-expanded',expanded)
    document.body.classList.toggle('lead-map-window-open',expanded)
    menu.classList.toggle('show',mode===ACTION_MENU)
    sheet.classList.toggle('show',workflow)
    address.classList.toggle('show',mode===ACTION_MENU||workflow)
    address.textContent=selectedAddress()
    actions.setAttribute('aria-expanded',mode===ACTION_MENU?'true':'false')
    setAvailable(maximize,mode===STANDARD)
    setAvailable(actions,expanded&&!workflow&&Boolean(selectedLead))
    setAvailable(restore,expanded&&!workflow)
    moveAction.setAttribute('aria-disabled',mayMoveSelectedLead()?'false':'true')
    moveAction.classList.toggle('is-disabled',!mayMoveSelectedLead())
    requestAnimationFrame(()=>window.MCCOY_LEAD_MAP?.invalidateSize?.({pan:false}))
    window.dispatchEvent(new CustomEvent('mccoy-lead-map-window-mode-changed',{detail:{mode,leadId:selectedLead?.dbId||selectedLead?.id||null}}))
  }

  function setMode(next){
    if(next===STANDARD)restoreMountedWorkflow()
    mode=next
    sync()
  }

  function mountWorkflow(node,title,nextMode){
    if(!node){showHint(`${title} UNAVAILABLE`);return false}
    restoreMountedWorkflow()
    mountedWorkflow={node,parent:node.parentNode,nextSibling:node.nextSibling}
    workflowBody.appendChild(node)
    node.style.display='block'
    byId('leadMapWorkflowTitle').textContent=title
    byId('leadMapWorkflowCancel').hidden=nextMode===MOVE_PIN
    mode=nextMode
    sync()
    return true
  }

  function cancelWorkflow(){
    if(mode===MOVE_PIN&&window.MCCOY_MAP_MOVE_PIN_ACTIVE){
      byId('cancelLeadPinBtn')?.click()
      return
    }
    restoreMountedWorkflow()
    mode=EXPANDED
    sync()
  }

  function handleControl(button,label,action){
    button.addEventListener('pointerdown',()=>{
      suppressClick=false
      clearTimeout(longPressTimer)
      longPressTimer=setTimeout(()=>{suppressClick=true;showHint(label)},500)
    })
    for(const eventName of ['pointerup','pointercancel','pointerleave'])button.addEventListener(eventName,()=>clearTimeout(longPressTimer))
    button.addEventListener('click',event=>{
      event.preventDefault()
      event.stopPropagation()
      if(suppressClick){suppressClick=false;return}
      showHint(label)
      action()
    })
  }

  handleControl(maximize,'MAXIMIZE',()=>{if(mode===STANDARD)setMode(EXPANDED)})
  handleControl(actions,'ACTIONS',()=>{
    if(mode===STANDARD){showHint('MAXIMIZE MAP FIRST');return}
    if(mode===DISPOSITION||mode===MOVE_PIN){showHint('FINISH OR CANCEL CURRENT ACTION');return}
    if(!selectedLead){showHint('SELECT A LEAD FIRST');return}
    setMode(mode===ACTION_MENU?EXPANDED:ACTION_MENU)
  })
  handleControl(restore,'RESTORE',()=>{if(mode===EXPANDED||mode===ACTION_MENU)setMode(STANDARD)})

  dispositionAction.addEventListener('click',event=>{
    event.stopPropagation()
    if(!selectedLead)return showHint('SELECT A LEAD FIRST')
    menu.classList.remove('show')
    mountWorkflow(byId('mapLeadDetail')?.querySelector('.map-pin-disposition'),'DISPOSITION',DISPOSITION)
  })

  moveAction.addEventListener('click',event=>{
    event.stopPropagation()
    if(!mayMoveSelectedLead())return showHint('MOVE PIN NOT AUTHORIZED')
    menu.classList.remove('show')
    if(mountWorkflow(byId('leadCorrectionPanel'),'MOVE PIN',MOVE_PIN))byId('moveLeadPinBtn')?.click()
  })

  byId('leadMapWorkflowCancel').addEventListener('click',cancelWorkflow)
  window.addEventListener('mccoy-map-lead-selected',event=>{
    selectedLead=leadById(event.detail?.leadId)
    if(mode===ACTION_MENU)mode=EXPANDED
    sync()
  })
  window.addEventListener('mccoy-map-move-pin-ended',()=>{
    if(mode!==MOVE_PIN)return
    restoreMountedWorkflow()
    mode=EXPANDED
    sync()
  })
  window.addEventListener('mccoy-door-visit-completed',()=>{
    if(mode!==DISPOSITION)return
    restoreMountedWorkflow()
    mode=EXPANDED
    sync()
  })
  byId('clearMapSelectionBtn')?.addEventListener('click',()=>{selectedLead=null;if(mode===ACTION_MENU)mode=EXPANDED;sync()})
  document.addEventListener('click',event=>{
    const view=event.target?.closest?.('[data-view]')?.dataset?.view
    if(view!==undefined&&view!=='leads'){
      if(window.MCCOY_MAP_MOVE_PIN_ACTIVE)byId('cancelLeadPinBtn')?.click()
      selectedLead=null
      setMode(STANDARD)
    }
    if(view==='leads'&&!panel.classList.contains('lead-map-window-expanded'))setMode(STANDARD)
  },true)
  document.addEventListener('keydown',event=>{
    if(event.key!=='Escape')return
    if(mode===DISPOSITION||mode===MOVE_PIN)cancelWorkflow()
    else if(mode===ACTION_MENU)setMode(EXPANDED)
    else if(mode===EXPANDED)setMode(STANDARD)
  })
  let resizeTimer=null
  window.addEventListener('resize',()=>{
    clearTimeout(resizeTimer)
    resizeTimer=setTimeout(()=>window.MCCOY_LEAD_MAP?.invalidateSize?.({pan:false}),120)
  })

  sync()
  window.MCCOY_LEAD_MAP_WINDOW={
    getMode:()=>mode,
    maximize:()=>setMode(EXPANDED),
    restore:()=>setMode(STANDARD)
  }
})()
