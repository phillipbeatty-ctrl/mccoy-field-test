// One field lifecycle: SAVE DISPOSITION owns the visit; Sale Made then opens Provider Outcome.
(function(){
  const byId=id=>document.getElementById(id);

  function removeDuplicateProcessSale(){
    const button=byId('processSaleBtn');
    if(button)button.remove();
  }

  function selectedPinDisposition(){
    const core=window.MCCOY_DOOR_WORKFLOW_CORE;
    return{
      activityType:core?.activityType(byId('leadActivityType')?.value),
      visitResult:core?.visitResult(byId('leadVisitResult')?.value),
      stage:core?.stage(byId('leadStage')?.value)
    };
  }

  function openProviderOutcome(){
    // Reuse the existing provider-outcome controller without exposing another visible PROCESS SALE button.
    const trigger=document.createElement('button');
    trigger.type='button';trigger.dataset.disp='Sale';trigger.hidden=true;
    document.body.appendChild(trigger);trigger.click();trigger.remove();
  }

  async function saveDisposition(){
    const selection=selectedPinDisposition();
    if(!selection.activityType){alert('Choose an Activity Type.');return;}
    if(!selection.visitResult){alert('Choose a Visit Result before saving.');byId('leadVisitResult')?.focus();return;}
    const saved=await window.MCCOY_COMPLETE_DOOR_VISIT?.('spotio',{automatic:false,...selection});
    if(saved&&selection.stage==='Sale Made'){
      window.dispatchEvent(new CustomEvent('mccoy-sale-made-disposition-saved',{detail:{selection}}));
      openProviderOutcome();
    }
  }

  document.addEventListener('click',event=>{
    const button=event.target?.closest?.('#savePinDispositionBtn');
    if(!button)return;
    event.preventDefault();event.stopImmediatePropagation();
    saveDisposition();
  },true);

  removeDuplicateProcessSale();
  const observer=new MutationObserver(removeDuplicateProcessSale);
  observer.observe(document.documentElement,{childList:true,subtree:true});
  setTimeout(()=>observer.disconnect(),15000);
})();
