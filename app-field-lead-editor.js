// Shared lead customer information and user-created field addresses.
(()=>{
  if(window.MCCOY_FIELD_LEAD_EDITOR)return;
  window.MCCOY_FIELD_LEAD_EDITOR=true;

  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[char]));
  const byId=id=>document.getElementById(id);
  let activeLeadId=null;
  let detailRequest=0;
  let savingContact=false;
  let creatingLead=false;

  function fieldRole(){
    const access=window.MCCOY_ACCESS?.access;
    return Boolean(access?.active&&['admin','manager','trainer','rep','tester'].includes(String(access.role||'')));
  }
  function leadByAnyId(id){
    const raw=String(id??'');
    return (typeof state!=='undefined'?state.realLeads||[]:[]).find(lead=>String(lead.id)===raw||String(lead.dbId)===raw)||null;
  }
  async function call(action,body={}){
    const {data,error}=await sb.functions.invoke('lead-field-actions',{body:{action,...body}});
    let failure=data;
    if(error?.context?.clone){try{failure=await error.context.clone().json();}catch(_){}}
    if(error||!data?.ok){
      const messages={
        address_not_found:'The address could not be placed on the map. Check its details, or process the sale without a pin.',
        google_maps_key_not_configured:'Map lookup is unavailable. You can still process a sale for this address.',
        active_field_role_required:'Sign in with an active field account to add a pin.',
        complete_valid_address_required:'Enter street, city, a two-letter state, and a valid ZIP.'
      };
      const fallback=action==='create_lead'?'The pin could not be saved. Your address is retained; retry or process the sale without a pin.':'Customer information could not be saved. Check your connection and retry.';
      throw new Error(messages[failure?.error]||fallback);
    }
    return data;
  }
  function inputValue(id){return String(byId(id)?.value||'').trim();}
  function setContactMessage(text,error=false){
    const message=byId('leadContactEditorMsg');
    if(message){message.textContent=text;message.style.color=error?'#991b1b':'#166534';}
  }
  function setCreateMessage(text,error=false){
    const message=byId('fieldLeadCreateMsg');
    if(message){message.textContent=text;message.style.color=error?'#991b1b':'#166534';}
  }

  function ensureContactShell(){
    if(!fieldRole())return null;
    const detail=byId('mapLeadDetail');
    if(!detail)return null;
    let panel=byId('leadContactEditor');
    if(panel&&panel.closest('#mapLeadDetail')===detail)return panel;
    panel=document.createElement('section');
    panel.id='leadContactEditor';
    panel.style.cssText='margin:12px 0;padding:11px;border:1px solid #dbe4f0;border-radius:10px;background:#f8fafc';
    panel.innerHTML='<strong>Customer information</strong><div class="muted small" style="margin-top:4px">All active McCoy field users may add or update this shared lead information. Every save is audited.</div><div id="leadContactEditorBody" class="muted small" style="margin-top:8px">Select a lead to load customer information.</div>';
    const disposition=detail.querySelector('.map-pin-disposition');
    if(disposition)detail.insertBefore(panel,disposition);else detail.appendChild(panel);
    return panel;
  }

  function renderContactForm(lead,data){
    const panel=ensureContactShell();
    const body=panel?.querySelector('#leadContactEditorBody');
    if(!body||!lead)return;
    const customer=data?.lead?.customer_name??lead.customerName??'';
    const phone=data?.lead?.phone??lead.phone??'';
    const notes=data?.lead?.notes??lead.notes??'';
    body.className='';
    body.innerHTML=`
      <div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(150px,.65fr);gap:8px;margin-top:8px">
        <label class="small">Customer name<input id="leadCustomerNameInput" maxlength="160" value="${esc(customer)}" style="width:100%;padding:8px;margin-top:3px"></label>
        <label class="small">Customer phone number<input id="leadCustomerPhoneInput" maxlength="40" inputmode="tel" value="${esc(phone)}" style="width:100%;padding:8px;margin-top:3px"></label>
      </div>
      <label class="small" style="display:block;margin-top:8px">Notes<textarea id="leadNotesInput" maxlength="5000" rows="4" style="width:100%;padding:8px;margin-top:3px;resize:vertical">${esc(notes)}</textarea></label>
      <button id="saveLeadContactBtn" type="button" class="primary" style="margin-top:8px">SAVE CUSTOMER INFO</button>
      <div id="leadContactEditorMsg" class="muted small" role="status" aria-live="polite" style="margin-top:6px">Customer name, number, and notes are shared with the whole organization.</div>`;
    byId('saveLeadContactBtn')?.addEventListener('click',()=>saveContact(lead));
  }

  async function loadContact(lead){
    if(!lead||!fieldRole())return;
    activeLeadId=lead.dbId||lead.id;
    const request=++detailRequest;
    const panel=ensureContactShell();
    const body=panel?.querySelector('#leadContactEditorBody');
    if(body){body.className='muted small';body.textContent='Loading customer information…';}
    try{
      const data=await call('get_lead',{lead_id:activeLeadId});
      if(request!==detailRequest||String(activeLeadId)!==String(lead.dbId||lead.id))return;
      lead.customerName=data.lead?.customer_name||'';
      lead.phone=data.lead?.phone||'';
      lead.notes=data.lead?.notes||'';
      renderContactForm(lead,data);
    }catch(error){
      if(request!==detailRequest)return;
      if(body){body.className='muted small';body.textContent='Customer information could not be loaded.';}
      console.error('Lead contact load failed',error);
    }
  }

  async function saveContact(lead){
    if(savingContact||!lead)return;
    const button=byId('saveLeadContactBtn');
    savingContact=true;if(button){button.disabled=true;button.textContent='SAVING…';}
    setContactMessage('Saving customer information…');
    try{
      const data=await call('update_contact',{
        lead_id:lead.dbId||lead.id,
        customer_name:inputValue('leadCustomerNameInput'),
        phone:inputValue('leadCustomerPhoneInput'),
        notes:inputValue('leadNotesInput')
      });
      lead.customerName=data.lead?.customer_name||'';
      lead.phone=data.lead?.phone||'';
      lead.notes=data.lead?.notes||'';
      setContactMessage('Customer name, number, and notes saved.');
      window.dispatchEvent(new CustomEvent('mccoy-lead-contact-updated',{detail:{leadId:lead.dbId||lead.id}}));
    }catch(error){
      console.error('Lead contact save failed',error);
      setContactMessage(String(error?.message||'Customer information could not be saved.').replace(/_/g,' '),true);
    }finally{savingContact=false;if(button){button.disabled=false;button.textContent='SAVE CUSTOMER INFO';}}
  }

  function ensureCreatePanel(){
    if(!fieldRole())return null;
    const controls=byId('leadGeoControls');
    if(!controls||byId('fieldLeadCreatePanel'))return byId('fieldLeadCreatePanel');
    const panel=document.createElement('section');
    panel.id='fieldLeadCreatePanel';
    panel.style.cssText='margin-top:10px;padding-top:10px;border-top:1px solid #dbe4f0';
    panel.innerHTML=`
      <button id="toggleFieldLeadCreateBtn" type="button" class="assign-btn">ADD PIN / ADDRESS</button>
      <div id="fieldLeadCreateForm" hidden style="margin-top:9px;padding:10px;border:1px solid #dbe4f0;border-radius:10px;background:#f8fafc">
        <strong id="fieldLeadCreateTitle">Add a pin or process a sale</strong>
        <div class="muted small" style="margin:3px 0 8px">Enter the service address. Add a pin to the Lead Pool, or process the sale directly.</div>
        <label class="small">Street address<input id="newLeadAddress1" maxlength="180" autocomplete="street-address" style="width:100%;padding:8px;margin-top:3px"></label>
        <label class="small" style="display:block;margin-top:7px">Unit / apartment / suite<input id="newLeadAddress2" maxlength="80" style="width:100%;padding:8px;margin-top:3px"></label>
        <div style="display:grid;grid-template-columns:minmax(120px,1fr) 64px 92px;gap:7px;margin-top:7px">
          <label class="small">City<input id="newLeadCity" maxlength="100" style="width:100%;padding:8px;margin-top:3px"></label>
          <label class="small">State<input id="newLeadState" maxlength="2" autocapitalize="characters" style="width:100%;padding:8px;margin-top:3px;text-transform:uppercase"></label>
          <label class="small">ZIP<input id="newLeadZip" maxlength="10" inputmode="numeric" style="width:100%;padding:8px;margin-top:3px"></label>
        </div>
        <div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(150px,.65fr);gap:7px;margin-top:7px">
          <label class="small">Customer name<input id="newLeadCustomerName" maxlength="160" style="width:100%;padding:8px;margin-top:3px"></label>
          <label class="small">Customer phone number<input id="newLeadPhone" maxlength="40" inputmode="tel" style="width:100%;padding:8px;margin-top:3px"></label>
        </div>
        <label class="small" style="display:block;margin-top:7px">Notes<textarea id="newLeadNotes" maxlength="5000" rows="3" style="width:100%;padding:8px;margin-top:3px;resize:vertical"></textarea></label>
        <button id="createFieldLeadBtn" type="button" class="primary" style="margin-top:8px">ADD TO LEAD POOL</button>
        <button id="saleFromFieldAddressBtn" type="button" class="success" style="margin-top:8px">PROCESS SALE FOR THIS ADDRESS</button>
        <div id="fieldLeadCreateMsg" class="muted small" role="status" aria-live="polite" style="margin-top:6px">A matching existing address will be enriched instead of duplicated.</div>
      </div>`;
    controls.appendChild(panel);
    byId('toggleFieldLeadCreateBtn')?.addEventListener('click',openAddressEntry);
    byId('createFieldLeadBtn')?.addEventListener('click',createLead);
    byId('saleFromFieldAddressBtn')?.addEventListener('click',()=>{
      const address=addressFields();if(!address)return;
      const serviceAddress=[[address.address1,address.address2].filter(Boolean).join(' '),address.city,`${address.state} ${address.zip}`].join(', ');
      try{
        if(!window.MCCOY_START_EXPLICIT_SALE)throw new Error('Sale controls are still loading. Please retry.');
        window.MCCOY_START_EXPLICIT_SALE({sale_context:'field',service_address:serviceAddress,source:'address_entry_sale',selection_source:'typed_address',lead_id:null,source_door_visit_id:null,preserve_active_visit:true});
        byId('fieldAddressDialog')?.close();
      }catch(error){setCreateMessage(error.message,true);}
    });
    return panel;
  }

  function openAddressEntry(){
    if(!fieldRole())return;
    ensureCreatePanel();
    const form=byId('fieldLeadCreateForm');if(!form)return;
    let dialog=byId('fieldAddressDialog');
    if(!dialog){
      dialog=document.createElement('dialog');dialog.id='fieldAddressDialog';dialog.setAttribute('aria-labelledby','fieldLeadCreateTitle');
      const close=document.createElement('button');close.type='button';close.className='assign-btn';close.textContent='CLOSE';close.addEventListener('click',()=>dialog.close());dialog.append(close);
      document.body.append(dialog);
    }
    form.hidden=false;dialog.append(form);if(!dialog.open)dialog.showModal();
    byId('newLeadAddress1')?.focus();
  }

  function ensureAddressShortcuts(){
    ensureSalesHubAddressAction();
    if(!fieldRole())return;
    for(const [host,id,label] of [
      [byId('leadMapActionMenu'),'leadMapAddAddressAction','ADD PIN / ADDRESS']
    ]){
      if(!host||byId(id))continue;
      const button=document.createElement('button');button.id=id;button.type='button';button.className='assign-btn';button.textContent=label;
      if(id==='leadMapAddAddressAction')button.setAttribute('role','menuitem');
      button.addEventListener('click',event=>{event.stopPropagation();openAddressEntry();});host.append(button);
    }
  }

  function ensureSalesHubAddressAction(){
    byId('salesHubAddPinBtn')?.remove();
    const button=byId('addFieldAddressBtn');if(!button)return;
    button.hidden=!fieldRole();button.disabled=creatingLead||!fieldRole();
    if(button.dataset.mccoyAddressBound==='1')return;
    button.dataset.mccoyAddressBound='1';
    button.addEventListener('click',addSalesHubAddress);
    byId('fieldLeadAddressInput')?.addEventListener('keydown',event=>{
      if(event.key!=='Enter'||event.isComposing)return;
      event.preventDefault();addSalesHubAddress();
    });
  }

  async function addSalesHubAddress(){
    if(creatingLead||!fieldRole())return;
    const entry=window.MCCOY_LEAD_ADDRESS,context=entry?.current?.();
    const address=window.MCCOY_LEAD_ADDRESS_CORE?.fieldAddress(context?.address);
    if(!address){
      entry?.setMessage?.('Use street, city, ST ZIP. Include a unit when needed. Example: 123 Main St, Apt 2, Portland, OR 97201.',true);
      entry?.focus?.();return;
    }
    return createLead({suppliedAddress:address,source:'sales_hub',revision:entry.revision()});
  }

  function addressFields(){
    const fields={address1:inputValue('newLeadAddress1'),address2:inputValue('newLeadAddress2'),city:inputValue('newLeadCity'),state:inputValue('newLeadState').toUpperCase(),zip:inputValue('newLeadZip')};
    if(!fields.address1||!fields.city||!/^[A-Z]{2}$/.test(fields.state)||!/^\d{5}(?:-\d{4})?$/.test(fields.zip)){
      setCreateMessage('Street, city, two-letter state, and a valid ZIP are required.',true);return null;
    }
    return fields;
  }

  function showSavedPin(lead){
    const leadId=lead.dbId||lead.id;
    if(window.MCCOY_MAP_VIEWPORT_LOCK?.blocksSelection?.(leadId))return false;
    // These are display filters; server-side assignment and organization scope remain intact.
    if(window.MCCOY_LEAD_MATCHES_FILTER&&!window.MCCOY_LEAD_MATCHES_FILTER(lead)){
      for(const id of ['teamFilter','leadOwnerFilter','leadSearch']){const filter=byId(id);if(filter)filter.value='';}
      if(typeof renderLeads==='function')renderLeads();
    }
    window.MCCOY_RENDER_LEAD_MAP?.(false);
    window.MCCOY_SELECT_MAP_LEAD?.(leadId);
    window.dispatchEvent(new CustomEvent('mccoy-map-lead-selected',{detail:{leadId,source:'field_created_address'}}));
    const lat=lead.lat,lng=lead.lng,map=window.MCCOY_LEAD_MAP?.map;
    if(lat!=null&&lng!=null&&Number.isFinite(Number(lat))&&Number.isFinite(Number(lng))&&Math.abs(Number(lat))<=90&&Math.abs(Number(lng))<=180&&map){
      map.setView([Number(lat),Number(lng)],Math.max(Number(map.getZoom?.()||0),18),{animate:false});
    }
    return true;
  }

  async function createLead({suppliedAddress=null,source='lead_pool',revision=null}={}){
    if(creatingLead)return;
    const address=suppliedAddress||addressFields();if(!address)return;
    const salesHub=source==='sales_hub';
    const accessKey=()=>`${window.MCCOY_ACCESS?.user?.id||''}:${window.MCCOY_ACCESS?.access?.organization_id||''}`;
    const requestAccess=accessKey();
    const isCurrent=()=>requestAccess===accessKey()&&(!salesHub||revision===window.MCCOY_LEAD_ADDRESS?.revision?.());
    const message=(text,error=false)=>{if(!isCurrent())return;if(salesHub)window.MCCOY_LEAD_ADDRESS?.setMessage?.(text,error);else setCreateMessage(text,error);};
    const button=byId(salesHub?'addFieldAddressBtn':'createFieldLeadBtn');creatingLead=true;if(button){button.disabled=true;button.textContent='ADDING…';}
    if(!salesHub)for(const input of byId('fieldLeadCreateForm')?.querySelectorAll('input,textarea,button')||[])input.disabled=true;
    message('Checking the Lead Pool and locating the address…');
    let saved=false;
    try{
      // Blank optional fields must not erase an existing matched lead's contact.
      const contact={};
      if(!salesHub)for(const [key,id] of [['customer_name','newLeadCustomerName'],['phone','newLeadPhone'],['notes','newLeadNotes']])if(inputValue(id))contact[key]=inputValue(id);
      const data=await call('create_lead',{...address,...contact});
      saved=true;
      if(!isCurrent())return;
      const savedMessage=data.created?'Address added to the Lead Pool.':'An existing lead matched this address.';
      message(savedMessage+' Loading its pin…');
      const leadId=data.lead?.id;
      await window.loadMcCoyLeads?.();
      if(!isCurrent())return;
      // The loader resolves [] after exhausting retries; it does not reject.
      if(window.MCCOY_LAST_LEAD_LOAD?.error)throw new Error('lead_pool_refresh_failed');
      if(leadId){
        // An already-running load may have started before the insert. Retry once after it finishes.
        if(!leadByAnyId(leadId))await window.loadMcCoyLeads?.();
        if(!isCurrent())return;
        if(window.MCCOY_LAST_LEAD_LOAD?.error)throw new Error('lead_pool_refresh_failed');
        const lead=leadByAnyId(leadId);
        const shown=lead&&showSavedPin(lead);
        message(savedMessage+(shown?' Its pin is selected on the map. Ready for SALE.':' Its pin is not visible in the current Lead Pool. You can still process the sale.'));
      }else{
        message(savedMessage+' Ready for SALE.');
      }
      // Keep the address available for PROCESS SALE without requiring re-entry.
    }catch(error){
      console.error('Field lead creation failed',error);
      message(saved?'The address was saved, but its pin could not be refreshed. Your address is retained; you can still process the sale.':String(error?.message||'Address could not be added.').replace(/_/g,' '),true);
    }finally{creatingLead=false;if(!salesHub)for(const input of byId('fieldLeadCreateForm')?.querySelectorAll('input,textarea,button')||[])input.disabled=false;if(button){button.disabled=salesHub&&!fieldRole();button.textContent=salesHub?'ADD ADDRESS':'ADD TO LEAD POOL';}}
  }

  function selectedLeadFromEvent(event){
    const id=event?.detail?.leadId;
    if(!id||String(id).startsWith('__mccoy_'))return null;
    return leadByAnyId(id);
  }
  function refreshSelected(){
    const lead=leadByAnyId(activeLeadId);
    if(lead)setTimeout(()=>loadContact(lead),0);
  }

  window.addEventListener('mccoy-map-lead-selected',event=>{
    const lead=selectedLeadFromEvent(event);if(!lead)return;
    activeLeadId=lead.dbId||lead.id;
    setTimeout(()=>loadContact(lead),20);
  });
  window.addEventListener('mccoy-real-leads-loaded',()=>setTimeout(()=>{ensureCreatePanel();refreshSelected();},150));
  document.addEventListener('click',event=>{
    const pick=event.target.closest?.('.map-pick');
    if(pick?.dataset?.id){const lead=leadByAnyId(pick.dataset.id);if(lead){activeLeadId=lead.dbId||lead.id;setTimeout(()=>loadContact(lead),80);}}
  },true);
  const observer=new MutationObserver(()=>{
    ensureCreatePanel();ensureAddressShortcuts();
    if(activeLeadId&&!byId('leadContactEditor'))refreshSelected();
  });
  const start=()=>{
    ensureCreatePanel();ensureAddressShortcuts();
    const mapPanel=byId('leadMapPanel');if(mapPanel)observer.observe(mapPanel,{childList:true,subtree:true});
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
  for(const name of ['mccoy-access-ready','mccoy-sales-hub-layout-ready'])window.addEventListener(name,()=>{ensureCreatePanel();ensureAddressShortcuts();});
  [0,250,800,1600,3000].forEach(delay=>setTimeout(()=>{ensureCreatePanel();ensureAddressShortcuts();refreshSelected();},delay));
})();
