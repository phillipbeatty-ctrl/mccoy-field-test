// Select the sale provider and redirect to its seller portal only when SALE is chosen.
// Provider passwords are never stored or autofilled by McCoy. Portal sessions
// are reused only when the provider's own browser session or SSO allows it.
(function(){
  if(window.MCCOY_PROVIDER_SALE_ROUTER)return;
  window.MCCOY_PROVIDER_SALE_ROUTER=true;

  const PROVIDERS=['Quantum','Brightspeed','AT&T','T-Mobile / T-Fiber','Kinetic','Fidium','Ascend Fiber','Lightcurve','Ripple Fiber','Starlink','DIRECTV','Vivint','Other'];
  const CAPTURE_STORAGE_KEY='mccoy_active_provider_sale_capture_v1';
  const PORTAL_CONTEXT_STORAGE_KEY='mccoy_last_provider_portal_context_v1';
  const defaults={
    Brightspeed:{label:'BASS',url:''},
    Quantum:{label:'ASAP',url:''},
    'AT&T':{label:'AT&T seller account',url:''},
    'T-Mobile / T-Fiber':{label:'T-Mobile seller account',url:''},
    Kinetic:{label:'Kinetic seller account',url:''},
    Fidium:{label:'Fidium seller account',url:''},
    'Ascend Fiber':{label:'Ascend Fiber seller account',url:''},
    Lightcurve:{label:'Lightcurve seller account',url:''},
    'Ripple Fiber':{label:'Ripple Fiber seller account',url:''},
    Starlink:{label:'Starlink seller account',url:''},
    DIRECTV:{label:'DIRECTV seller account',url:''},
    Vivint:{label:'Vivint seller account',url:''},
    Other:{label:'Seller account',url:''}
  };
  const configured=window.MCCOY_PROVIDER_PORTALS||{};
  const portals=Object.fromEntries(PROVIDERS.map(provider=>{
    const value=configured[provider];
    const override=typeof value==='string'?{url:value}:value||{};
    return [provider,{...defaults[provider],...override}];
  }));

  const style=document.createElement('style');
  style.textContent=`
    #providerSaleRouter{position:fixed;inset:0;z-index:160000;display:none;align-items:center;justify-content:center;padding:16px;background:rgba(15,23,42,.78)}
    #providerSaleRouter.show{display:flex}.provider-router-card{width:min(520px,100%);border-radius:16px;background:#fff;padding:20px;box-shadow:0 24px 80px rgba(15,23,42,.35)}
    .provider-router-card h2{margin:0 0 6px}.provider-router-fields{display:grid;gap:10px;margin:16px 0}.provider-router-fields label{display:grid;gap:5px;font-size:12px;font-weight:800}
    .provider-router-fields select{width:100%;box-sizing:border-box;padding:11px;border:1px solid #cbd5e1;border-radius:9px;background:#fff}.provider-router-actions{display:flex;gap:9px}.provider-router-actions button{flex:1;min-height:44px}
    #providerRouteToast{position:fixed;left:50%;bottom:22px;z-index:160100;display:none;max-width:min(620px,calc(100vw - 28px));transform:translateX(-50%);border-radius:10px;padding:10px 14px;background:#111827;color:#fff;font-size:12px;box-shadow:0 12px 36px rgba(15,23,42,.3)}
    #providerRouteToast.show{display:block}@media(max-width:560px){.provider-router-actions{flex-direction:column}}
  `;
  document.head.appendChild(style);

  const panel=document.createElement('div');
  panel.id='providerSaleRouter';
  panel.setAttribute('role','dialog');
  panel.setAttribute('aria-modal','true');
  panel.setAttribute('aria-labelledby','providerRouterTitle');
  panel.innerHTML=`<div class="provider-router-card"><h2 id="providerRouterTitle">Choose provider for this sale</h2><p id="providerRouterDescription" class="muted small">Select the Internet provider whose seller account will process this sale.</p><div class="provider-router-fields"><label>Internet Provider<select id="providerRouterChoice"></select></label></div><div id="providerRouterStatus" class="muted small" aria-live="polite"></div><div class="provider-router-actions"><button id="providerRouterContinue" type="button" class="primary">CONTINUE</button><button id="providerRouterCancel" type="button" class="assign-btn">Cancel</button></div></div>`;
  document.body.appendChild(panel);
  const toast=document.createElement('div');toast.id='providerRouteToast';toast.setAttribute('role','status');toast.setAttribute('aria-live','polite');document.body.appendChild(toast);

  const choice=document.getElementById('providerRouterChoice');
  for(const provider of PROVIDERS)choice.add(new Option(provider,provider));

  let pending=null,toastTimer=null,routing=false;
  let saleGuard=false;
  let returnNotifiedFor=null;
  function readCapture(){
    try{const value=JSON.parse(localStorage.getItem(CAPTURE_STORAGE_KEY)||'null');return value&&value.client_request_id&&value.provider?value:null;}catch(_){return null;}
  }
  function writeCapture(capture){
    window.MCCOY_ACTIVE_PROVIDER_CAPTURE=capture||null;
    if(capture)localStorage.setItem(CAPTURE_STORAGE_KEY,JSON.stringify(capture));else localStorage.removeItem(CAPTURE_STORAGE_KEY);
  }
  function newCaptureRequestId(){
    if(typeof crypto.randomUUID==='function')return crypto.randomUUID();
    const bytes=crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
    return [...bytes].map((value,index)=>([4,6,8,10].includes(index)?'-':'')+value.toString(16).padStart(2,'0')).join('');
  }
  function saleSourceContext(){
    const currentState=typeof state!=='undefined'?state:null;
    const selectedLeadId=Number(document.getElementById('fieldLeadSelect')?.value);
    const lead=currentState?.activeDoorVisit?.lead||currentState?.leads?.find(item=>item.id===selectedLeadId)||null;
    let sessionId=null;
    try{if(typeof telemetrySessionId!=='undefined'&&telemetrySessionId)sessionId=telemetrySessionId;}catch(_){}
    return{session_id:sessionId,lead_label:lead?.address||lead?.fullAddress||null,service_address:lead?.address||lead?.fullAddress||null};
  }
  async function captureCall(action,payload={}){
    if(typeof sb==='undefined')throw new Error('McCoy connection is not ready.');
    const {data,error}=await sb.functions.invoke('provider-sale-capture',{body:{action,...payload}});
    if(error||!data?.ok)throw new Error(data?.detail||data?.error||error?.message||'provider_sale_capture_failed');
    return data;
  }
  function startProviderCapture(provider,portalResult){
    const source=saleSourceContext(),info=portalInfo(provider),draft={
      client_request_id:newCaptureRequestId(),provider,sale_context:'field',
      service_address:source.service_address,lead_label:source.lead_label,session_id:source.session_id,
      seller_portal_label:info.label,portal_opened:!!portalResult?.opened,portal_open_reason:portalResult?.reason||null,
      started_at:new Date().toISOString(),status:portalResult?.opened?'dashboard_opened':'details_required'
    };
    writeCapture(draft);returnNotifiedFor=null;
    window.dispatchEvent(new CustomEvent('mccoy-provider-sale-capture-started',{detail:{capture:draft}}));
    const ready=captureCall('start',draft).then(data=>{
      const active=readCapture();
      if(active?.client_request_id!==draft.client_request_id)return data.capture;
      const saved={...active,...data.capture};writeCapture(saved);
      window.dispatchEvent(new CustomEvent('mccoy-provider-sale-capture-ready',{detail:{capture:saved}}));
      return saved;
    }).catch(error=>{
      console.error('Provider sale capture start failed',error);
      const active=readCapture();
      if(active?.client_request_id===draft.client_request_id){const failed={...active,capture_error:String(error?.message||error)};writeCapture(failed);window.dispatchEvent(new CustomEvent('mccoy-provider-sale-capture-error',{detail:{capture:failed,error}}));}
      return readCapture()||draft;
    });
    window.MCCOY_PROVIDER_CAPTURE_READY=ready;
    return draft;
  }
  async function markCaptureReturned(force=false){
    const capture=readCapture();
    if(!capture||capture.status==='recorded'||capture.status==='cancelled')return;
    if(!force&&Date.now()-Date.parse(capture.started_at||capture.created_at||0)<900)return;
    if(returnNotifiedFor===capture.client_request_id)return;
    returnNotifiedFor=capture.client_request_id;
    const returned={...capture,status:'details_required'};writeCapture(returned);
    window.dispatchEvent(new CustomEvent('mccoy-provider-sale-returned',{detail:{capture:returned}}));
    try{
      const ready=window.MCCOY_PROVIDER_CAPTURE_READY?await window.MCCOY_PROVIDER_CAPTURE_READY:returned;
      if(!ready?.id)return;
      const data=await captureCall('mark_returned',{capture_id:ready.id});
      const active=readCapture();if(active?.client_request_id===capture.client_request_id)writeCapture({...active,...data.capture});
    }catch(error){console.error('Provider sale return marker failed',error);}
  }
  window.MCCOY_CLEAR_PROVIDER_CAPTURE=captureId=>{
    const active=readCapture();
    if(!active||!captureId||active.id===captureId||active.client_request_id===captureId){writeCapture(null);window.MCCOY_PROVIDER_CAPTURE_READY=null;returnNotifiedFor=null;}
  };
  window.MCCOY_CANCEL_PROVIDER_CAPTURE=async()=>{
    const capture=readCapture();if(!capture)return;
    try{const ready=window.MCCOY_PROVIDER_CAPTURE_READY?await window.MCCOY_PROVIDER_CAPTURE_READY:capture;if(ready?.id)await captureCall('cancel',{capture_id:ready.id});}catch(error){console.error('Provider sale capture cancellation failed',error);}
    writeCapture(null);window.MCCOY_PROVIDER_CAPTURE_READY=null;returnNotifiedFor=null;
  };
  function currentProvider(){
    const selected=document.getElementById('sessionIsp')?.value;
    const saved=localStorage.getItem('mccoy_isp');
    return PROVIDERS.includes(selected)?selected:(PROVIDERS.includes(saved)?saved:'Quantum');
  }
  function isTesterPkb(){
    const email=String(window.MCCOY_ACCESS?.user?.email||'').trim().toLowerCase();
    const displayName=String(window.MCCOY_ACCESS?.access?.display_name||'').trim().toLowerCase();
    return email==='phillipkbeatty@gmail.com'&&displayName==='tester pkb';
  }
  function notify(message){
    clearTimeout(toastTimer);toast.textContent=message;toast.classList.add('show');
    toastTimer=setTimeout(()=>toast.classList.remove('show'),5200);
  }
  function portalInfo(provider){return portals[provider]||{label:`${provider} seller account`,url:''};}
  function readPortalContext(){
    try{const value=JSON.parse(localStorage.getItem(PORTAL_CONTEXT_STORAGE_KEY)||'null');return value?.provider&&value?.sessionGroup?value:null;}catch(_){return null;}
  }
  function portalAccountMessage(provider){
    const info=portalInfo(provider),account=String(info.accountContext||'').trim();
    if(!account)return '';
    const previous=readPortalContext();
    if(info.sessionGroup&&previous?.sessionGroup===info.sessionGroup&&previous.provider!==provider){
      return `Sara Plus may still be signed into the ${previous.provider} account. Sign out there and use your assigned ${account} account before placing this order. McCoy will record this capture only as ${provider}.`;
    }
    return `Sara Plus account required: ${account}. Confirm Sara Plus is signed into your assigned ${account} account. McCoy will record this capture only as ${provider}.`;
  }
  function updatePortalStatus(){
    const provider=choice.value,info=portalInfo(provider),message=portalAccountMessage(provider);
    document.getElementById('providerRouterStatus').textContent=message||(!info.url?`${provider} seller-account access is not configured yet.`:`${info.label} will open in this browser tab. Use browser Back to return to McCoy and choose Completed Sale or Abandoned.`);
  }
  function sellerAccountDestination(provider){
    const info=portalInfo(provider),raw=String(info.url||'').trim();
    if(!raw){notify(`${provider} selected. ${info.label} link is not configured yet.`);return{opened:false,reason:'not_configured'};}
    let url;try{url=new URL(raw);}catch(_){notify(`${info.label} link is invalid and was not opened.`);return{opened:false,reason:'invalid_url'};}
    if(url.protocol!=='https:'){notify(`${info.label} must use a secure HTTPS address.`);return{opened:false,reason:'insecure_url'};}
    // ASP.NET cookieless-session segments are temporary authentication tokens.
    // Never publish or reuse one from a copied Sara Plus URL. The stable route
    // creates a fresh session and preserves SubmitOrders.aspx as the return page.
    if(/(^|\.)saraplus\.com$/i.test(url.hostname))url.pathname=url.pathname.replace(/\/\(S\([^/]+\)\)/i,'');
    return{opened:true,reason:null,url:url.href};
  }
  function navigateSellerAccount(provider,destination){
    if(!destination?.opened)return destination;
    const info=portalInfo(provider);
    const accountMessage=portalAccountMessage(provider);
    if(info.sessionGroup){
      try{localStorage.setItem(PORTAL_CONTEXT_STORAGE_KEY,JSON.stringify({provider,sessionGroup:info.sessionGroup,openedAt:new Date().toISOString()}));}catch(_){}
    }
    notify(accountMessage||`${info.label} is opening in this browser tab. Its existing provider login or approved SSO session will be reused.`);
    try{window.location.assign(destination.url);return destination;}
    catch(error){console.error('Provider same-tab navigation failed',error);notify(`${info.label} could not open in this tab. Retry from McCoy.`);return{opened:false,reason:'navigation_failed'};}
  }
  function openSellerAccount(provider){
    const destination=sellerAccountDestination(provider);
    return navigateSellerAccount(provider,destination);
  }
  async function waitForCaptureReady(fallback){
    if(!window.MCCOY_PROVIDER_CAPTURE_READY)return fallback;
    return Promise.race([
      window.MCCOY_PROVIDER_CAPTURE_READY,
      new Promise(resolve=>setTimeout(()=>resolve(fallback),5000))
    ]);
  }
  function setProvider(provider){
    const select=document.getElementById('sessionIsp');
    localStorage.setItem('mccoy_isp',provider);
    if(select&&select.value!==provider){select.value=provider;select.dispatchEvent(new Event('change',{bubbles:true}));}
  }
  function showRouter(target){
    const provider=currentProvider();
    choice.value=provider;pending={target};
    document.getElementById('providerRouterTitle').textContent='Choose provider for this sale';
    document.getElementById('providerRouterDescription').textContent='Select the Internet provider whose seller account will process this sale.';
    const continueButton=document.getElementById('providerRouterContinue');
    continueButton.disabled=false;continueButton.textContent='OPEN ACCOUNT IN THIS TAB';
    choice.disabled=false;document.getElementById('providerRouterCancel').disabled=false;routing=false;
    updatePortalStatus();panel.classList.add('show');setTimeout(()=>choice.focus(),30);
  }
  function closeRouter(){if(routing)return;panel.classList.remove('show');pending=null;}

  document.getElementById('providerRouterCancel').addEventListener('click',closeRouter);
  choice.addEventListener('change',()=>{if(pending){delete pending.destination;delete pending.capture;}updatePortalStatus();});
  panel.addEventListener('click',event=>{if(event.target===panel)closeRouter();});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&panel.classList.contains('show'))closeRouter();});
  document.getElementById('providerRouterContinue').addEventListener('click',async()=>{
    if(!pending||routing)return;
    const provider=choice.value;
    if(!PROVIDERS.includes(provider)){document.getElementById('providerRouterStatus').textContent='Choose an Internet provider.';return;}
    const next=pending,continueButton=document.getElementById('providerRouterContinue');
    routing=true;continueButton.disabled=true;continueButton.textContent='SAVING CAPTURE…';
    choice.disabled=true;document.getElementById('providerRouterCancel').disabled=true;
    window.MCCOY_SALE_CONTEXT='field';
    window.MCCOY_TESTER_PKB_SALE=false;
    setProvider(provider);
    const destination=next.destination||sellerAccountDestination(provider);
    const draft=next.capture||startProviderCapture(provider,destination);
    if(destination.opened){
      document.getElementById('providerRouterStatus').textContent='Saving this provider attempt before leaving McCoy…';
      await waitForCaptureReady(draft);
      panel.classList.remove('show');pending=null;
      const navigation=navigateSellerAccount(provider,destination);
      if(!navigation.opened){
        routing=false;pending={...next,destination,capture:draft};panel.classList.add('show');
        continueButton.disabled=false;continueButton.textContent='RETRY IN THIS TAB';
        choice.disabled=false;document.getElementById('providerRouterCancel').disabled=false;
        document.getElementById('providerRouterStatus').textContent='The provider page did not open. Your McCoy capture is saved; retry without creating a duplicate.';
      }
      return;
    }
    routing=false;panel.classList.remove('show');pending=null;
    choice.disabled=false;document.getElementById('providerRouterCancel').disabled=false;
    saleGuard=true;next.target.click();
  });

  document.addEventListener('click',event=>{
    const saleButton=event.target?.closest?.('[data-disp="Sale"]');
    if(saleButton&&!window.MCCOY_SALE_CONFIRMED){
      if(saleGuard){saleGuard=false;return;}
      if(isTesterPkb()){
        event.preventDefault();event.stopImmediatePropagation();
        const provider=currentProvider();window.MCCOY_SALE_CONTEXT='field';window.MCCOY_TESTER_PKB_SALE=true;setProvider(provider);
        startProviderCapture(provider,{opened:false,reason:'tester_pkb_dashboard_bypass'});
        saleGuard=true;saleButton.click();return;
      }
      event.preventDefault();event.stopImmediatePropagation();showRouter(saleButton);
    }
  },true);

  window.MCCOY_OPEN_PROVIDER_PORTAL=openSellerAccount;
  const restored=readCapture();if(restored)writeCapture(restored);
  window.addEventListener('focus',()=>setTimeout(markCaptureReturned,120));
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')setTimeout(markCaptureReturned,120);});
  setTimeout(()=>{
    const capture=readCapture();if(!capture)return;
    window.dispatchEvent(new CustomEvent('mccoy-provider-sale-capture-restored',{detail:{capture}}));
    if(capture.status==='dashboard_opened')markCaptureReturned(true);
  },700);
})();
