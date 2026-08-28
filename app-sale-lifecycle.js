// One field lifecycle: SAVE DISPOSITION owns the visit; SALE opens the provider dashboard flow.
(function(){
  if(window.MCCOY_SALE_LIFECYCLE)return;
  window.MCCOY_SALE_LIFECYCLE=true;

  const byId=id=>document.getElementById(id);

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

  window.addEventListener('mccoy-access-ready',scheduleSaleButton);
  scheduleSaleButton();
})();
