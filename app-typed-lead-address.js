// One Sales Hub address line shared by door activity, pin creation and sales.
(()=>{
  if(window.MCCOY_LEAD_ADDRESS)return;
  const core=window.MCCOY_LEAD_ADDRESS_CORE,select=document.getElementById('fieldLeadSelect');
  if(!core||!select)return;

  const root=document.createElement('div');root.className='field-lead-combobox';
  root.innerHTML='<label for="fieldLeadAddressInput">Service address</label><div class="field-lead-combobox-row"><input id="fieldLeadAddressInput" type="text" autocomplete="off" maxlength="240" placeholder="Street, unit, city, ST ZIP" aria-describedby="fieldLeadAddressStatus"><button id="addFieldAddressBtn" type="button" class="primary" disabled>ADD ADDRESS</button></div><div id="fieldLeadAddressStatus" class="muted small" role="status" aria-live="polite">Type a complete service address. ADD ADDRESS saves its pin; SALE can proceed without a pin.</div>';
  // Retain the hidden selection bridge for existing map/door handlers, with no dropdown UI.
  select.insertAdjacentElement('beforebegin',root);select.hidden=true;select.classList.add('field-lead-select-native');select.setAttribute('aria-hidden','true');select.tabIndex=-1;
  const input=document.getElementById('fieldLeadAddressInput'),status=document.getElementById('fieldLeadAddressStatus');
  let syncing=false,selectionRevision=0,feedback=null,lastContext={kind:'empty',address:'',lead:null,valid:false};
  const leads=()=>Array.isArray(state.leads)?state.leads:[];
  const label=lead=>core.leadLabels(lead)[0]||String(lead?.address||'McCoy lead');

  function setStatus(ctx){
    const arrive=document.getElementById('arriveDoorBtn');if(arrive&&!state.activeDoorVisit)arrive.textContent=ctx.kind==='typed'?'START ADDRESS ACTIVITY':'ARRIVED AT DOOR';
    status.classList.toggle('field-lead-address-ad-hoc',ctx.kind==='typed');
    status.classList.toggle('field-lead-address-invalid',ctx.kind==='invalid');
    if(feedback&&feedback.revision===selectionRevision){status.textContent=feedback.text;status.classList.toggle('field-lead-address-invalid',feedback.error);return;}
    if(ctx.kind==='assigned')status.textContent='This address is in the Lead Pool. Use it for door activity or SALE.';
    else if(ctx.kind==='typed')status.textContent='Ready for SALE. ADD ADDRESS saves this address to the Lead Pool.';
    else if(ctx.kind==='invalid')status.textContent='Enter a complete service address, including city, state and ZIP.';
    else status.textContent='Type a complete service address. ADD ADDRESS saves its pin; SALE can proceed without a pin.';
  }
  function dispatch(ctx,source){
    const sameBlur=source==='user_change'&&ctx.address===lastContext.address&&ctx.kind===lastContext.kind&&ctx.lead?.dbId===lastContext.lead?.dbId;
    if(source!=='refresh'&&source!=='resume'&&!sameBlur){selectionRevision++;feedback=null;}
    lastContext=ctx;setStatus(ctx);
    window.dispatchEvent(new CustomEvent('mccoy-lead-address-changed',{detail:{context:{...ctx},source}}));
  }
  function syncFromInput(source='input'){
    // Numeric display IDs can be reused when the server returns a new row order.
    const previous=lastContext.lead;
    const restored=source==='refresh'&&previous?leads().find(lead=>previous.dbId?String(lead.dbId)===String(previous.dbId):String(lead.id)===String(previous.id)):null;
    const ctx=core.context({value:input.value,leads:leads(),selectedId:source==='refresh'?restored?.id:select.value});
    syncing=true;
    if(ctx.kind==='assigned')setNativeLead(ctx.lead);
    else select.value='';
    select.dispatchEvent(new Event('change',{bubbles:true}));syncing=false;
    dispatch(ctx,source);return ctx;
  }
  function syncFromSelect(source='select'){
    if(syncing)return lastContext;
    const lead=core.selectedLead(select.value,leads());
    if(!lead){if(!input.value)dispatch(core.context({value:'',leads:leads()}),source);return lastContext;}
    input.value=label(lead);const ctx={kind:'assigned',address:label(lead),lead,valid:true};dispatch(ctx,source);return ctx;
  }
  function refresh(){
    syncFromInput('refresh');
  }
  function setNativeLead(lead){
    if(![...select.options].some(option=>option.value===String(lead.id))){
      const option=document.createElement('option');option.value=String(lead.id);option.textContent=label(lead);select.add(option);
    }
    select.value=String(lead.id);
  }
  function setTyped(address,source='restore'){
    input.value=core.cleanAddress(address);syncing=true;select.value='';select.dispatchEvent(new Event('change',{bubbles:true}));syncing=false;return syncFromInput(source);
  }
  function setLead(lead,source='assigned'){
    if(!lead)return null;input.value=label(lead);syncing=true;setNativeLead(lead);select.dispatchEvent(new Event('change',{bubbles:true}));syncing=false;const ctx={kind:'assigned',address:label(lead),lead,valid:true};dispatch(ctx,source);return ctx;
  }
  function clearValue(source='clear'){
    input.value='';syncing=true;select.value='';select.dispatchEvent(new Event('change',{bubbles:true}));syncing=false;dispatch(core.context({value:'',leads:leads()}),source);input.focus();
  }

  input.addEventListener('input',()=>syncFromInput('user_input'));
  input.addEventListener('change',()=>syncFromInput('user_change'));
  select.addEventListener('change',()=>syncFromSelect('lead_selection'));
  for(const eventName of ['mccoy-real-leads-progress','mccoy-real-leads-loaded','mccoy-door-visit-corrected'])window.addEventListener(eventName,()=>setTimeout(refresh,0));
  window.addEventListener('mccoy-door-visit-started',()=>{input.disabled=false;});
  window.addEventListener('mccoy-door-visit-completed',()=>{input.disabled=false;setTimeout(refresh,0);});
  window.MCCOY_LEAD_ADDRESS={current:()=>core.context({value:input.value,leads:leads(),selectedId:select.value}),revision:()=>selectionRevision,refresh,setTyped,setLead,clear:clearValue,focus:()=>input.focus(),setDisabled(value){input.disabled=!!value;},setMessage(text,error=false){feedback={text,error,revision:selectionRevision};setStatus(lastContext);}};
  [0,120,350,800,1500].forEach(delay=>setTimeout(refresh,delay));
})();
