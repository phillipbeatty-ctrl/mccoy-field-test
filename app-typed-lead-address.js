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
  let index=null,cached=null,lastNativeValue=select.value,refreshPending=false;
  const leads=()=>Array.isArray(state.leads)?state.leads:[];
  const label=lead=>core.leadLabels(lead)[0]||String(lead?.address||'McCoy lead');
  const setText=(node,text)=>{if(node&&node.textContent!==text)node.textContent=text;};
  function lookup(){
    const rows=leads();
    if(!index||index.leads!==rows||index.length!==rows.length){index=core.createIndex(rows);cached=null;}
    return index;
  }
  function current(){
    const table=lookup(),value=input.value,nativeValue=select.value;
    // A server refresh can reuse numeric row IDs. Retain the explicit database identity.
    const selectedId=lastContext.lead?.dbId&&nativeValue===lastNativeValue?lastContext.lead.dbId:nativeValue;
    if(cached&&cached.value===value&&cached.selectedId===selectedId&&cached.index===table)return cached.context;
    const context=core.context({value,leads:table.leads,selectedId,index:table});
    cached={value,selectedId,index:table,context};return context;
  }
  function sameContext(a,b){
    return a.kind===b.kind&&a.address===b.address&&a.valid===b.valid&&a.lead===b.lead&&a.ambiguousAssignedMatch===b.ambiguousAssignedMatch;
  }

  function setStatus(ctx){
    const arrive=document.getElementById('arriveDoorBtn');if(arrive&&!state.activeDoorVisit)setText(arrive,ctx.kind==='typed'?'START ADDRESS ACTIVITY':'ARRIVED AT DOOR');
    status.classList.toggle('field-lead-address-ad-hoc',ctx.kind==='typed');
    status.classList.toggle('field-lead-address-invalid',ctx.kind==='invalid');
    if(feedback&&feedback.revision===selectionRevision){setText(status,feedback.text);status.classList.toggle('field-lead-address-invalid',feedback.error);return;}
    if(ctx.kind==='assigned')setText(status,'This address is in the Lead Pool. Use it for door activity or SALE.');
    else if(ctx.kind==='typed')setText(status,'Ready for SALE. ADD ADDRESS saves this address to the Lead Pool.');
    else if(ctx.kind==='invalid')setText(status,'Enter a complete service address, including city, state and ZIP.');
    else setText(status,'Type a complete service address. ADD ADDRESS saves its pin; SALE can proceed without a pin.');
  }
  function dispatch(ctx,source,nativeChanged=false){
    const changed=!sameContext(ctx,lastContext);
    if(source!=='refresh'&&source!=='resume'&&(changed||source==='clear')){selectionRevision++;feedback=null;}
    lastContext=ctx;lastNativeValue=select.value;
    cached={value:input.value,selectedId:ctx.lead?.dbId||select.value,index:lookup(),context:ctx};
    setStatus(ctx);
    if(nativeChanged){syncing=true;try{select.dispatchEvent(new Event('change',{bubbles:true}));}finally{syncing=false;}}
    if(changed)window.dispatchEvent(new CustomEvent('mccoy-lead-address-changed',{detail:{context:{...ctx},source}}));
  }
  function syncFromInput(source='input'){
    const ctx=current(),before=select.value;
    if(ctx.kind==='assigned')setNativeLead(ctx.lead);
    else select.value='';
    dispatch(ctx,source,before!==select.value);return ctx;
  }
  function syncFromSelect(source='select'){
    if(syncing)return lastContext;
    const table=lookup(),lead=core.selectedLead(select.value,table.leads,table);
    if(!lead){if(!input.value)dispatch(core.context({value:''}),source);return lastContext;}
    const address=label(lead);if(input.value!==address)input.value=address;const ctx={kind:'assigned',address,lead,valid:true};dispatch(ctx,source);return ctx;
  }
  function refresh(){
    index=null;cached=null;return syncFromInput('refresh');
  }
  function scheduleRefresh(){
    index=null;cached=null;
    if(refreshPending)return;
    refreshPending=true;setTimeout(()=>{refreshPending=false;syncFromInput('refresh');},0);
  }
  function setNativeLead(lead){
    if(![...select.options].some(option=>option.value===String(lead.id))){
      const option=document.createElement('option');option.value=String(lead.id);option.textContent=label(lead);select.add(option);
    }
    select.value=String(lead.id);
  }
  function setTyped(address,source='restore'){
    const value=core.cleanAddress(address);if(input.value!==value)input.value=value;return syncFromInput(source);
  }
  function setLead(lead,source='assigned'){
    if(!lead)return null;const before=select.value;input.value=label(lead);setNativeLead(lead);const ctx={kind:'assigned',address:label(lead),lead,valid:true};dispatch(ctx,source,before!==select.value);return ctx;
  }
  function clearValue(source='clear'){
    const before=select.value;input.value='';select.value='';dispatch(core.context({value:''}),source,!!before);input.focus();
  }

  input.addEventListener('input',()=>syncFromInput('user_input'));
  input.addEventListener('change',()=>syncFromInput('user_change'));
  select.addEventListener('change',()=>syncFromSelect('lead_selection'));
  for(const eventName of ['mccoy-real-leads-progress','mccoy-real-leads-loaded','mccoy-lead-address-corrected','mccoy-door-visit-corrected'])window.addEventListener(eventName,scheduleRefresh);
  window.addEventListener('mccoy-door-visit-started',()=>{input.disabled=false;});
  window.addEventListener('mccoy-door-visit-completed',()=>{input.disabled=false;scheduleRefresh();});
  window.MCCOY_LEAD_ADDRESS={current,revision:()=>selectionRevision,refresh,invalidate:scheduleRefresh,setTyped,setLead,clear:clearValue,focus:()=>input.focus(),setDisabled(value){if(input.disabled!==!!value)input.disabled=!!value;},setMessage(text,error=false){feedback={text,error,revision:selectionRevision};setStatus(lastContext);}};
  scheduleRefresh();
})();
