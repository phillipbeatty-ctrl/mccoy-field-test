// One field lifecycle: SAVE owns the visit; SALE opens the provider dashboard flow.
// COMPLETE SALE submits directly through app-sales.js. The server remains the
// authority for capture ownership, status, idempotency, sale creation, and ranking.
(function(){
  if(window.MCCOY_SALE_LIFECYCLE)return;
  window.MCCOY_SALE_LIFECYCLE=true;

  const byId=id=>document.getElementById(id);
  const CAPTURE_STORAGE_KEY='mccoy_active_provider_sale_capture_v1';
  let reconciliationPromise=null,reconciliationOwner=null;
  const actorKey=()=>window.MCCOY_ACCESS?.access?.active&&window.MCCOY_ACCESS?.user?.id?`${window.MCCOY_ACCESS.user.id}:${window.MCCOY_ACCESS.access.organization_id||''}`:'';

  function client(){
    return window.MCCOY_GET_SUPABASE_CLIENT?.({functions:true})||null;
  }

  function ensureSaleButton(){
    let button=byId('processSaleBtn');
    const actions=document.querySelector('.spotio-disposition-actions');
    if(!button&&actions){
      button=document.createElement('button');
      button.id='processSaleBtn';
      actions.appendChild(button);
    }
    if(!button)return null;
    button.type='button';
    button.hidden=false;
    button.removeAttribute('hidden');
    button.dataset.disp='Sale';
    button.classList.add('success');
    button.textContent='SALE';
    button.title='Start a new ISP dashboard sale and secure its provider capture.';
    button.setAttribute('aria-label','Start ISP dashboard sale');
    return button;
  }

  function scheduleSaleButton(){
    [0,80,220,500,900,1500].forEach(delay=>setTimeout(ensureSaleButton,delay));
  }

  function readLocalCapture(){
    try{
      const stored=JSON.parse(localStorage.getItem(CAPTURE_STORAGE_KEY)||'null');
      const current=window.MCCOY_ACTIVE_PROVIDER_CAPTURE||stored;
      return current&&current.client_request_id&&current.provider?current:null;
    }catch(_){return window.MCCOY_ACTIVE_PROVIDER_CAPTURE||null;}
  }

  function writeLocalCapture(capture){
    window.MCCOY_ACTIVE_PROVIDER_CAPTURE=capture||null;
    if(capture)localStorage.setItem(CAPTURE_STORAGE_KEY,JSON.stringify(capture));
    else localStorage.removeItem(CAPTURE_STORAGE_KEY);
  }

  function clearLocalCapture(reason='stale_provider_capture'){
    const previous=readLocalCapture();
    writeLocalCapture(null);
    window.MCCOY_PROVIDER_CAPTURE_READY=null;
    const banner=byId('providerCaptureBanner');
    if(banner){banner.classList.remove('show');banner.textContent='';}
    window.dispatchEvent(new CustomEvent('mccoy-provider-sale-capture-invalidated',{detail:{reason,captureId:previous?.id||null,clientRequestId:previous?.client_request_id||null}}));
  }

  async function awaitCaptureReady(fallback){
    if(!window.MCCOY_PROVIDER_CAPTURE_READY)return fallback;
    try{
      const ready=await Promise.race([
        window.MCCOY_PROVIDER_CAPTURE_READY,
        new Promise(resolve=>setTimeout(()=>resolve(fallback),6000))
      ]);
      return ready?.actor_key===actorKey()?ready:fallback;
    }catch(_){return fallback;}
  }

  function sameCapture(left,right){
    if(!left||!right)return false;
    return !!((left.id&&right.id&&left.id===right.id)||(left.client_request_id&&right.client_request_id&&left.client_request_id===right.client_request_id));
  }

  async function reconcileProviderCapture({announce=true}={}){
    const owner=actorKey();if(!owner)return null;
    if(reconciliationPromise&&reconciliationOwner===owner)return reconciliationPromise;
    const supabase=client();
    if(!supabase)return null;

    reconciliationOwner=owner;
    const task=(async()=>{
      const local=await awaitCaptureReady(readLocalCapture());
      if(owner!==actorKey())return null;
      const {data,error}=await supabase.functions.invoke('provider-sale-capture',{body:{action:'list',open_only:true,mine_only:true}});
      if(error||!data?.ok)throw new Error(data?.detail||data?.error||error?.message||'provider_capture_validation_failed');
      if(owner!==actorKey())return null;
      const current=readLocalCapture();
      if((local||current)&&!sameCapture(local,current))return current?.actor_key===owner?current:null;
      const captures=Array.isArray(data.captures)?data.captures:[];
      const candidate=local?.actor_key&&local.actor_key!==owner?null:local;
      const match=candidate?captures.find(capture=>sameCapture(capture,candidate)):null;
      const selected=match||(!candidate?captures[0]:null);

      if(selected){
        const restored={...(match?candidate:null),...selected,actor_key:owner,client_request_id:selected.client_request_id||local?.client_request_id||selected.id,recovered_from_server:!match};
        writeLocalCapture(restored);
        if(announce)window.dispatchEvent(new CustomEvent('mccoy-provider-sale-capture-restored',{detail:{capture:restored,validated:true}}));
        return restored;
      }

      if(local)clearLocalCapture('capture_not_owned_or_no_longer_open');
      return null;
    })();

    reconciliationPromise=task;
    try{return await task;}
    finally{if(reconciliationPromise===task)reconciliationPromise=null;}
  }

  // PHOTO uses this to confirm that the capture remains open. COMPLETE SALE does
  // not use a browser preflight: app-sales.js submits once and sale-submit checks
  // the authenticated owner and status atomically on the server.
  window.MCCOY_VALIDATE_ACTIVE_PROVIDER_CAPTURE=()=>reconcileProviderCapture({announce:true});

  function selectedPinDisposition(){
    const core=window.MCCOY_DOOR_WORKFLOW_CORE;
    return{
      activityType:core?.activityType(byId('leadActivityType')?.value),
      visitResult:core?.visitResult(byId('leadVisitResult')?.value),
      stage:core?.stage(byId('leadStage')?.value)
    };
  }

  function openProviderDashboardSale(){
    const button=ensureSaleButton();
    if(!button){
      alert('The SALE control is not ready. Refresh Field Coach and retry.');
      return;
    }
    button.click();
  }

  async function saveDisposition(){
    const selection=selectedPinDisposition();
    if(!selection.activityType){alert('Choose an Activity Type.');return;}
    if(!selection.visitResult){alert('Choose a Visit Result before saving.');byId('leadVisitResult')?.focus();return;}
    const saved=await window.MCCOY_COMPLETE_DOOR_VISIT?.('spotio',{automatic:false,...selection});
    if(saved&&selection.stage==='Sale Made'){
      window.dispatchEvent(new CustomEvent('mccoy-sale-made-disposition-saved',{detail:{selection}}));
      openProviderDashboardSale();
    }
  }

  document.addEventListener('click',event=>{
    const button=event.target?.closest?.('#savePinDispositionBtn');
    if(!button)return;
    event.preventDefault();
    event.stopImmediatePropagation();
    saveDisposition();
  },true);

  function scheduleCaptureReconciliation(){
    [80,350,900,1800].forEach(delay=>setTimeout(()=>reconcileProviderCapture({announce:true}).catch(error=>console.error('Provider capture reconciliation failed',error)),delay));
  }

  window.addEventListener('mccoy-access-ready',()=>{scheduleSaleButton();scheduleCaptureReconciliation();});
  scheduleSaleButton();
  scheduleCaptureReconciliation();
})();
