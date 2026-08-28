// Reliably return users to McCoy after a provider popup/tab closes.
// A return is processed only after the app actually loses visibility/focus or a tracked child closes.
(function(){
  if(window.MCCOY_PROVIDER_RETURN_FOCUS_V2)return;
  window.MCCOY_PROVIDER_RETURN_FOCUS_V2=true;

  const CAPTURE_KEY='mccoy_active_provider_sale_capture_v1';
  const RETURN_KEY='mccoy_provider_returned_capture_v2';
  const byId=id=>document.getElementById(id);
  const state={capture:null,providerWindow:null,expectOpenUntil:0,leftAppAt:0,leftAppObserved:false,returning:false,poll:null};

  function readCapture(){
    if(state.capture?.id)return state.capture;
    if(window.MCCOY_ACTIVE_PROVIDER_CAPTURE?.id)return window.MCCOY_ACTIVE_PROVIDER_CAPTURE;
    try{const value=JSON.parse(localStorage.getItem(CAPTURE_KEY)||'null');return value?.id?value:null;}catch(_){return null;}
  }

  function saveCapture(capture){
    if(!capture?.id)return;
    state.capture=capture;
    try{window.MCCOY_ACTIVE_PROVIDER_CAPTURE=capture;}catch(_){}
    try{localStorage.setItem(CAPTURE_KEY,JSON.stringify(capture));}catch(_){}
  }

  function resetReturnObservation(){
    state.providerWindow=null;
    state.leftAppAt=0;
    state.leftAppObserved=false;
    state.expectOpenUntil=0;
    stopPolling();
  }

  function showSalesHub(capture,reason){
    const nav=document.querySelector('.nav-btn[data-view="field"]');
    if(nav&&!nav.classList.contains('active'))nav.click();
    window.dispatchEvent(new CustomEvent('mccoy-provider-sale-returned',{detail:{capture,returnReason:reason}}));
    setTimeout(()=>{
      const modal=byId('saleModal');
      if(modal){modal.classList.add('show');modal.scrollIntoView?.({behavior:'smooth',block:'nearest'});}
      byId('completeSaleBtn')?.focus?.({preventScroll:true});
      try{window.focus();}catch(_){}
    },80);
  }

  function returnedMarker(capture){
    try{return sessionStorage.getItem(RETURN_KEY)===capture?.id;}catch(_){return false;}
  }

  function setReturnedMarker(capture){
    try{sessionStorage.setItem(RETURN_KEY,capture.id);}catch(_){}
  }

  async function returnToMcCoy(reason,{childClosed=false}={}){
    if(state.returning)return;
    const capture=readCapture();
    if(!capture?.id)return;
    if(!childClosed&&!state.leftAppObserved)return;
    if(state.providerWindow&&!state.providerWindow.closed&&!childClosed)return;

    state.returning=true;
    try{
      let current=capture;
      if(capture.status!=='details_required'&&!returnedMarker(capture)){
        if(!window.sb?.functions?.invoke)throw new Error('provider_return_connection_not_ready');
        const {data,error}=await sb.functions.invoke('provider-sale-capture',{body:{action:'mark_returned',capture_id:capture.id}});
        if(error||!data?.ok)throw new Error(data?.detail||data?.error||error?.message||'provider_return_failed');
        current={...capture,...(data.capture||{}),status:data.capture?.status||'details_required'};
        saveCapture(current);
        setReturnedMarker(current);
      }
      showSalesHub(current,reason);
      resetReturnObservation();
    }catch(error){
      console.error('Provider dashboard return failed',error);
      try{
        const recovered=await window.MCCOY_VALIDATE_ACTIVE_PROVIDER_CAPTURE?.();
        if(recovered?.id){saveCapture(recovered);showSalesHub(recovered,'reconciled_return');resetReturnObservation();}
      }catch(reconcileError){console.error('Provider return reconciliation failed',reconcileError);}
    }finally{state.returning=false;}
  }

  function stopPolling(){if(state.poll){clearInterval(state.poll);state.poll=null;}}
  function startPolling(){
    stopPolling();
    let checks=0;
    state.poll=setInterval(()=>{
      checks++;
      if(state.providerWindow?.closed){state.leftAppObserved=true;state.leftAppAt=Date.now();returnToMcCoy('provider_window_closed',{childClosed:true});return;}
      if(checks>=240)stopPolling();
    },500);
  }

  function expectProviderOpen(capture){
    if(capture?.id)saveCapture(capture);
    state.expectOpenUntil=Date.now()+12000;
  }

  const nativeOpen=window.open?.bind(window);
  if(nativeOpen){
    window.open=function(...args){
      const opened=nativeOpen(...args);
      if(Date.now()<=state.expectOpenUntil&&opened){state.providerWindow=opened;startPolling();}
      return opened;
    };
  }

  document.addEventListener('click',event=>{
    if(event.target?.closest?.('[data-disp="Sale"],#processSaleBtn'))expectProviderOpen(readCapture());
  },true);

  for(const name of ['mccoy-provider-sale-capture-started','mccoy-provider-sale-capture-ready']){
    window.addEventListener(name,event=>expectProviderOpen(event.detail?.capture));
  }
  window.addEventListener('mccoy-provider-sale-capture-restored',event=>{if(event.detail?.capture?.id)saveCapture(event.detail.capture);});
  window.addEventListener('mccoy-provider-sale-abandoned',()=>{state.capture=null;resetReturnObservation();});
  window.addEventListener('mccoy-sale-saved',()=>{state.capture=null;resetReturnObservation();});

  function observeExit(){
    if(!readCapture()?.id)return;
    state.leftAppObserved=true;
    state.leftAppAt=Date.now();
  }

  window.addEventListener('blur',()=>{
    if(Date.now()<=state.expectOpenUntil||state.providerWindow)setTimeout(()=>{if(!document.hasFocus())observeExit();},50);
  });
  window.addEventListener('pagehide',observeExit);
  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='hidden')observeExit();
    else if(document.visibilityState==='visible'&&state.leftAppObserved)setTimeout(()=>returnToMcCoy('app_visible_again'),80);
  });
  window.addEventListener('focus',()=>{
    if(state.leftAppObserved)setTimeout(()=>returnToMcCoy('app_focused_again'),80);
  });
  window.addEventListener('pageshow',event=>{
    if((event.persisted||state.leftAppObserved)&&readCapture()?.id)setTimeout(()=>returnToMcCoy('page_show'),80);
  });
})();
