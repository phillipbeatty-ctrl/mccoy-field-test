// Search assigned leads or explicitly work an ad-hoc typed address without
// changing lead ownership or inserting it into the assigned lead pool.
(()=>{
  if(window.MCCOY_LEAD_ADDRESS)return;
  const core=window.MCCOY_LEAD_ADDRESS_CORE,select=document.getElementById('fieldLeadSelect');
  if(!core||!select)return;

  const root=document.createElement('div');root.className='field-lead-combobox';
  root.innerHTML='<label for="fieldLeadAddressInput">Lead or service address</label><div class="field-lead-combobox-row"><input id="fieldLeadAddressInput" list="fieldLeadAddressOptions" autocomplete="street-address" maxlength="240" placeholder="Search assigned leads or type any address" aria-describedby="fieldLeadAddressStatus"><button id="clearFieldLeadAddress" type="button" class="assign-btn" aria-label="Clear lead address">CLEAR</button></div><datalist id="fieldLeadAddressOptions"></datalist><div id="fieldLeadAddressStatus" class="muted small" role="status" aria-live="polite">Choose an assigned lead or type an ad-hoc address.</div>';
  select.insertAdjacentElement('beforebegin',root);select.classList.add('field-lead-select-native');select.setAttribute('aria-hidden','true');select.tabIndex=-1;
  const input=document.getElementById('fieldLeadAddressInput'),list=document.getElementById('fieldLeadAddressOptions'),status=document.getElementById('fieldLeadAddressStatus'),clear=document.getElementById('clearFieldLeadAddress');
  let syncing=false,lastContext={kind:'empty',address:'',lead:null,valid:false};
  const leads=()=>Array.isArray(state.leads)?state.leads:[];
  const label=lead=>core.leadLabels(lead)[0]||String(lead?.address||'Assigned lead');

  function setStatus(ctx){
    status.classList.toggle('field-lead-address-ad-hoc',ctx.kind==='typed');
    status.classList.toggle('field-lead-address-invalid',ctx.kind==='invalid');
    const arrive=document.getElementById('arriveDoorBtn');if(arrive&&!state.activeDoorVisit)arrive.textContent=ctx.kind==='typed'?'START ADDRESS ACTIVITY':'ARRIVED AT DOOR';
    if(ctx.kind==='assigned')status.textContent='Assigned lead selected — normal proximity and ownership rules apply.';
    else if(ctx.kind==='typed')status.textContent='Ad-hoc address — not added to your assigned lead list. Inside/outside-area disposition is allowed and GPS is retained for audit.';
    else if(ctx.kind==='invalid')status.textContent='Enter at least 5 characters for an ad-hoc address.';
    else status.textContent='Choose an assigned lead or type an ad-hoc address.';
  }
  function dispatch(ctx,source){
    lastContext=ctx;setStatus(ctx);
    window.dispatchEvent(new CustomEvent('mccoy-lead-address-changed',{detail:{context:{...ctx},source}}));
  }
  function syncFromInput(source='input'){
    const ctx=core.context({value:input.value,leads:leads(),selectedId:select.value});
    syncing=true;
    if(ctx.kind==='assigned')select.value=String(ctx.lead.id);
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
    const options=leads().slice(0,750).map(lead=>{const option=document.createElement('option');option.value=label(lead);option.label=lead.team?`${lead.address||label(lead)} — ${lead.team}`:label(lead);return option;});
    list.replaceChildren(...options);
    if(select.value)syncFromSelect('refresh');else if(input.value)syncFromInput('refresh');
  }
  function setTyped(address,source='restore'){
    input.value=core.cleanAddress(address);syncing=true;select.value='';select.dispatchEvent(new Event('change',{bubbles:true}));syncing=false;return syncFromInput(source);
  }
  function setLead(lead,source='assigned'){
    if(!lead)return null;input.value=label(lead);syncing=true;select.value=String(lead.id);select.dispatchEvent(new Event('change',{bubbles:true}));syncing=false;const ctx={kind:'assigned',address:label(lead),lead,valid:true};dispatch(ctx,source);return ctx;
  }
  function clearValue(source='clear'){
    input.value='';syncing=true;select.value='';select.dispatchEvent(new Event('change',{bubbles:true}));syncing=false;dispatch(core.context({value:'',leads:leads()}),source);input.focus();
  }

  input.addEventListener('input',()=>syncFromInput('user_input'));
  input.addEventListener('change',()=>syncFromInput('user_change'));
  select.addEventListener('change',()=>syncFromSelect('assigned_selection'));
  clear.addEventListener('click',()=>clearValue());
  const observer=new MutationObserver(()=>refresh());observer.observe(select,{childList:true,subtree:true});
  for(const eventName of ['mccoy-real-leads-progress','mccoy-real-leads-loaded'])window.addEventListener(eventName,refresh);
  window.addEventListener('mccoy-door-visit-started',()=>{input.disabled=true;clear.disabled=true;});
  window.addEventListener('mccoy-door-visit-completed',()=>{input.disabled=false;clear.disabled=false;});
  window.addEventListener('mccoy-door-visit-corrected',()=>{input.disabled=false;clear.disabled=false;});
  window.MCCOY_LEAD_ADDRESS={current:()=>core.context({value:input.value,leads:leads(),selectedId:select.value}),refresh,setTyped,setLead,clear:clearValue,focus:()=>input.focus(),setDisabled(value){input.disabled=!!value;clear.disabled=!!value;}};
  refresh();if(select.value)syncFromSelect('initial');
})();
