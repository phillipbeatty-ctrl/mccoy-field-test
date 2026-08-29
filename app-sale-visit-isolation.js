// Prevent an unlinked phone or Lead Pool sale from completing an unrelated physical-door activity.
(function(){
  if(window.MCCOY_SALE_VISIT_ISOLATION)return;
  window.MCCOY_SALE_VISIT_ISOLATION=true;

  let latestCapture=null;
  let pendingCompletedCapture=null;
  let wrapped=false;
  const captureEvents=['mccoy-provider-sale-capture-started','mccoy-provider-sale-capture-ready','mccoy-provider-sale-returned','mccoy-provider-sale-capture-restored'];
  for(const eventName of captureEvents)window.addEventListener(eventName,event=>{if(event.detail?.capture)latestCapture=event.detail.capture;});

  function leadById(id){const raw=String(id||'');return(state.realLeads||[]).find(lead=>String(lead.dbId||lead.id)===raw)||null;}
  function updateMatchedPin(capture,eventDetail){
    const id=eventDetail?.leadId||eventDetail?.lead_id||capture?.lead_id;if(!id)return;
    const lead=leadById(id);if(!lead)return;
    lead.disposition='Sale Made';lead.lastActivityType='Visit';lead.visitResult='Contacted';lead.stage='Sale Made';lead.pinColor='#22c55e';lead.pinColorSource='stage';lead.pinDisposition='Sale Made';
    window.MCCOY_RENDER_LEAD_MAP?.(false);window.MCCOY_APPLY_DISPOSITION_COLORS?.();
  }
  function statusMessage(text){const status=document.getElementById('doorVisitStatus');if(status){status.textContent=text;status.style.color='';}}
  function installWrapper(){
    if(wrapped||typeof window.MCCOY_COMPLETE_DOOR_VISIT!=='function')return false;
    const original=window.MCCOY_COMPLETE_DOOR_VISIT;
    window.MCCOY_COMPLETE_DOOR_VISIT=async function(disposition,options={}){
      if(disposition==='sale'&&window.MCCOY_SALE_CONFIRMED){
        const capture=pendingCompletedCapture||latestCapture;
        const activeId=state.activeDoorVisit?.serverVisitId||null;
        const linkedId=capture?.source_door_visit_id||null;
        const explicitlyLinked=Boolean(linkedId&&activeId&&String(linkedId)===String(activeId));
        if(!explicitlyLinked){
          pendingCompletedCapture=null;
          statusMessage(state.activeDoorVisit?'Phone/Lead Pool sale completed. The unrelated physical-door activity remains active.':'Sale completed without changing the physical-door workflow.');
          window.dispatchEvent(new CustomEvent('mccoy-unlinked-sale-preserved-active-visit',{detail:{saleId:options?.saleId||null,activeVisitId:activeId,sourceDoorVisitId:linkedId,saleContext:capture?.sale_context||null}}));
          return true;
        }
      }
      try{return await original.apply(this,arguments);}finally{if(disposition==='sale')pendingCompletedCapture=null;}
    };
    wrapped=true;return true;
  }

  window.addEventListener('mccoy-sale-saved',event=>{
    pendingCompletedCapture=latestCapture?{...latestCapture}:null;
    updateMatchedPin(pendingCompletedCapture,event.detail||{});
    setTimeout(()=>window.loadMcCoyLeads?.(),200);
    installWrapper();
  });
  [0,100,350,900,1800].forEach(delay=>setTimeout(installWrapper,delay));
})();
