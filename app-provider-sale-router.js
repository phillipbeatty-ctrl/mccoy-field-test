// Select the sale provider and open its seller portal only when SALE is chosen.
// Provider passwords are never stored or autofilled by McCoy. Portal sessions
// are reused only when the provider's own browser session or SSO allows it.
(function(){
  if(window.MCCOY_PROVIDER_SALE_ROUTER)return;
  window.MCCOY_PROVIDER_SALE_ROUTER=true;

  const PROVIDERS=['Quantum','Brightspeed','AT&T','T-Mobile / T-Fiber','Kinetic','Fidium','Ascend Fiber','Lightcurve','Ripple Fiber','Starlink','DIRECTV','Vivint','Other'];
  const OUT_OF_AREA='OUT OF AREA';
  const CAPTURE_STORAGE_KEY='mccoy_active_provider_sale_capture_v1';
  const defaults={
    Brightspeed:{label:'BASS',url:''},
    Quantum:{label:'ASAP',url:'',openInNewTab:true},
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
  panel.innerHTML=`<div class="provider-router-card"><h2 id="providerRouterTitle">Choose Internet provider</h2><p id="providerRouterDescription" class="muted small">Select the seller account for this sale.</p><div class="provider-router-fields"><label>Sale provider or phone-sale mode<select id="providerRouterChoice"></select></label><label id="providerRouterActualRow" hidden>Internet provider for this phone sale<select id="providerRouterActual"></select></label></div><div id="providerRouterStatus" class="muted small" aria-live="polite"></div><div class="provider-router-actions"><button id="providerRouterContinue" type="button" class="primary">CONTINUE</button><button id="providerRouterCancel" type="button" class="assign-btn">Cancel</button></div></div>`;
  document.body.appendChild(panel);
  const toast=document.createElement('div');toast.id='providerRouteToast';toast.setAttribute('role','status');toast.setAttribute('aria-live','polite');document.body.appendChild(toast);

  const choice=document.getElementById('providerRouterChoice');
  const actual=document.getElementById('providerRouterActual');
  for(const provider of [...PROVIDERS,OUT_OF_AREA])choice.add(new Option(provider,provider));
  for(const provider of PROVIDERS)actual.add(new Option(provider,provider));

  let pending=null,toastTimer=null;
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
  function startProviderCapture(provider,outOfArea,portalResult){
    const source=saleSourceContext(),info=portalInfo(provider),draft={
      client_request_id:newCaptureRequestId(),provider,sale_context:outOfArea?'out_of_area_phone':'field',
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
  async function markCaptureReturned(){
    const capture=readCapture();
    if(!capture||capture.status==='recorded'||capture.status==='cancelled')return;
    if(Date.now()-Date.parse(capture.started_at||capture.created_at||0)<900)return;
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
  function notify(message){
    clearTimeout(toastTimer);toast.textContent=message;toast.classList.add('show');
    toastTimer=setTimeout(()=>toast.classList.remove('show'),5200);
  }
  function portalInfo(provider){return portals[provider]||{label:`${provider} seller account`,url:''};}
  function openSellerAccount(provider){
    const info=portalInfo(provider),raw=String(info.url||'').trim();
    if(!raw){notify(`${provider} selected. ${info.label} link is not configured yet.`);return{opened:false,reason:'not_configured'};}
    let url;try{url=new URL(raw);}catch(_){notify(`${info.label} link is invalid and was not opened.`);return{opened:false,reason:'invalid_url'};}
    if(url.protocol!=='https:'){notify(`${info.label} must use a secure HTTPS address.`);return{opened:false,reason:'insecure_url'};}
    // ASAP's legacy login works best as a full browser tab. A fresh tab also
    // prevents embedded/popup keyboard handling from swallowing characters
    // such as @ on mobile and international keyboard layouts.
    const target=info.openInNewTab?'_blank':`mccoy_${provider.toLowerCase().replace(/[^a-z0-9]+/g,'_')}_seller`;
    const sellerWindow=window.open(url.href,target);
    if(!sellerWindow){notify(`Allow pop-ups for McCoy to open ${info.label}.`);return{opened:false,reason:'popup_blocked'};}
    try{sellerWindow.opener=null;sellerWindow.focus();}catch(_){}
    notify(`${info.label} opened${info.openInNewTab?' in a full browser tab':''}. Its existing provider login or approved SSO session will be reused.`);
    return{opened:true,reason:null};
  }
  function setProvider(provider){
    const select=document.getElementById('sessionIsp');
    localStorage.setItem('mccoy_isp',provider);
    if(select&&select.value!==provider){select.value=provider;select.dispatchEvent(new Event('change',{bubbles:true}));}
  }
  function syncOutOfArea(){
    const out=choice.value===OUT_OF_AREA;
    document.getElementById('providerRouterActualRow').hidden=!out;
    document.getElementById('providerRouterStatus').textContent=out?'This sale will be recorded as an OUT OF AREA phone sale.':'';
  }
  function showRouter(target){
    const provider=currentProvider(),outOption=[...choice.options].find(option=>option.value===OUT_OF_AREA);
    if(outOption)outOption.hidden=false;
    choice.value=provider;actual.value=provider;syncOutOfArea();pending={target};
    document.getElementById('providerRouterTitle').textContent='Choose provider for this sale';
    document.getElementById('providerRouterDescription').textContent='Select the provider, or choose OUT OF AREA for a phone sale.';
    document.getElementById('providerRouterContinue').textContent='OPEN ACCOUNT & PROCESS SALE';
    panel.classList.add('show');setTimeout(()=>choice.focus(),30);
  }
  function closeRouter(){panel.classList.remove('show');pending=null;}

  choice.addEventListener('change',syncOutOfArea);
  document.getElementById('providerRouterCancel').addEventListener('click',closeRouter);
  panel.addEventListener('click',event=>{if(event.target===panel)closeRouter();});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&panel.classList.contains('show'))closeRouter();});
  document.getElementById('providerRouterContinue').addEventListener('click',()=>{
    if(!pending)return;
    const outOfArea=choice.value===OUT_OF_AREA;
    const provider=outOfArea?actual.value:choice.value;
    if(!PROVIDERS.includes(provider)){document.getElementById('providerRouterStatus').textContent='Choose an Internet provider.';return;}
    const next=pending;panel.classList.remove('show');pending=null;
    window.MCCOY_SALE_CONTEXT=outOfArea?'out_of_area_phone':'field';
    setProvider(provider);const portalResult=openSellerAccount(provider);startProviderCapture(provider,outOfArea,portalResult);
    saleGuard=true;next.target.click();
  });

  document.addEventListener('click',event=>{
    const saleButton=event.target?.closest?.('[data-disp="Sale"]');
    if(saleButton&&!window.MCCOY_SALE_CONFIRMED){
      if(saleGuard){saleGuard=false;return;}
      event.preventDefault();event.stopImmediatePropagation();showRouter(saleButton);
    }
  },true);

  window.MCCOY_OPEN_PROVIDER_PORTAL=openSellerAccount;
  const restored=readCapture();if(restored)writeCapture(restored);
  window.addEventListener('focus',()=>setTimeout(markCaptureReturned,120));
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')setTimeout(markCaptureReturned,120);});
  setTimeout(()=>{const capture=readCapture();if(capture)window.dispatchEvent(new CustomEvent('mccoy-provider-sale-capture-restored',{detail:{capture}}));},700);
})();
