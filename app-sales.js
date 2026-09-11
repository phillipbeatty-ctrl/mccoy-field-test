// Provider return outcome: one captured attempt, then Complete Sale or Abandoned.
(function(){
  const byId=id=>document.getElementById(id);
  const providers=['Quantum','Brightspeed','AT&T','T-Mobile / T-Fiber','Kinetic','Fidium','Ziply','Ascend Fiber','Lightcurve','Ripple Fiber','Starlink','DIRECTV','Vivint','Other'];
  const css=document.createElement('style');css.textContent=`
  .sales-strip{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:12px 0}.sales-card{border:1px solid #e5e7eb;border-radius:12px;padding:12px;background:#fff}.sales-feed{max-height:260px;overflow:auto}.feed-item{padding:10px 0;border-bottom:1px solid #eee;font-size:13px}.feed-item:last-child{border-bottom:0}.leader-row{display:flex;justify-content:space-between;padding:6px 0;font-size:13px}.sale-modal{position:static;display:none;margin-top:16px;padding:0;background:transparent}.sale-modal.show{display:block}.sale-form{width:100%;background:#f8fafc;border:1px solid #e5e7eb;border-radius:14px;padding:18px}.sale-form h2{margin-top:0}.provider-capture-banner{display:none;margin:0 0 12px;padding:11px 12px;border:1px solid #f59e0b;border-radius:10px;background:#fffbeb;color:#78350f;font-size:12px}.provider-capture-banner.show{display:block}.provider-capture-banner strong{display:block;margin-bottom:3px}.sale-outcome-actions{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:14px}.sale-outcome-actions button{min-height:50px;touch-action:manipulation;font-weight:800}.sale-msg-error{color:#991b1b!important;font-weight:700}.sale-msg-ok{color:#166534!important;font-weight:700}@media(max-width:650px){.sales-strip,.sale-outcome-actions{grid-template-columns:1fr}}
  `;document.head.appendChild(css);

  let providerBar=byId('sessionIsp')?.closest('.sales-card');
  if(!providerBar){providerBar=document.createElement('div');providerBar.className='sales-card';providerBar.innerHTML=`<strong>Selling for</strong><select id="sessionIsp" style="margin-top:8px;width:100%;padding:9px">${providers.map(x=>`<option>${x}</option>`).join('')}</select>`;const fieldSelect=byId('fieldLeadSelect');if(fieldSelect?.parentNode)fieldSelect.parentNode.insertBefore(providerBar,fieldSelect);}
  const closestDoorBox=byId('closestDoorAddress');if(providerBar&&closestDoorBox)providerBar.insertAdjacentElement('afterend',closestDoorBox);
  const ispSel=byId('sessionIsp');
  if(ispSel){ispSel.innerHTML=providers.map(x=>`<option>${x}</option>`).join('');const savedIsp=localStorage.getItem('mccoy_isp');ispSel.value=providers.includes(savedIsp)?savedIsp:'Quantum';ispSel.onchange=()=>localStorage.setItem('mccoy_isp',ispSel.value);}

  if(!byId('monthlyLeaders')){const social=document.createElement('div');social.className='sales-strip';social.innerHTML=`<div class="sales-card"><div style="display:flex;justify-content:space-between;gap:8px"><strong>🏆 Monthly Sales</strong><button type="button" id="salesRefreshBtn" class="assign-btn">Refresh</button></div><div id="monthlyLeaders" style="margin-top:8px">Loading…</div></div><div class="sales-card"><strong>🎉 Live Wins</strong><div id="salesFeed" class="sales-feed" style="margin-top:8px">Loading…</div></div>`;const eff=byId('efficiencySummary');if(eff?.parentNode)eff.parentNode.insertBefore(social,eff);}

  let modal=byId('saleModal');
  if(!modal){
    modal=document.createElement('div');modal.className='sale-modal';modal.id='saleModal';
    modal.innerHTML=`<div class="sale-form"><h2>Provider Outcome</h2><p class="muted small">Choose what happened in the ISP sales dashboard. No customer or order details are required in McCoy.</p><div id="providerCaptureBanner" class="provider-capture-banner" role="status" aria-live="polite"></div><div class="sale-outcome-actions" role="group" aria-label="Provider sale outcome"><button type="button" id="completeSaleBtn" class="primary">COMPLETE SALE</button><button type="button" id="abandonedSaleBtn" class="assign-btn">ABANDONED</button></div><div id="saleMsg" class="muted small" role="status" aria-live="polite" style="margin-top:10px;min-height:16px"></div></div>`;
    const dispositions=document.querySelector('#field .spotio-disposition-panel')||document.querySelector('#field .disposition-grid');if(dispositions)dispositions.insertAdjacentElement('afterend',modal);else document.body.appendChild(modal);
  }

  const setSaleMsg=(text,type='')=>{const el=byId('saleMsg');if(!el)return;el.textContent=text;el.classList.remove('sale-msg-error','sale-msg-ok');if(type==='error')el.classList.add('sale-msg-error');if(type==='ok')el.classList.add('sale-msg-ok');};
  let pendingProviderCapture=null,submitting=false;
  function isTesterPkbSale(){
    const email=String(window.MCCOY_ACCESS?.user?.email||'').trim().toLowerCase(),displayName=String(window.MCCOY_ACCESS?.access?.display_name||'').trim().toLowerCase();
    return window.MCCOY_TESTER_PKB_SALE===true&&email==='phillipkbeatty@gmail.com'&&displayName==='ghost';
  }
  function setOutcomeButtonsBusy(active,action=''){
    const complete=byId('completeSaleBtn'),abandoned=byId('abandonedSaleBtn');
    if(complete){complete.disabled=active;complete.textContent=active&&action==='completed'?'COMPLETING…':'COMPLETE SALE';}
    if(abandoned){abandoned.disabled=active;abandoned.textContent=active&&action==='abandoned'?'RECORDING…':'ABANDONED';}
  }
  function renderProviderCapture(capture){
    pendingProviderCapture=capture||null;const banner=byId('providerCaptureBanner');if(!banner)return;
    if(!capture){banner.classList.remove('show');banner.textContent='';return;}
    const provider=capture.provider||ispSel?.value||'provider';
    banner.innerHTML=isTesterPkbSale()?`<strong>Ghost simulation · ${provider}</strong>COMPLETE SALE records a verified Ghost sale for rankings and accounting; no customer information is collected. ABANDONED creates no sale.`:`<strong>${capture?.recovered_from_server?'Unfinished sale recovered':`${provider} dashboard attempt captured`}</strong>COMPLETE SALE updates rankings immediately. Provider evidence remains separate for accounting and review. ABANDONED creates no sale.`;
    banner.classList.add('show');
  }
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
    if(!capture||capture.status==='recorded'||capture.status==='cancelled')return;
    renderProviderCapture(capture);
    if(ispSel&&providers.includes(capture.provider)){ispSel.value=capture.provider;localStorage.setItem('mccoy_isp',capture.provider);}
    setSaleMsg('');modal.classList.add('show');
    if(focusOutcome){modal.scrollIntoView?.({behavior:'smooth',block:'nearest'});setTimeout(()=>byId('completeSaleBtn')?.focus(),50);}
  }
  document.addEventListener('click',e=>{
    const button=e.target?.closest?.('[data-disp="Sale"]');if(!button||window.MCCOY_SALE_CONFIRMED)return;
    e.preventDefault();e.stopImmediatePropagation();renderProviderCapture(window.MCCOY_ACTIVE_PROVIDER_CAPTURE||null);setSaleMsg('');modal.classList.add('show');modal.scrollIntoView?.({behavior:'smooth',block:'nearest'});setTimeout(()=>byId('completeSaleBtn')?.focus(),50);
  },true);
  async function functionErrorDetail(error,data){let detail=data?.detail||data?.error||'';try{if(!detail&&error?.context?.clone){const value=await error.context.clone().json();detail=value?.detail||value?.error||'';}}catch(_){}return String(detail||error?.message||'').replace(/_/g,' ').trim();}
  async function readyCapture(){
    let capture=pendingProviderCapture||window.MCCOY_ACTIVE_PROVIDER_CAPTURE||null;
    if(window.MCCOY_PROVIDER_CAPTURE_READY)capture=await Promise.race([window.MCCOY_PROVIDER_CAPTURE_READY,new Promise(resolve=>setTimeout(()=>resolve(capture),5000))])||capture;
    return capture;
  }
  function clearCompletedCapture(captureId){if(window.MCCOY_CLEAR_PROVIDER_CAPTURE)window.MCCOY_CLEAR_PROVIDER_CAPTURE(captureId);pendingProviderCapture=null;renderProviderCapture(null);}

  async function recordAbandoned(){
    if(submitting)return;submitting=true;setOutcomeButtonsBusy(true,'abandoned');setSaleMsg('Recording abandoned provider attempt…');
    try{
      const {data:sessionData,error:sessionError}=await sb.auth.getSession();if(sessionError||!sessionData?.session)throw new Error('Your sign-in session expired. Sign in again and retry.');
      const capture=await readyCapture();if(!capture?.id)throw new Error('McCoy could not find this provider attempt. Reopen the sale and choose ABANDONED again.');
      const {data,error}=await sb.functions.invoke('provider-sale-capture',{body:{action:'set_outcome',capture_id:capture.id,outcome:'abandoned'}});if(error||!data?.ok){const detail=await functionErrorDetail(error,data);throw new Error(detail?`Abandoned attempt could not be recorded: ${detail}`:'Abandoned attempt could not be recorded.');}
      clearCompletedCapture(capture.id);setSaleMsg('Abandoned attempt recorded. No sale or celebration was created.','ok');window.dispatchEvent(new CustomEvent('mccoy-provider-sale-abandoned',{detail:{providerCaptureId:capture.id}}));setTimeout(()=>{modal.classList.remove('show');setSaleMsg('');},850);
    }catch(error){console.error('ABANDONED failed',error);setSaleMsg(error?.message||'Abandoned attempt could not be recorded. Check connection and retry.','error');}
    finally{submitting=false;setOutcomeButtonsBusy(false);}
  }

  async function completeSale(){
    if(submitting)return;submitting=true;setOutcomeButtonsBusy(true,'completed');setSaleMsg('Completing sale and refreshing live rankings…');
    try{
      const {data:sessionData,error:sessionError}=await sb.auth.getSession();if(sessionError||!sessionData?.session)throw new Error('Your sign-in session expired. Sign in again and retry.');
      const capture=await readyCapture();if(!capture?.id)throw new Error('McCoy could not find this provider attempt. Reopen the sale and choose COMPLETE SALE again.');
      const currentState=(typeof state!=='undefined')?state:null,doorContext=window.MCCOY_DISTANCE_TO_LEAD_CONTROL?.current?.()||null,lead=doorContext?.lead||selectedSaleLead(currentState);
      const serviceAddress=capture.service_address||doorContext?.address||(lead?.address||lead?.fullAddress)||null;
      const distanceInput=await saleDistanceInput(lead,serviceAddress);
      let sessionId=capture.session_id||null;try{if(!sessionId&&typeof telemetrySessionId!=='undefined')sessionId=telemetrySessionId||null;}catch(_){}
      const body={sale_outcome:'completed',capture_only_completion:true,tester_simulation:isTesterPkbSale(),provider_capture_id:capture.id,session_id:sessionId,...distanceInput};
      const invokePromise=sb.functions.invoke('sale-submit',{body});const timeoutPromise=new Promise((_,reject)=>setTimeout(()=>reject(new Error('Sale save timed out. Check connection and retry.')),20000));const {data,error}=await Promise.race([invokePromise,timeoutPromise]);
      if(error||!data?.ok){const detail=await functionErrorDetail(error,data);throw new Error(detail?`Sale could not be completed: ${detail}`:'Sale could not be completed. Check connection and retry.');}
      const verification=data.verification||{},captureId=capture.id;setSaleMsg('Sale completed · Ranking live.','ok');clearCompletedCapture(captureId);modal.classList.remove('show');window.MCCOY_SALE_CONTEXT='field';window.dispatchEvent(new CustomEvent('mccoy-sale-saved',{detail:{saleId:data.sale_id||null,outcome:'completed',testerSimulation:isTesterPkbSale(),verification,saleContext:capture.sale_context||'field',providerCaptureId:captureId}}));await Promise.allSettled([loadFeed(),window.MCCOY_REFRESH_RANKINGS?.()]);window.MCCOY_SALE_CONFIRMED=true;try{await window.MCCOY_COMPLETE_DOOR_VISIT?.('sale',{automatic:true,autoReason:'completed_sale_recorded',saleId:data.sale_id||null,serviceAddress});}finally{window.MCCOY_SALE_CONFIRMED=false;}
    }catch(error){console.error('COMPLETE SALE failed',error);setSaleMsg(error?.message||'Sale could not be completed. Check connection and retry.','error');}
    finally{submitting=false;setOutcomeButtonsBusy(false);}
  }
  byId('completeSaleBtn')?.addEventListener('click',completeSale);
  byId('abandonedSaleBtn')?.addEventListener('click',recordAbandoned);
  for(const eventName of ['mccoy-provider-sale-capture-started','mccoy-provider-sale-capture-ready'])window.addEventListener(eventName,event=>resumeProviderCapture(event.detail?.capture,false));
  window.addEventListener('mccoy-provider-sale-returned',event=>resumeProviderCapture(event.detail?.capture,true));
  window.addEventListener('mccoy-provider-sale-capture-restored',event=>resumeProviderCapture(event.detail?.capture,false));
  window.addEventListener('mccoy-provider-sale-capture-error',event=>{resumeProviderCapture(event.detail?.capture,false);setSaleMsg('The ISP dashboard opened, but McCoy could not secure the provider capture. Return to the sale and retry before choosing an outcome.','error');});

  function renderSalesFeed(rows){const root=byId('salesFeed');if(!root)return;root.replaceChildren();const wins=[];for(const row of rows){const messages=Array.isArray(row.celebration_messages)&&row.celebration_messages.length?row.celebration_messages:[row.message||`${row.rep_name||'A rep'} logged a sale`];for(const message of messages)wins.push({message,created_at:row.created_at});}if(!wins.length){const empty=document.createElement('div');empty.className='muted small';empty.textContent='No completed sales posted this month yet.';root.appendChild(empty);return;}for(const win of wins.slice(0,30)){const item=document.createElement('div');item.className='feed-item';const message=document.createElement('strong'),time=document.createElement('div');message.textContent=win.message;time.className='muted small';time.textContent=new Date(win.created_at).toLocaleString();item.append(message,time);root.appendChild(item);}}
  function renderMonthlyRankings(rankings){const root=byId('monthlyLeaders');if(!root)return;root.replaceChildren();const rows=(rankings||[]).filter(row=>row.is_ghost||Number(row.month_sales||0)>0).sort((left,right)=>(left.ranks?.month||Number.MAX_SAFE_INTEGER)-(right.ranks?.month||Number.MAX_SAFE_INTEGER)).slice(0,10);if(!rows.length){const empty=document.createElement('div');empty.className='muted small';empty.textContent='No completed McCoy sales yet.';root.appendChild(empty);return;}rows.forEach((row,index)=>{const line=document.createElement('div');line.className='leader-row';const name=document.createElement('span'),count=document.createElement('strong');name.textContent=`${index+1}. ${row.rep_name||'Rep'}`;const sales=Number(row.month_sales||0),ghostRevealed=row.ghost_visibility?.month?.revealed!==false;count.textContent=row.is_ghost&&!ghostRevealed?'Hidden':`${sales} sale${sales===1?'':'s'}`;line.append(name,count);const detail=document.createElement('div');detail.className='muted small';detail.textContent=row.is_ghost?(ghostRevealed?'Verified Ghost-account sales · revealed because a real user is ahead':'Ghost is #1 · total hidden until overtaken'):`${Number(row.month_mobile_lines||0)} mobile lines · ${Number(row.month_directv||0)} DIRECTV · ${Number(row.month_vivint||0)} Vivint`;root.append(line,detail);});}
  async function loadFeed(){if(!window.MCCOY_ACCESS?.user)return;const start=new Date();start.setDate(1);start.setHours(0,0,0,0);try{const {data,error}=await sb.from('sales_feed').select('id,created_at,rep_user_id,rep_name,isp,directv,att_mobile_lines,vivint,message,celebration_messages,celebration_types,celebration_payload,ranking_eligible_at_event').gte('created_at',start.toISOString()).order('created_at',{ascending:false}).limit(100);if(error)throw error;renderSalesFeed(data||[]);const {data:leaders,error:leaderError}=await sb.functions.invoke('company-leaders');if(leaderError||!leaders?.ok)throw leaderError||new Error(leaders?.error||'company_leaders_failed');renderMonthlyRankings(leaders.rankings||[]);}catch(error){console.error('Sales activity refresh failed',error);}}
  byId('salesRefreshBtn')?.addEventListener('click',loadFeed);
  const authPoll=setInterval(()=>{const access=window.MCCOY_ACCESS?.access;if(!access)return;clearInterval(authPoll);loadFeed();},400);
  window.addEventListener('mccoy-live-sales-changed',loadFeed);
})();
