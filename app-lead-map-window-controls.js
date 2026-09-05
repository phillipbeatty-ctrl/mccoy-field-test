(()=>{
  if(window.MCCOY_LEAD_MAP_WINDOW_CONTROLS)return
  window.MCCOY_LEAD_MAP_WINDOW_CONTROLS=true

  const STANDARD='standard',ACTION_MENU='action-menu',DISPOSITION='disposition',MOVE_PIN_READY='move-pin-ready',MOVE_PIN='move-pin'
  let mode=STANDARD,expanded=false,selectedLead=null,movePinLeadId=null,mountedWorkflow=null,hintTimer=null,longPressTimer=null,suppressClick=false,confirmObserver=null,statusObserver=null,statusTimer=null,movePinSnapshotPromise=null
  const byId=id=>document.getElementById(id)
  const panel=byId('leadMapPanel'),canvas=byId('leadMapFrame')
  if(!panel||!canvas)return

  const mapCard=canvas.closest('.card')
  mapCard?.classList.add('lead-map-window-card')
  const style=document.createElement('style')
  style.id='leadMapWindowControlStyles'
  style.textContent=`
    .lead-map-window-card{position:relative}
    #leadPoolPhoneSaleSearch{display:none!important}
    #leadMapWindowControls{position:absolute;z-index:1400;top:max(10px,env(safe-area-inset-top));left:max(58px,calc(env(safe-area-inset-left) + 48px));display:flex;gap:2px;padding:3px;border-radius:999px;background:rgba(255,255,255,.94);box-shadow:0 3px 14px rgba(15,23,42,.28);backdrop-filter:blur(8px)}
    .map-window-control,.map-move-control{appearance:none;-webkit-appearance:none;width:44px!important;height:44px!important;min-width:44px!important;min-height:44px!important;margin:0!important;padding:0!important;border:0!important;border-radius:50%!important;background:transparent!important;display:grid!important;place-items:center;touch-action:manipulation;-webkit-tap-highlight-color:transparent;cursor:pointer}
    .map-window-control:focus-visible,.map-move-control:focus-visible{outline:3px solid #1455d9!important;outline-offset:1px}.map-window-control[aria-disabled="true"],.map-move-control[aria-disabled="true"]{cursor:default;opacity:.42;filter:saturate(.45)}
    .map-window-lamp,.map-move-lamp{width:16px;height:16px;border-radius:50%;display:grid;place-items:center;box-shadow:inset 0 0 0 1px rgba(15,23,42,.28),0 1px 2px rgba(15,23,42,.24);color:#172033}.map-window-lamp svg,.map-move-lamp svg{width:10px;height:10px;stroke:currentColor;stroke-width:2.1;fill:none;stroke-linecap:round;stroke-linejoin:round}
    .map-window-lamp-green{background:#30d158}.map-window-lamp-yellow{background:#ffd60a}.map-window-lamp-red{background:#ff453a}.map-window-more{font:900 8px/1 system-ui;letter-spacing:-1px;transform:translateY(-1px)}
    .map-move-lamp-confirm{background:#30d158}.map-move-lamp-cancel{background:#f8fafc}
    #leadMapWindowHint{position:absolute;z-index:1450;top:max(61px,calc(env(safe-area-inset-top) + 51px));left:max(58px,calc(env(safe-area-inset-left) + 48px));padding:6px 9px;border-radius:7px;background:#111827;color:#fff;font:800 11px/1.1 system-ui;letter-spacing:.035em;box-shadow:0 3px 10px rgba(0,0,0,.28);opacity:0;transform:translateY(-4px);pointer-events:none;transition:opacity .14s ease,transform .14s ease}#leadMapWindowHint.show{opacity:1;transform:translateY(0)}
    #leadMapActionMenu{position:absolute;z-index:1390;top:max(64px,calc(env(safe-area-inset-top) + 54px));left:max(58px,calc(env(safe-area-inset-left) + 48px));display:none;gap:8px;padding:10px;border-radius:12px;background:rgba(255,255,255,.97);box-shadow:0 8px 24px rgba(15,23,42,.28)}#leadMapActionMenu.show{display:grid}#leadMapActionMenu button{min-height:44px;min-width:132px}
    #leadMapSelectedAddress{position:absolute;z-index:1350;left:max(10px,env(safe-area-inset-left));bottom:max(28px,calc(env(safe-area-inset-bottom) + 22px));max-width:min(430px,calc(100% - 20px));display:none;padding:8px 11px;border-radius:10px;background:rgba(17,24,39,.92);color:#fff;font:700 12px/1.35 system-ui;box-shadow:0 4px 14px rgba(0,0,0,.28)}#leadMapSelectedAddress.show{display:block}
    #leadMapMoveStatus{position:absolute;z-index:1460;left:50%;bottom:max(150px,calc(env(safe-area-inset-bottom) + 140px));transform:translate(-50%,10px);width:min(560px,calc(100% - 28px));display:none;padding:10px 13px;border-radius:10px;background:rgba(17,24,39,.95);color:#fff;font:800 12px/1.35 system-ui;text-align:center;box-shadow:0 6px 20px rgba(0,0,0,.34);pointer-events:none}#leadMapMoveStatus.show{display:block;transform:translate(-50%,0)}
    #leadMapWorkflowSheet{position:absolute;z-index:1380;left:max(10px,env(safe-area-inset-left));bottom:max(58px,calc(env(safe-area-inset-bottom) + 52px));width:min(430px,calc(100% - 20px));max-height:min(68vh,620px);display:none;overflow:auto;padding:12px;border-radius:14px;background:rgba(255,255,255,.98);box-shadow:0 10px 32px rgba(15,23,42,.34)}#leadMapWorkflowSheet.show{display:block}
    .lead-map-workflow-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:9px}.lead-map-workflow-head strong{font-size:13px}.lead-map-workflow-head button{min-height:44px;min-width:76px}
    #leadMapMoveDock{position:absolute;z-index:1410;right:max(22px,calc(env(safe-area-inset-right) + 18px));bottom:max(92px,calc(env(safe-area-inset-bottom) + 82px));display:none;align-items:center;gap:2px;padding:3px;border-radius:999px;background:rgba(255,255,255,.9);box-shadow:0 3px 14px rgba(15,23,42,.24);backdrop-filter:blur(8px)}#leadMapMoveDock.show{display:flex}
    body.lead-map-window-open{overflow:hidden!important;overscroll-behavior:none}#leadMapPanel.lead-map-window-expanded{position:fixed!important;inset:0!important;z-index:190000!important;display:block!important;padding:0!important;margin:0!important;background:#e5e7eb}
    #leadMapPanel.lead-map-window-expanded>.grid-2{display:block!important;width:100%!important;height:100%!important;margin:0!important}#leadMapPanel.lead-map-window-expanded>.grid-2>.lead-map-window-card{display:flex!important;position:relative!important;width:100%!important;height:100%!important;max-width:none!important;margin:0!important;padding:0!important;border:0!important;border-radius:0!important;overflow:hidden}#leadMapPanel.lead-map-window-expanded>.grid-2>.card:not(.lead-map-window-card){display:none!important}
    #leadMapPanel.lead-map-window-expanded #realLeadMapHeader,#leadMapPanel.lead-map-window-expanded #leadGeoControls{display:none!important}#leadMapPanel.lead-map-window-expanded #leadMapFrame{width:100%!important;height:100%!important;min-height:100dvh!important;border:0!important;border-radius:0!important}
    @media(max-width:620px){#leadMapWorkflowSheet{left:max(8px,env(safe-area-inset-left));width:calc(100% - max(16px,env(safe-area-inset-left) + env(safe-area-inset-right)));max-height:56vh}#leadMapSelectedAddress{left:max(8px,env(safe-area-inset-left));max-width:calc(100% - max(16px,env(safe-area-inset-left) + env(safe-area-inset-right)))}#leadMapMoveDock{right:max(18px,calc(env(safe-area-inset-right) + 14px));bottom:max(86px,calc(env(safe-area-inset-bottom) + 76px))}#leadMapMoveStatus{bottom:max(142px,calc(env(safe-area-inset-bottom) + 132px));font-size:11px}}
    @media(prefers-reduced-motion:reduce){#leadMapWindowHint{transition:none}}
  `
  document.head.appendChild(style)

  const controls=document.createElement('div')
  controls.id='leadMapWindowControls';controls.className='leaflet-control';controls.setAttribute('role','group');controls.setAttribute('aria-label','Lead Pool map display and actions')
  controls.innerHTML=`<button id="leadMapMaximizeBtn" class="map-window-control" type="button" aria-label="MAXIMIZE MAP" title="MAXIMIZE MAP"><span class="map-window-lamp map-window-lamp-green" aria-hidden="true"><svg viewBox="0 0 12 12"><path d="M4.5 1H1v3.5M7.5 11H11V7.5M1 1l4 4M11 11 7 7"/></svg></span></button><button id="leadMapActionsBtn" class="map-window-control" type="button" aria-label="LEAD ACTIONS" title="LEAD ACTIONS" aria-haspopup="menu" aria-expanded="false"><span class="map-window-lamp map-window-lamp-yellow map-window-more" aria-hidden="true">•••</span></button><button id="leadMapRestoreBtn" class="map-window-control" type="button" aria-label="RESTORE MAP" title="RESTORE MAP"><span class="map-window-lamp map-window-lamp-red" aria-hidden="true"><svg viewBox="0 0 12 12"><path d="M1 4.5h3.5V1M11 7.5H7.5V11M4.5 4.5 1 1M7.5 7.5 11 11"/></svg></span></button>`
  const hint=document.createElement('div');hint.id='leadMapWindowHint';hint.setAttribute('role','status');hint.setAttribute('aria-live','polite')
  const menu=document.createElement('div');menu.id='leadMapActionMenu';menu.className='leaflet-control';menu.setAttribute('role','menu');menu.setAttribute('aria-label','Map and selected lead actions');menu.innerHTML='<button id="leadMapFitAllAction" type="button" class="assign-btn" role="menuitem">FIT ALL PINS</button><button id="leadMapDispositionAction" type="button" class="primary" role="menuitem">DISPOSITION</button><button id="leadMapMovePinAction" type="button" class="assign-btn" role="menuitem">MOVE PIN</button>'
  const address=document.createElement('div');address.id='leadMapSelectedAddress';address.setAttribute('aria-live','polite')
  const status=document.createElement('div');status.id='leadMapMoveStatus';status.setAttribute('role','status');status.setAttribute('aria-live','assertive')
  const sheet=document.createElement('div');sheet.id='leadMapWorkflowSheet';sheet.className='leaflet-control';sheet.setAttribute('role','dialog');sheet.setAttribute('aria-modal','false');sheet.innerHTML='<div class="lead-map-workflow-head"><strong id="leadMapWorkflowTitle"></strong><button id="leadMapWorkflowCancel" type="button" class="assign-btn">CANCEL</button></div><div id="leadMapWorkflowBody"></div>'
  const moveDock=document.createElement('div');moveDock.id='leadMapMoveDock';moveDock.className='leaflet-control';moveDock.setAttribute('role','group');moveDock.setAttribute('aria-label','Confirm or cancel moved lead pin');moveDock.innerHTML=`<button id="leadMapMoveConfirm" class="map-move-control" type="button" aria-label="CONFIRM PIN LOCATION" title="CONFIRM" aria-disabled="true"><span class="map-move-lamp map-move-lamp-confirm" aria-hidden="true"><svg viewBox="0 0 12 12"><path d="m2 6.5 2.3 2.3L10 3.2"/></svg></span></button><button id="leadMapMoveCancel" class="map-move-control" type="button" aria-label="CANCEL PIN MOVE" title="CANCEL"><span class="map-move-lamp map-move-lamp-cancel" aria-hidden="true"><svg viewBox="0 0 12 12"><path d="M3.5 3.5 8.5 8.5M8.5 3.5 3.5 8.5"/></svg></span></button>`
  canvas.append(controls,hint,menu,address,status,sheet,moveDock)
  window.L?.DomEvent?.disableClickPropagation?.(controls);window.L?.DomEvent?.disableClickPropagation?.(menu);window.L?.DomEvent?.disableClickPropagation?.(sheet);window.L?.DomEvent?.disableClickPropagation?.(moveDock)

  const maximize=byId('leadMapMaximizeBtn'),actions=byId('leadMapActionsBtn'),restore=byId('leadMapRestoreBtn'),fitAllAction=byId('leadMapFitAllAction'),dispositionAction=byId('leadMapDispositionAction'),moveAction=byId('leadMapMovePinAction'),workflowBody=byId('leadMapWorkflowBody'),moveConfirm=byId('leadMapMoveConfirm'),moveCancel=byId('leadMapMoveCancel')
  const leadById=id=>{const value=String(id??''),leads=typeof state!=='undefined'&&Array.isArray(state.realLeads)?state.realLeads:[];return leads.find(lead=>String(lead.dbId||lead.id)===value||String(lead.id)===value)||null}
  const selectedAddress=()=>selectedLead?[selectedLead.address,selectedLead.city,selectedLead.stateCode,selectedLead.zip].filter(Boolean).join(', ')||'Selected lead':'Select a lead to see its actions.'
  const mayMoveSelectedLead=()=>{if(!selectedLead)return false;const role=String(window.MCCOY_ACCESS?.access?.role||'').toLowerCase(),userId=String(window.MCCOY_ACCESS?.user?.id||'');return role==='admin'||(role==='rep'&&String(selectedLead.assignedRepId||'')===userId)||(['manager','trainer'].includes(role)&&String(selectedLead.assignedManagerId||'')===userId)}
  function showHint(text){clearTimeout(hintTimer);hint.textContent=text;hint.classList.add('show');hintTimer=setTimeout(()=>hint.classList.remove('show'),1800)}
  function showMapStatus(text){clearTimeout(statusTimer);status.textContent=String(text||'').trim();status.classList.toggle('show',Boolean(status.textContent)&&mode!==STANDARD);if(status.textContent)statusTimer=setTimeout(()=>status.classList.remove('show'),6500)}
  function watchMoveStatus(){statusObserver?.disconnect();const source=byId('leadCorrectionMsg');if(!source)return;statusObserver=new MutationObserver(()=>{const text=source.textContent?.trim();if(text)showMapStatus(text)});statusObserver.observe(source,{childList:true,subtree:true,characterData:true})}
  const setAvailable=(button,available)=>button.setAttribute('aria-disabled',available?'false':'true')
  function syncCompactConfirm(){const underlying=byId('confirmLeadPinBtn');setAvailable(moveConfirm,Boolean(underlying&&!underlying.disabled&&window.MCCOY_MAP_MOVE_PIN_ACTIVE))}
  function watchCompactConfirm(){confirmObserver?.disconnect();const underlying=byId('confirmLeadPinBtn');if(!underlying)return;confirmObserver=new MutationObserver(syncCompactConfirm);confirmObserver.observe(underlying,{attributes:true,attributeFilter:['disabled']});syncCompactConfirm()}
  function releaseMovePinOwnership(){movePinLeadId=null;movePinSnapshotPromise=null;window.MCCOY_MAP_VIEWPORT_LOCK?.release?.('move-pin')}
  function recoverFailedMoveStart(){if(mode!==MOVE_PIN_READY||window.MCCOY_MAP_MOVE_PIN_ACTIVE)return;releaseMovePinOwnership();mode=STANDARD;sync();showHint('MOVE PIN DID NOT START')}
  async function refreshMovePinSnapshot(){
    if(!movePinLeadId)return false
    const lead=leadById(movePinLeadId)
    if(!lead)return false
    const timeout=new Promise(resolve=>setTimeout(()=>resolve({timeout:true}),2000))
    const result=await Promise.race([sb.functions.invoke('lead-pin-snapshot',{body:{lead_id:movePinLeadId}}),timeout])
    if(result?.timeout||result?.error||!result?.data?.ok)return false
    const snapshot=result.data.lead||{}
    const lat=Number(snapshot.latitude),lng=Number(snapshot.longitude)
    if(Number.isFinite(lat))lead.lat=lat
    if(Number.isFinite(lng))lead.lng=lng
    lead.updatedAt=snapshot.pin_location_updated_at||lead.updatedAt||null
    selectedLead=lead
    return true
  }
  function triggerUnderlyingMove(){
    if(!movePinLeadId)return false
    window.MCCOY_SELECT_MAP_LEAD?.(movePinLeadId)
    const underlying=byId('moveLeadPinBtn')
    if(!underlying){recoverFailedMoveStart();showHint('MOVE PIN UNAVAILABLE');return false}
    underlying.click()
    movePinSnapshotPromise=refreshMovePinSnapshot().catch(()=>false)
    setTimeout(recoverFailedMoveStart,3000)
    return true
  }

  function restoreMountedWorkflow(){if(!mountedWorkflow)return;for(const item of mountedWorkflow.items){if(item.nextSibling?.parentNode===item.parent)item.parent.insertBefore(item.node,item.nextSibling);else item.parent.appendChild(item.node)}mountedWorkflow=null;workflowBody.replaceChildren();byId('leadMapWorkflowCancel').hidden=false;sheet.classList.remove('show')}
  function sync(){
    const dispositionOpen=mode===DISPOSITION,moveReady=mode===MOVE_PIN_READY,moveActive=mode===MOVE_PIN,actionOpen=mode===ACTION_MENU,busy=dispositionOpen||moveReady||moveActive
    panel.classList.toggle('lead-map-window-expanded',expanded);document.body.classList.toggle('lead-map-window-open',expanded);menu.classList.toggle('show',actionOpen);sheet.classList.toggle('show',dispositionOpen);moveDock.classList.toggle('show',moveActive);address.classList.toggle('show',actionOpen||dispositionOpen||moveReady||moveActive);address.textContent=selectedAddress();actions.setAttribute('aria-expanded',actionOpen?'true':'false')
    setAvailable(maximize,!expanded&&!busy);setAvailable(actions,!busy);setAvailable(restore,expanded&&!busy);moveAction.setAttribute('aria-disabled',mayMoveSelectedLead()?'false':'true');moveAction.classList.toggle('is-disabled',!mayMoveSelectedLead());dispositionAction.setAttribute('aria-disabled',selectedLead?'false':'true');dispositionAction.classList.toggle('is-disabled',!selectedLead);syncCompactConfirm()
    requestAnimationFrame(()=>window.MCCOY_LEAD_MAP?.invalidateSize?.({pan:false}));window.dispatchEvent(new CustomEvent('mccoy-lead-map-window-mode-changed',{detail:{mode,expanded,leadId:movePinLeadId||selectedLead?.dbId||selectedLead?.id||null}}))
  }
  function setMode(next){if(next===STANDARD)restoreMountedWorkflow();if(next!==MOVE_PIN_READY&&next!==MOVE_PIN&&movePinLeadId)releaseMovePinOwnership();mode=next;sync()}
  function maximizeMap(){if(expanded)return;expanded=true;sync()}
  function restoreMap(){if(!expanded)return;expanded=false;if(mode===ACTION_MENU)mode=STANDARD;sync()}
  function beginMovePin(leadId,{startImmediately=false}={}){const resolved=leadId?leadById(leadId):selectedLead;if(!resolved){showHint('SELECT A LEAD FIRST');return false}selectedLead=resolved;if(!mayMoveSelectedLead()){showHint('MOVE PIN NOT AUTHORIZED');sync();return false}movePinLeadId=String(resolved.dbId||resolved.id);window.MCCOY_SELECT_MAP_LEAD?.(movePinLeadId);window.MCCOY_MAP_VIEWPORT_LOCK?.acquire?.('move-pin',movePinLeadId);restoreMountedWorkflow();menu.classList.remove('show');mode=MOVE_PIN_READY;sync();showHint('MOVE PIN');if(startImmediately)setTimeout(triggerUnderlyingMove,0);return true}
  function mountWorkflow(node,title,nextMode){if(!node){showHint(`${title} UNAVAILABLE`);return false}restoreMountedWorkflow();mountedWorkflow={items:[{node,parent:node.parentNode,nextSibling:node.nextSibling}]};workflowBody.appendChild(node);node.style.display='block';byId('leadMapWorkflowTitle').textContent=title;byId('leadMapWorkflowCancel').hidden=false;mode=nextMode;sync();return true}
  function cancelWorkflow(){if(mode===MOVE_PIN&&window.MCCOY_MAP_MOVE_PIN_ACTIVE){byId('cancelLeadPinBtn')?.click();return}if(mode===MOVE_PIN_READY){releaseMovePinOwnership();mode=STANDARD;sync();return}restoreMountedWorkflow();mode=STANDARD;sync()}
  function handleControl(button,label,action){button.addEventListener('pointerdown',()=>{suppressClick=false;clearTimeout(longPressTimer);longPressTimer=setTimeout(()=>{suppressClick=true;showHint(label)},500)});for(const eventName of ['pointerup','pointercancel','pointerleave'])button.addEventListener(eventName,()=>clearTimeout(longPressTimer));button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();if(suppressClick){suppressClick=false;return}showHint(label);action()})}

  handleControl(maximize,'MAXIMIZE',()=>{if(!expanded&&mode===STANDARD)maximizeMap()})
  handleControl(actions,'ACTIONS',()=>{if(mode===DISPOSITION||mode===MOVE_PIN_READY||mode===MOVE_PIN){showHint('FINISH OR CANCEL CURRENT ACTION');return}setMode(mode===ACTION_MENU?STANDARD:ACTION_MENU)})
  handleControl(restore,'RESTORE',()=>{if(expanded&&(mode===STANDARD||mode===ACTION_MENU))restoreMap()})
  fitAllAction.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();window.MCCOY_LEAD_MAP?.fitLeadPins?.();mode=STANDARD;sync();showHint('FIT ALL PINS')})
  dispositionAction.addEventListener('click',event=>{event.stopPropagation();if(!selectedLead)return showHint('SELECT A LEAD FIRST');menu.classList.remove('show');mountWorkflow(byId('mapLeadDetail')?.querySelector('.map-pin-disposition'),'DISPOSITION',DISPOSITION)})
  moveAction.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();if(!selectedLead)return showHint('SELECT A LEAD FIRST');if(!mayMoveSelectedLead()){showHint('MOVE PIN NOT AUTHORIZED');sync();return}beginMovePin(selectedLead?.dbId||selectedLead?.id,{startImmediately:true})})
  moveConfirm.addEventListener('click',async event=>{event.preventDefault();event.stopPropagation();syncCompactConfirm();if(moveConfirm.getAttribute('aria-disabled')==='true')return showHint('MOVE THE PIN FIRST');if(movePinSnapshotPromise){showMapStatus('Checking latest pin state…');await movePinSnapshotPromise;movePinSnapshotPromise=null}byId('confirmLeadPinBtn')?.click()})
  moveCancel.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();byId('cancelLeadPinBtn')?.click()})
  byId('leadMapWorkflowCancel').addEventListener('click',cancelWorkflow)
  watchCompactConfirm();watchMoveStatus()

  window.addEventListener('mccoy-map-lead-selected',event=>{const nextId=event.detail?.leadId;if(movePinLeadId&&String(nextId??'')!==String(movePinLeadId))return;selectedLead=leadById(nextId);if(mode===ACTION_MENU)mode=STANDARD;sync()})
  window.addEventListener('mccoy-map-lead-deleted',event=>{if(String(event.detail?.leadId||'')!==String(selectedLead?.dbId||selectedLead?.id||''))return;if(window.MCCOY_MAP_MOVE_PIN_ACTIVE)byId('cancelLeadPinBtn')?.click();releaseMovePinOwnership();restoreMountedWorkflow();selectedLead=null;mode=STANDARD;sync()})
  window.addEventListener('mccoy-map-move-pin-started',()=>{if(mode!==MOVE_PIN_READY)return;mode=MOVE_PIN;sync();watchCompactConfirm();watchMoveStatus();showHint('DRAG THE LARGE PIN')})
  window.addEventListener('mccoy-map-move-pin-ended',event=>{if(event.detail?.message)showMapStatus(event.detail.message);if(mode!==MOVE_PIN&&mode!==MOVE_PIN_READY)return;releaseMovePinOwnership();mode=STANDARD;sync()})
  window.addEventListener('mccoy-door-visit-completed',()=>{if(mode!==DISPOSITION)return;restoreMountedWorkflow();mode=STANDARD;sync()})
  byId('clearMapSelectionBtn')?.addEventListener('click',()=>{if(movePinLeadId)return;if(window.MCCOY_MAP_MOVE_PIN_ACTIVE)byId('cancelLeadPinBtn')?.click();selectedLead=null;if(mode===ACTION_MENU||mode===MOVE_PIN_READY)mode=STANDARD;sync()})
  document.addEventListener('click',event=>{const mapPick=event.target?.closest?.('.map-pick');if(mapPick?.dataset?.id&&(!movePinLeadId||String(mapPick.dataset.id)===String(movePinLeadId))){selectedLead=leadById(mapPick.dataset.id);if(mode===ACTION_MENU)mode=STANDARD;setTimeout(sync,0)}const view=event.target?.closest?.('[data-view]')?.dataset?.view;if(view!==undefined&&view!=='leads'){if(window.MCCOY_MAP_MOVE_PIN_ACTIVE)byId('cancelLeadPinBtn')?.click();releaseMovePinOwnership();selectedLead=null;expanded=false;setMode(STANDARD)}if(view==='leads'&&!panel.classList.contains('lead-map-window-expanded')){expanded=false;setMode(STANDARD)}},true)
  document.addEventListener('keydown',event=>{if(event.key!=='Escape')return;if(mode===DISPOSITION||mode===MOVE_PIN_READY||mode===MOVE_PIN)cancelWorkflow();else if(mode===ACTION_MENU)setMode(STANDARD);else if(expanded)restoreMap()})
  let resizeTimer=null;window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>window.MCCOY_LEAD_MAP?.invalidateSize?.({pan:false}),120)})
  sync();window.MCCOY_LEAD_MAP_WINDOW={getMode:()=>mode,getMovePinLeadId:()=>movePinLeadId,isExpanded:()=>expanded,maximize:maximizeMap,restore:restoreMap,beginMovePin}
})()