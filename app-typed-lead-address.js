// Search McCoy leads or explicitly work an ad-hoc typed address without
// changing lead ownership or inserting it into the McCoy lead pool.
(()=>{
  if(window.MCCOY_LEAD_ADDRESS)return;
  const core=window.MCCOY_LEAD_ADDRESS_CORE,select=document.getElementById('fieldLeadSelect');
  if(!core||!select)return;

  const root=document.createElement('div');root.className='field-lead-combobox';
  root.innerHTML='<label for="fieldLeadAddressInput">Lead or service address</label><div class="field-lead-combobox-row"><input id="fieldLeadAddressInput" list="fieldLeadAddressOptions" autocomplete="street-address" maxlength="240" placeholder="Street, unit, city, state and ZIP" aria-describedby="fieldLeadAddressStatus"><button id="clearFieldLeadAddress" type="button" class="assign-btn" aria-label="Clear lead address">CLEAR</button></div><datalist id="fieldLeadAddressOptions"></datalist><div id="fieldLeadAddressStatus" class="muted small" role="status" aria-live="polite">Type a complete service address or select a lead, then press SALE. A map pin is optional.</div>';
  select.insertAdjacentElement('beforebegin',root);select.classList.add('field-lead-select-native');select.setAttribute('aria-hidden','true');select.tabIndex=-1;
  const input=document.getElementById('fieldLeadAddressInput'),list=document.getElementById('fieldLeadAddressOptions'),status=document.getElementById('fieldLeadAddressStatus'),clear=document.getElementById('clearFieldLeadAddress');
  let syncing=false,selectionRevision=0,lastContext={kind:'empty',address:'',lead:null,valid:false};
  const leads=()=>Array.isArray(state.leads)?state.leads:[];
  const label=lead=>core.leadLabels(lead)[0]||String(lead?.address||'McCoy lead');

  function setStatus(ctx){
    status.classList.toggle('field-lead-address-ad-hoc',ctx.kind==='typed');
    status.classList.toggle('field-lead-address-invalid',ctx.kind==='invalid');
    const arrive=document.getElementById('arriveDoorBtn');if(arrive&&!state.activeDoorVisit)arrive.textContent=ctx.kind==='typed'?'START ADDRESS ACTIVITY':'ARRIVED AT DOOR';
    if(ctx.kind==='assigned')status.textContent='McCoy lead selected — proximity and ownership are retained for the visit record.';
    else if(ctx.kind==='typed')status.textContent='Ready for SALE at this address. A pin is optional; this address is not added to the McCoy lead pool.';
    else if(ctx.kind==='invalid')status.textContent='Enter at least 5 characters for an ad-hoc address.';
    else status.textContent='Type a complete service address or select a lead, then press SALE. A map pin is optional.';
  }
  function dispatch(ctx,source){
    if(source!=='refresh'&&source!=='resume')selectionRevision++;
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
    // Keep the datalist bounded for mobile-browser performance.
    const options=leads().slice(0,750).map(lead=>{const option=document.createElement('option');option.value=label(lead);option.label=lead.team?`${lead.address||label(lead)} — ${lead.team}`:label(lead);return option;});
    list.replaceChildren(...options);
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
  clear.addEventListener('click',()=>clearValue());
  for(const eventName of ['mccoy-real-leads-progress','mccoy-real-leads-loaded','mccoy-door-visit-corrected'])window.addEventListener(eventName,()=>setTimeout(refresh,0));
  window.addEventListener('mccoy-door-visit-started',()=>{input.disabled=false;clear.disabled=false;});
  window.addEventListener('mccoy-door-visit-completed',()=>{input.disabled=false;clear.disabled=false;setTimeout(refresh,0);});
  window.MCCOY_LEAD_ADDRESS={current:()=>core.context({value:input.value,leads:leads(),selectedId:select.value}),revision:()=>selectionRevision,refresh,setTyped,setLead,clear:clearValue,focus:()=>input.focus(),setDisabled(value){input.disabled=!!value;clear.disabled=!!value;}};
  [0,120,350,800,1500].forEach(delay=>setTimeout(refresh,delay));
})();
