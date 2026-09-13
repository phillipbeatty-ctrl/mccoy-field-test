// One dedicated provider-return screen; outcome controls never live in Sales Hub.
(function(){
  const byId=id=>document.getElementById(id);
  const providers=['Quantum','Brightspeed','AT&T','T-Mobile / T-Fiber','Kinetic','Fidium','Ziply','Ascend Fiber','Lightcurve','Ripple Fiber','Starlink','DIRECTV','Vivint','Other'];
  const css=document.createElement('style');css.textContent=`
  .sales-strip{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:12px 0}.sales-card{border:1px solid #e5e7eb;border-radius:12px;padding:12px;background:#fff}.sales-feed{max-height:260px;overflow:auto}.feed-item{padding:10px 0;border-bottom:1px solid #eee;font-size:13px}.feed-item:last-child{border-bottom:0}.leader-row{display:flex;justify-content:space-between;padding:6px 0;font-size:13px}@media(max-width:650px){.sales-strip{grid-template-columns:1fr}}
  `;document.head.appendChild(css);

  let providerBar=byId('sessionIsp')?.closest('.sales-card');
  if(!providerBar){providerBar=document.createElement('div');providerBar.className='sales-card';providerBar.innerHTML=`<strong>Selling for</strong><select id="sessionIsp" style="margin-top:8px;width:100%;padding:9px">${providers.map(x=>`<option>${x}</option>`).join('')}</select>`;const fieldSelect=byId('fieldLeadSelect');if(fieldSelect?.parentNode)fieldSelect.parentNode.insertBefore(providerBar,fieldSelect);}
  const closestDoorBox=byId('closestDoorAddress');if(providerBar&&closestDoorBox)providerBar.insertAdjacentElement('afterend',closestDoorBox);
  const ispSel=byId('sessionIsp');
  if(ispSel){ispSel.innerHTML=providers.map(x=>`<option>${x}</option>`).join('');const savedIsp=localStorage.getItem('mccoy_isp');ispSel.value=providers.includes(savedIsp)?savedIsp:'Quantum';ispSel.onchange=()=>localStorage.setItem('mccoy_isp',ispSel.value);}

  if(!byId('monthlyLeaders')){const social=document.createElement('div');social.className='sales-strip';social.innerHTML=`<div class="sales-card"><div style="display:flex;justify-content:space-between;gap:8px"><strong>🏆 Monthly Sales</strong><button type="button" id="salesRefreshBtn" class="assign-btn">Refresh</button></div><div id="monthlyLeaders" style="margin-top:8px">Loading…</div></div><div class="sales-card"><strong>🎉 Live Wins</strong><div id="salesFeed" class="sales-feed" style="margin-top:8px">Loading…</div></div>`;const eff=byId('efficiencySummary');if(eff?.parentNode)eff.parentNode.insertBefore(social,eff);}

  const modal=document.createElement('section');
  modal.id='providerReturnScreen';modal.hidden=true;modal.tabIndex=-1;
  modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');modal.setAttribute('aria-labelledby','providerReturnTitle');modal.setAttribute('aria-describedby','providerReturnDescription');
  modal.innerHTML=`<div class="provider-return-card"><h2 id="providerReturnTitle">Sale choices</h2><p id="providerReturnDescription">Choose the result of your provider dashboard visit.</p><div class="provider-return-context"><strong id="providerReturnProvider"></strong><span id="providerReturnAddress"></span></div><button type="button" id="providerReturnPhoto" class="provider-return-photo">Add sale screenshot or photo</button><p id="providerReturnPhotoStatus" role="status" aria-live="polite" aria-atomic="true"></p><div class="provider-return-actions" role="group" aria-label="Save outcome and return"><button type="button" id="completeSaleBtn" class="provider-return-complete" aria-label="Sale completed — return to Field Coach" title="Sale completed — return to Field Coach"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m5 12 4 4L19 6"/></svg><span>Sale completed</span></button><button type="button" id="abandonedSaleBtn" class="provider-return-abandoned" aria-label="Abandoned — return to Field Coach" title="Abandoned — return to Field Coach"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m6 6 12 12M18 6 6 18"/></svg><span>Abandoned</span></button></div><p id="saleMsg" role="status" aria-live="polite" aria-atomic="true"></p><button type="button" id="providerReturnResume" class="provider-return-resume">Resume provider dashboard</button></div>`;
  document.body.appendChild(modal);
  const returnStyle=document.createElement('style');returnStyle.textContent=`
    #providerReturnScreen{position:fixed;inset:0;z-index:160100;display:flex;align-items:center;justify-content:center;overflow:auto;padding:max(20px,env(safe-area-inset-top)) max(16px,env(safe-area-inset-right)) max(20px,env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left));background:#f4f6f8;overscroll-behavior:contain}
    #providerReturnScreen[hidden]{display:none!important}.provider-return-card{box-sizing:border-box;width:min(480px,100%);padding:24px;border:1px solid #dbe2ea;border-radius:18px;background:#fff;box-shadow:0 8px 35px #0f172a12}.provider-return-card h2{margin:0 0 8px;font-size:24px}.provider-return-card p{font-size:14px;line-height:1.5}.provider-return-context{display:grid;gap:6px;padding:14px 0;overflow-wrap:anywhere}.provider-return-context span{font-size:14px;color:#475569}.provider-return-actions{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin:18px 0}.provider-return-actions button{display:flex;flex-direction:column;align-items:center;gap:9px;min-width:0;min-height:92px;padding:14px 8px;border:2px solid transparent;border-radius:14px;font:700 14px/1.3 system-ui;cursor:pointer;touch-action:manipulation}.provider-return-actions svg{display:block;width:40px;height:40px;fill:none;stroke:currentColor;stroke-width:3;stroke-linecap:round;stroke-linejoin:round}.provider-return-complete{background:#dcfce7;color:#166534}.provider-return-abandoned{background:#fee2e2;color:#991b1b}.provider-return-actions button:focus-visible,.provider-return-resume:focus-visible,.provider-return-photo:focus-visible{outline:3px solid #1d4ed8;outline-offset:3px}.provider-return-actions button:disabled{opacity:.5;cursor:wait}.provider-return-photo{min-height:44px;width:100%;padding:10px 14px;border:1px solid #64748b;border-radius:10px;background:#f8fafc;color:#0f172a;font:600 14px/1.4 system-ui;touch-action:manipulation}.provider-return-photo:disabled{opacity:.5}#providerReturnPhotoStatus:empty{display:none}.provider-return-resume{display:block;min-height:44px;padding:10px 0;border:0;background:transparent;color:#334155;text-decoration:underline;font-size:14px}.provider-return-card #saleMsg{min-height:21px;margin-bottom:8px}.sale-msg-error{color:#991b1b!important;font-weight:700}.sale-msg-ok{color:#166534!important;font-weight:700}#providerReturnToast{position:fixed;z-index:160200;left:50%;bottom:max(20px,env(safe-area-inset-bottom));transform:translateX(-50%);max-width:calc(100vw - 32px);padding:12px 18px;border-radius:12px;background:#166534;color:white;font:600 14px/1.4 system-ui}
    @media(max-height:500px){#providerReturnScreen{align-items:flex-start}.provider-return-card{padding:16px}.provider-return-actions{margin:10px 0}.provider-return-actions button{min-height:72px;padding:8px}.provider-return-context{padding:8px 0}}
  `;document.head.appendChild(returnStyle);
  const returnToast=document.createElement('div');returnToast.id='providerReturnToast';returnToast.hidden=true;returnToast.setAttribute('role','status');document.body.appendChild(returnToast);
  const setSaleMsg=(text,type='')=>{const el=byId('saleMsg');if(!el)return;el.textContent=text;el.classList.remove('sale-msg-error','sale-msg-ok');if(type==='error')el.classList.add('sale-msg-error');if(type==='ok')el.classList.add('sale-msg-ok');};
  let pendingProviderCapture=null,submitting=false,lockedOutcome=null,toastTimer=null,returnFocus=null;
  const accountIdentity=()=>window.MCCOY_ACCESS?.access?.active&&window.MCCOY_ACCESS?.user?.id?`${window.MCCOY_ACCESS.user.id}:${window.MCCOY_ACCESS.access.organization_id||''}`:'';
  const sameCapture=(a,b)=>!!(a&&b&&((a.id&&a.id===b.id)||(a.client_request_id&&a.client_request_id===b.client_request_id)));
  const ownedCapture=capture=>!!(accountIdentity()&&capture?.actor_key===accountIdentity());
  function isTesterPkbSale(){
    const email=String(window.MCCOY_ACCESS?.user?.email||'').trim().toLowerCase(),displayName=String(window.MCCOY_ACCESS?.access?.display_name||'').trim().toLowerCase();
    return window.MCCOY_TESTER_PKB_SALE===true&&email==='phillipkbeatty@gmail.com'&&displayName==='ghost';
  }
  function currentPhoto(){
    const photo=window.MCCOY_SALE_PHOTO_STATE?.();
    return photo&&ownedCapture(photo.capture)&&sameCapture(photo.capture,pendingProviderCapture)?photo:null;
  }
  function setOutcomeButtonsBusy(active,action=''){
    const photo=currentPhoto();
    active=active||!!photo?.busy;
    for(const [id,outcome] of [['completeSaleBtn','completed'],['abandonedSaleBtn','abandoned']]){
      const button=byId(id);button.disabled=active||!pendingProviderCapture?.id||!ownedCapture(pendingProviderCapture)||!!(lockedOutcome&&lockedOutcome!==outcome);button.setAttribute('aria-busy',String(active&&action===outcome));
    }
    byId('providerReturnResume').disabled=active||!!lockedOutcome;
    byId('providerReturnPhoto').disabled=active||!!lockedOutcome||!photo?.canAdd;
    byId('providerReturnPhotoStatus').textContent=photo?.message||'';
  }
  function renderProviderCapture(capture){
    if(!sameCapture(pendingProviderCapture,capture))lockedOutcome=capture?.outcome_pending||null;
    pendingProviderCapture=capture||null;
    byId('providerReturnProvider').textContent=capture?.provider||'';
    byId('providerReturnAddress').textContent=capture?.service_address||'';
    byId('providerReturnResume').hidden=!capture?.portal_opened;
    setOutcomeButtonsBusy(submitting,lockedOutcome);
  }
  function hideReturnScreen(){modal.hidden=true;modal.classList.remove('show');}
  function finishReturn(message){
    hideReturnScreen();window.MCCOY_PROVIDER_DASHBOARD_ACTIVE=false;
    document.querySelector('.nav-btn[data-view="field"]')?.click();
    if(returnFocus?.isConnected&&returnFocus.getClientRects().length)returnFocus.focus?.({preventScroll:true});
    returnToast.textContent=message;returnToast.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>{returnToast.hidden=true;},5000);
  }
  function freezeOutcome(action){
    if(currentPhoto()?.busy)throw new Error('Wait for the photo upload to finish before choosing the sale result.');
    if(!ownedCapture(pendingProviderCapture)||!pendingProviderCapture.id)throw new Error('This provider attempt is not ready. Reload Field Coach to recover it.');
    if(lockedOutcome&&lockedOutcome!==action)throw new Error('Retry the selected outcome so its saved result can be confirmed.');
    lockedOutcome=action;
    window.MCCOY_SET_PROVIDER_OUTCOME_PENDING?.(pendingProviderCapture.id,action);
    return{capture:{...pendingProviderCapture},account:accountIdentity()};
  }
  function currentOutcome(request){return request.account===accountIdentity()&&sameCapture(request.capture,pendingProviderCapture);}
  function selectedSaleLead(currentState){
    const selected=String(byId('fieldLeadSelect')?.value||'');
    return currentState?.activeDoorVisit?.lead||currentState?.leads?.find(item=>String(item.id)===selected||String(item.dbId)===selected)||null;
  }
  function normalizedAddress(value){return String(value||'').toLowerCase().replace(/[^a-z0-9]/g,'');}
  async function saleDistanceInput(lead,serviceAddress){
    const currentState=(typeof state!=='undefined')?state:null;
    let gps=currentState?.latestGps||null;
    if(typeof getGPSOnce==='function'){
      try{const fresh=await Promise.race([getGPSOnce(),new Promise(resolve=>setTimeout(()=>resolve(null),3500))]);if(fresh){gps=fresh;if(currentState)currentState.latestGps=fresh;}}catch(_){}
    }
    const repLat=Number(gps?.lat),repLng=Number(gps?.lng),accuracy=Number(gps?.accuracy);
    const leadLat=Number(lead?.lat),leadLng=Number(lead?.lng),saleAddress=normalizedAddress(serviceAddress);
    const addressMatches=[lead?.address,lead?.fullAddress].some(value=>normalizedAddress(value)===saleAddress);
    const payload={lead_id:addressMatches?(lead?.dbId||null):null};
    if(Number.isFinite(repLat)&&repLat>=-90&&repLat<=90&&Number.isFinite(repLng)&&repLng>=-180&&repLng<=180)payload.rep_location={latitude:repLat,longitude:repLng,accuracy_meters:Number.isFinite(accuracy)&&accuracy>=0?accuracy:null,captured_at:new Date(Number(gps?.capturedAt)||Date.now()).toISOString()};
    if(addressMatches&&Number.isFinite(leadLat)&&leadLat>=-90&&leadLat<=90&&Number.isFinite(leadLng)&&leadLng>=-180&&leadLng<=180)payload.customer_map_location={latitude:leadLat,longitude:leadLng};
    return payload;
  }
  function resumeProviderCapture(capture,focusOutcome=false){
    if(!ownedCapture(capture)||!capture.id||['recorded','cancelled'].includes(capture.status))return;
    if(submitting&&!sameCapture(capture,pendingProviderCapture))return;
    renderProviderCapture(capture);
    if(!focusOutcome)return;
    const opening=modal.hidden;
    if(opening){returnFocus=document.activeElement;setSaleMsg(lockedOutcome?'The last save was not confirmed. Retry the same icon to confirm its result.':'');}
    window.MCCOY_LEAD_MAP_WINDOW?.restore?.();modal.hidden=false;modal.classList.add('show');
    // Focus the neutral heading container, never a sale action that Enter could activate.
    if(opening)modal.focus({preventScroll:true});
  }
  document.addEventListener('click',e=>{
    const button=e.target?.closest?.('[data-disp="Sale"]');if(!button||window.MCCOY_SALE_CONFIRMED)return;
    e.preventDefault();e.stopImmediatePropagation();
    const capture=window.MCCOY_ACTIVE_PROVIDER_CAPTURE;
    if(ownedCapture(capture))resumeProviderCapture(capture,true);
  },true);
  modal.addEventListener('keydown',event=>{
    if(event.key==='Escape'){event.preventDefault();return;}
    if(event.key!=='Tab')return;
    const buttons=[...modal.querySelectorAll('button')].filter(button=>!button.disabled&&!button.hidden);
    if(!buttons.length){event.preventDefault();modal.focus();return;}
    const first=buttons[0],last=buttons.at(-1);
    if(event.shiftKey&&(document.activeElement===first||document.activeElement===modal)){event.preventDefault();last.focus();}
    else if(!event.shiftKey&&(document.activeElement===last||document.activeElement===modal)){event.preventDefault();first.focus();}
  });
  byId('providerReturnResume').addEventListener('click',()=>{
    if(submitting||lockedOutcome||currentPhoto()?.busy||!ownedCapture(pendingProviderCapture))return;
    const result=window.MCCOY_RESUME_PROVIDER_DASHBOARD?.(pendingProviderCapture);
    if(result?.opened)hideReturnScreen();else setSaleMsg('The provider dashboard could not reopen. Your attempt remains unfinished.','error');
  });
  byId('providerReturnPhoto').addEventListener('click',event=>{
    if(submitting||lockedOutcome||!currentPhoto()?.canAdd)return;
    // Forward the original tap synchronously so mobile Safari can open its picker.
    window.MCCOY_OPEN_SALE_PHOTO_PICKER?.(event);
  });
  window.addEventListener('mccoy-sale-photo-state-changed',()=>setOutcomeButtonsBusy(submitting,lockedOutcome));
  window.addEventListener('mccoy-provider-sale-photo-staged',event=>{
    const {capture,photoId}=event.detail||{};
    if(!photoId||submitting||lockedOutcome||!ownedCapture(capture)||!sameCapture(capture,pendingProviderCapture)||!sameCapture(capture,window.MCCOY_ACTIVE_PROVIDER_CAPTURE))return;
    resumeProviderCapture(capture,true);
  });
  async function functionErrorDetail(error,data){let detail=data?.detail||data?.error||'';try{if(!detail&&error?.context?.clone){const value=await error.context.clone().json();detail=value?.detail||value?.error||'';}}catch(_){}return String(detail||error?.message||'').replace(/_/g,' ').trim();}
  async function readyCapture(expected=pendingProviderCapture){
    let capture=expected;
    if(window.MCCOY_PROVIDER_CAPTURE_READY){const ready=await Promise.race([window.MCCOY_PROVIDER_CAPTURE_READY,new Promise(resolve=>setTimeout(()=>resolve(capture),5000))]);if(sameCapture(ready,expected)&&ownedCapture(ready))capture={...expected,...ready};}
    if(!ownedCapture(capture)||!sameCapture(capture,pendingProviderCapture))throw new Error('The active account or provider attempt changed. No new outcome was submitted.');
    return capture;
  }
  function clearCompletedCapture(captureId){if(window.MCCOY_CLEAR_PROVIDER_CAPTURE)window.MCCOY_CLEAR_PROVIDER_CAPTURE(captureId);pendingProviderCapture=null;renderProviderCapture(null);}

  async function recordAbandoned(){
    if(submitting||lockedOutcome&&lockedOutcome!=='abandoned')return;let request;try{request=freezeOutcome('abandoned');}catch(error){setSaleMsg(error.message,'error');return;}submitting=true;setOutcomeButtonsBusy(true,'abandoned');setSaleMsg('Saving abandoned outcome…');
    try{
      const {data:sessionData,error:sessionError}=await sb.auth.getSession();if(sessionError||!sessionData?.session)throw new Error('Your sign-in session expired. Reload Field Coach to sign in again; this attempt stays unfinished.');
      const capture=await readyCapture(request.capture);if(!currentOutcome(request))return;if(!capture?.id)throw new Error('This provider attempt could not be recovered. Reload Field Coach and retry the red X.');
      const {data,error}=await Promise.race([sb.functions.invoke('provider-sale-capture',{body:{action:'set_outcome',capture_id:capture.id,outcome:'abandoned'}}),new Promise((_,reject)=>setTimeout(()=>reject(new Error('Abandoned save timed out. Check connection and retry.')),20000))]);if(error||!data?.ok){if(!await confirmAlreadyAbandoned(capture.id)){const detail=await functionErrorDetail(error,data);throw new Error(detail?`Abandoned attempt could not be recorded: ${detail}`:'Abandoned attempt could not be recorded.');}}
      if(!currentOutcome(request))return;clearCompletedCapture(capture.id);window.dispatchEvent(new CustomEvent('mccoy-provider-sale-abandoned',{detail:{providerCaptureId:capture.id}}));finishReturn('Abandoned attempt saved. No sale was recorded.');
    }catch(error){console.error('ABANDONED failed',error);if(currentOutcome(request))setSaleMsg((error?.message||'Abandoned attempt could not be recorded.')+' Retry the red X to confirm this same attempt.','error');}
    finally{submitting=false;setOutcomeButtonsBusy(false);}
  }

  async function completeSale(){
    if(submitting||lockedOutcome&&lockedOutcome!=='completed')return;let request;try{request=freezeOutcome('completed');}catch(error){setSaleMsg(error.message,'error');return;}submitting=true;setOutcomeButtonsBusy(true,'completed');setSaleMsg('Saving sale outcome…');
    try{
      const {data:sessionData,error:sessionError}=await sb.auth.getSession();if(sessionError||!sessionData?.session)throw new Error('Your sign-in session expired. Reload Field Coach to sign in again; this attempt stays unfinished.');
      const capture=await readyCapture(request.capture);if(!currentOutcome(request))return;if(!capture?.id)throw new Error('This provider attempt could not be recovered. Reload Field Coach and retry the green check.');
      const currentState=(typeof state!=='undefined')?state:null,doorContext=window.MCCOY_DISTANCE_TO_LEAD_CONTROL?.current?.()||null,lead=doorContext?.lead||selectedSaleLead(currentState);
      const serviceAddress=capture.service_address||doorContext?.address||(lead?.address||lead?.fullAddress)||null;
      const distanceInput=await saleDistanceInput(lead,serviceAddress);if(!currentOutcome(request))return;
      let sessionId=capture.session_id||null;try{if(!sessionId&&typeof telemetrySessionId!=='undefined')sessionId=telemetrySessionId||null;}catch(_){}
      const body={sale_outcome:'completed',capture_only_completion:true,tester_simulation:isTesterPkbSale(),provider_capture_id:capture.id,session_id:sessionId,...distanceInput};
      const invokePromise=sb.functions.invoke('sale-submit',{body});const timeoutPromise=new Promise((_,reject)=>setTimeout(()=>reject(new Error('Sale save timed out. Check connection and retry.')),20000));const {data,error}=await Promise.race([invokePromise,timeoutPromise]);
      if(error||!data?.ok){const detail=await functionErrorDetail(error,data);throw new Error(detail?`Sale could not be completed: ${detail}`:'Sale could not be completed. Check connection and retry.');}if(!currentOutcome(request))return;
      const verification=data.verification||{},captureId=capture.id;clearCompletedCapture(captureId);finishReturn('Sale outcome saved. Rankings are updating.');window.MCCOY_SALE_CONTEXT='field';window.dispatchEvent(new CustomEvent('mccoy-sale-saved',{detail:{saleId:data.sale_id||null,outcome:'completed',testerSimulation:isTesterPkbSale(),verification,saleContext:capture.sale_context||'field',providerCaptureId:captureId}}));Promise.allSettled([loadFeed(),window.MCCOY_REFRESH_RANKINGS?.()]);window.MCCOY_SALE_CONFIRMED=true;try{await Promise.resolve(window.MCCOY_COMPLETE_DOOR_VISIT?.('sale',{automatic:true,autoReason:'completed_sale_recorded',saleId:data.sale_id||null,serviceAddress})).catch(error=>console.error('Sale saved; door completion refresh failed',error));}finally{window.MCCOY_SALE_CONFIRMED=false;}
    }catch(error){console.error('COMPLETE SALE failed',error);if(currentOutcome(request))setSaleMsg((error?.message||'Sale could not be completed.')+' Retry the green check to confirm this same attempt.','error');}
    finally{submitting=false;setOutcomeButtonsBusy(false);}
  }
  byId('completeSaleBtn')?.addEventListener('click',completeSale);
  byId('abandonedSaleBtn')?.addEventListener('click',recordAbandoned);
  for(const eventName of ['mccoy-provider-sale-capture-started','mccoy-provider-sale-capture-ready'])window.addEventListener(eventName,event=>resumeProviderCapture(event.detail?.capture,false));
  window.addEventListener('mccoy-provider-sale-returned',event=>resumeProviderCapture(event.detail?.capture,true));
  window.addEventListener('mccoy-provider-sale-capture-restored',event=>{if(event.detail?.validated)resumeProviderCapture(event.detail.capture,!window.MCCOY_PROVIDER_DASHBOARD_ACTIVE);});
  window.addEventListener('mccoy-provider-sale-capture-invalidated',()=>{if(submitting)return;renderProviderCapture(null);hideReturnScreen();});
  window.addEventListener('mccoy-access-ready',()=>{if(!ownedCapture(pendingProviderCapture)){renderProviderCapture(null);hideReturnScreen();}});
  async function confirmAlreadyAbandoned(captureId){
    try{const {data,error}=await sb.functions.invoke('provider-sale-capture',{body:{action:'list',mine_only:true}});return !error&&data?.ok&&(data.captures||[]).some(capture=>capture.id===captureId&&capture.status==='cancelled'&&capture.rep_outcome==='abandoned');}catch(_){return false;}
  }

  function renderSalesFeed(rows){const root=byId('salesFeed');if(!root)return;root.replaceChildren();const wins=[];for(const row of rows){const messages=Array.isArray(row.celebration_messages)&&row.celebration_messages.length?row.celebration_messages:[row.message||`${row.rep_name||'A rep'} logged a sale`];for(const message of messages)wins.push({message,created_at:row.created_at});}if(!wins.length){const empty=document.createElement('div');empty.className='muted small';empty.textContent='No completed sales posted this month yet.';root.appendChild(empty);return;}for(const win of wins.slice(0,30)){const item=document.createElement('div');item.className='feed-item';const message=document.createElement('strong'),time=document.createElement('div');message.textContent=win.message;time.className='muted small';time.textContent=new Date(win.created_at).toLocaleString();item.append(message,time);root.appendChild(item);}}
  function renderMonthlyRankings(rankings){const root=byId('monthlyLeaders');if(!root)return;root.replaceChildren();const rows=(rankings||[]).filter(row=>row.is_ghost||Number(row.month_sales||0)>0).sort((left,right)=>(left.ranks?.month||Number.MAX_SAFE_INTEGER)-(right.ranks?.month||Number.MAX_SAFE_INTEGER)).slice(0,10);if(!rows.length){const empty=document.createElement('div');empty.className='muted small';empty.textContent='No completed McCoy sales yet.';root.appendChild(empty);return;}rows.forEach((row,index)=>{const line=document.createElement('div');line.className='leader-row';const name=document.createElement('span'),count=document.createElement('strong');name.textContent=`${index+1}. ${row.rep_name||'Rep'}`;const sales=Number(row.month_sales||0),ghostRevealed=row.ghost_visibility?.month?.revealed!==false;count.textContent=row.is_ghost&&!ghostRevealed?'Hidden':`${sales} sale${sales===1?'':'s'}`;line.append(name,count);const detail=document.createElement('div');detail.className='muted small';detail.textContent=row.is_ghost?(ghostRevealed?'Verified Ghost-account sales · revealed because a real user is ahead':'Ghost is #1 · total hidden until overtaken'):`${Number(row.month_mobile_lines||0)} mobile lines · ${Number(row.month_directv||0)} DIRECTV · ${Number(row.month_vivint||0)} Vivint`;root.append(line,detail);});}
  async function loadFeed(){if(!window.MCCOY_ACCESS?.user)return;const start=new Date();start.setDate(1);start.setHours(0,0,0,0);try{const {data,error}=await sb.from('sales_feed').select('id,created_at,rep_user_id,rep_name,isp,directv,att_mobile_lines,vivint,message,celebration_messages,celebration_types,celebration_payload,ranking_eligible_at_event').gte('created_at',start.toISOString()).order('created_at',{ascending:false}).limit(100);if(error)throw error;renderSalesFeed(data||[]);const {data:leaders,error:leaderError}=await sb.functions.invoke('company-leaders');if(leaderError||!leaders?.ok)throw leaderError||new Error(leaders?.error||'company_leaders_failed');renderMonthlyRankings(leaders.rankings||[]);}catch(error){console.error('Sales activity refresh failed',error);}}
  byId('salesRefreshBtn')?.addEventListener('click',loadFeed);
  const authPoll=setInterval(()=>{const access=window.MCCOY_ACCESS?.access;if(!access)return;clearInterval(authPoll);loadFeed();},400);
  window.addEventListener('mccoy-live-sales-changed',loadFeed);
})();
