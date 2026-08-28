// Return users to McCoy after the external provider dashboard closes or yields focus.
// Uses explicit window/page lifecycle signals and a bounded close poll; no DOM observer.
(function(){
  if(window.MCCOY_PROVIDER_RETURN_FOCUS)return;
  window.MCCOY_PROVIDER_RETURN_FOCUS=true;

  const CAPTURE_KEY='mccoy_active_provider_sale_capture_v1';
  const RETURN_KEY='mccoy_provider_returned_capture_v1';
  const byId=id=>document.getElementById(id);
  const state={capture:null,providerWindow:null,expectOpenUntil:0,leftAppAt:0,returning:false,poll:null};

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

  function alreadyReturned(capture){
    try{return sessionStorage.getItem(RETURN_KEY)===capture?.id;}catch(_){return false;}
  }

  function markReturnedLocally(capture){
    try{sessionStorage.setItem(RETURN_KEY,capture.id);}catch(_){}
  }

  async function returnToMcCoy(reason){
    if(state.returning)return;
    const capture=readCapture();
    if(!capture?.id)return;
    if(state.providerWindow&&!state.providerWindow.closed&&reason!=='page_show')return;

    state.returning=true;
    try{
      let current=capture;
      if(capture.status==='details_required'||alreadyReturned(capture)){
        showSalesHub(capture,reason);
        return;
      }
      if(!window.sb?.functions?.invoke)throw new Error('provider_return_connection_not_ready');
      const {data,error}=await sb.functions.invoke('provider-sale-capture',{body:{action:'mark_returned',capture_id:capture.id}});
      if(error||!data?.ok)throw new Error(data?.detail||data?.error||error?.message||'provider_return_failed');
      current={...capture,...(data.capture||{}),status:data.capture?.status||'details_required'};
      saveCapture(current);
      markReturnedLocally(current);
      showSalesHub(current,reason);
    }catch(error){
      console.error('Provider dashboard return failed',error);
      // Reconcile rather than leaving Provider Outcome disconnected. The server remains authoritative.
      try{
        const recovered=await window.MCCOY_VALIDATE_ACTIVE_PROVIDER_CAPTURE?.();
        if(recovered?.id){saveCapture(recovered);showSalesHub(recovered,'reconciled_return');}
      }catch(reconcileError){console.error('Provider return reconciliation failed',reconcileError);}
    }finally{
      state.returning=false;
      state.providerWindow=null;
      state.leftAppAt=0;
      stopPolling();
    }
  }

  function stopPolling(){if(state.poll){clearInterval(state.poll);state.poll=null;}}
  function startPolling(){
    stopPolling();
    let checks=0;
    state.poll=setInterval(()=>{
      checks++;
      if(state.providerWindow?.closed){returnToMcCoy('provider_window_closed');return;}
      if(checks>=240)stopPolling(); // Two minutes; focus/pageshow still remain active afterward.
    },500);
  }

  function beginProviderExit(capture){
    if(capture?.id)saveCapture(capture);
    state.expectOpenUntil=Date.now()+12000;
    state.leftAppAt=Date.now();
    startPolling();
  }

  // Preserve the provider Window reference when the existing router uses window.open.
  const nativeOpen=window.open?.bind(window);
  if(nativeOpen){
    window.open=function(...args){
      const opened=nativeOpen(...args);
      if(Date.now()<=state.expectOpenUntil&&opened){state.providerWindow=opened;startPolling();}
      return opened;
    };
  }

  document.addEventListener('click',event=>{
    if(event.target?.closest?.('[data-disp="Sale"],#processSaleBtn')){
      state.expectOpenUntil=Date.now()+12000;
      state.leftAppAt=Date.now();
    }
  },true);

  for(const name of ['mccoy-provider-sale-capture-started','mccoy-provider-sale-capture-ready']){
    window.addEventListener(name,event=>beginProviderExit(event.detail?.capture));
  }
  window.addEventListener('mccoy-provider-sale-capture-restored',event=>{if(event.detail?.capture?.id)saveCapture(event.detail.capture);});
  window.addEventListener('mccoy-provider-sale-abandoned',()=>{state.capture=null;state.providerWindow=null;stopPolling();});
  window.addEventListener('mccoy-sale-saved',()=>{state.capture=null;state.providerWindow=null;stopPolling();});

  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='hidden'&&readCapture()?.id)state.leftAppAt=Date.now();
    if(document.visibilityState==='visible'&&state.leftAppAt){
      setTimeout(()=>returnToMcCoy('app_visible_again'),80);
    }
  });
  window.addEventListener('focus',()=>{
    if(state.leftAppAt&&readCapture()?.id)setTimeout(()=>returnToMcCoy('app_focused_again'),80);
  });
  window.addEventListener('pageshow',event=>{
    if((event.persisted||state.leftAppAt)&&readCapture()?.id)setTimeout(()=>returnToMcCoy('page_show'),80);
  });
})();
