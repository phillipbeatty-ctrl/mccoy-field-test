(()=>{
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let activeLeadId=null;
  let correcting=false;
  const correctionIds=['editLeadAddress1','editLeadAddress2','editLeadCity','editLeadState','editLeadZip'];
  const activityTypes=['Visit','Call','Appointment','Text','Qualify','Investigate & Estimate','Make a Proposal','Get Feedback'];
  const visitResults=['No Answer','Contacted','Follow-Up'];
  const stages=['Prospecting','Hot Lead','Contacted','Follow Up','Migrator','Existing Customer','SMB','Sale Made','No Sale','Admin Hold'];

  function removeLegacyAssign(){
    const old=document.getElementById('mapAssignBtn');
    if(old)old.remove();
    const assign=document.getElementById('bulkAssignMapBtn');
    if(assign)assign.textContent='ASSIGN SELECTED LEADS';
  }

  function ensureDetailPanel(){
    const list=document.getElementById('mapLeadList');
    if(!list)return null;
    let detail=document.getElementById('mapLeadDetail');
    if(detail)return detail;
    detail=document.createElement('div');
    detail.id='mapLeadDetail';
    detail.innerHTML='<div class="muted small">Select a lead from the list or map to view details.</div>';
    list.insertAdjacentElement('afterend',detail);
    return detail;
  }

  function leadByAnyId(id){
    const raw=String(id??'');
    return (state.realLeads||[]).find(l=>String(l.id)===raw||String(l.dbId)===raw)||null;
  }

  function optionList(values,placeholder){return `${placeholder?`<option value="">${esc(placeholder)}</option>`:''}${values.map(value=>`<option value="${esc(value)}">${esc(value)}</option>`).join('')}`;}
  function mapDispositionMessage(text,error=false){const el=document.getElementById('mapPinDispositionMsg');if(el){el.textContent=text;el.style.color=error?'#991b1b':'#166534';}}
  function selectLeadForWorkflow(lead){
    if(window.MCCOY_LEAD_ADDRESS?.setLead)return window.MCCOY_LEAD_ADDRESS.setLead(lead,'map_pin');
    const select=document.getElementById('fieldLeadSelect');if(select){select.value=String(lead.id);select.dispatchEvent(new Event('change',{bubbles:true}));}
    return{kind:'assigned',lead,address:lead.fullAddress||lead.address,valid:true};
  }
  function wireDisposition(lead){
    const start=document.getElementById('mapPinStartBtn'),save=document.getElementById('mapPinSaveBtn'),sale=document.getElementById('mapPinSaleBtn'),remove=document.getElementById('mapDeleteLeadBtn');
    if(!start||!save||!sale||!remove)return;
    const active=()=>state.activeDoorVisit||null,sameActive=()=>String(active()?.lead?.dbId||'')===String(lead.dbId||'');
    function sync(){const visit=active();start.disabled=!!visit;save.disabled=!sameActive();start.textContent=sameActive()?'PIN ACTIVITY ACTIVE':visit?'FINISH ACTIVE ACTIVITY FIRST':'START PIN ACTIVITY';}
    start.addEventListener('click',async()=>{
      if(!state.session){mapDispositionMessage('Start a field session before recording a map-pin activity.',true);document.getElementById('startKnockingBtn')?.focus();return;}
      if(active()&&!sameActive()){mapDispositionMessage('Finish or correct the active address before starting this pin.',true);return;}
      selectLeadForWorkflow(lead);mapDispositionMessage('Starting activity; door location will be recorded for coaching when available…');
      const ok=await window.MCCOY_START_DOOR_VISIT?.({automatic:false});
      mapDispositionMessage(ok?'Pin activity started. Choose the result and save when complete.':'Pin activity was not started. Review the Sales Hub door status.',!ok);sync();
    });
    save.addEventListener('click',async()=>{
      if(!sameActive()){mapDispositionMessage('Start this pin activity before saving its disposition.',true);sync();return;}
      const activityType=document.getElementById('mapLeadActivityType')?.value,visitResult=document.getElementById('mapLeadVisitResult')?.value,stage=document.getElementById('mapLeadStage')?.value||null;
      if(!activityType||!visitResult){mapDispositionMessage('Choose both Activity Type and Visit Result.',true);return;}
      if(stage==='Sale Made'){sale.click();return;}
      mapDispositionMessage('Saving audited pin disposition…');
      const ok=await window.MCCOY_COMPLETE_DOOR_VISIT?.('spotio',{automatic:false,activityType,visitResult,stage});
      if(ok){mapDispositionMessage(`Saved ${stage||visitResult} for ${lead.address}.`);renderDetail(lead);window.MCCOY_RENDER_LEAD_MAP?.(false);window.MCCOY_APPLY_DISPOSITION_COLORS?.();}
      else mapDispositionMessage('Disposition was not saved. Review the Sales Hub door status and retry.',true);
    });
    sale.addEventListener('click',()=>{selectLeadForWorkflow(lead);document.getElementById('processSaleBtn')?.click();});
    remove.addEventListener('click',async()=>{remove.disabled=true;const removed=await window.MCCOY_DELETE_LEAD?.(lead);if(removed){activeLeadId=null;window.dispatchEvent(new CustomEvent('mccoy-map-lead-deleted',{detail:{leadId:lead.dbId||lead.id}}));const detail=ensureDetailPanel();if(detail)detail.innerHTML='<div class="muted small">Lead deleted. Select another lead to view details.</div>';}else remove.disabled=false;});
    sync();
    const detail=ensureDetailPanel();if(detail)detail._refreshWorkflowLead=updated=>{lead=updated;sync();};
  }

  function renderDetail(lead){
    const detail=ensureDetailPanel();
    if(!detail||!lead)return;
    activeLeadId=lead.dbId||lead.id;
    const address=[lead.address,lead.city,lead.stateCode,lead.zip].filter(Boolean).join(', ');
    const summary=`
      <div class="lead-detail-head"><strong>${esc(lead.address||'Lead')}</strong><span class="tag">${esc(lead.disposition||'Uncontacted')}</span></div>
      <div class="lead-detail-address">${esc(address||'No address')}</div>
      <div class="lead-detail-grid">
        <div><span>Activity Type</span><strong>${esc(lead.lastActivityType||'—')}</strong></div>
        <div><span>Visit Result</span><strong>${esc(lead.visitResult||'—')}</strong></div>
        <div><span>Stage</span><strong>${esc(lead.stage||'Prospecting')}</strong></div>
        <div><span>Lead owner</span><strong>${esc(lead.ownerName||'Unassigned')}</strong></div>
        <div><span>Owner role</span><strong>${esc(lead.ownerRole==='admin'?'Administrator':lead.ownerRole==='manager'?'Manager':lead.ownerRole==='trainer'?'Trainer':lead.ownerRole==='rep'||lead.ownerRole==='tester'?'Representative':'Unassigned')}</strong></div>
        <div><span>Owner email</span><strong>${esc(lead.ownerEmail||'—')}</strong></div>
        <div><span>Assigned administrator</span><strong>${esc(lead.assignedAdminName||lead.assignedAdminEmail||'Unassigned')}</strong></div>
        <div><span>Assigned manager</span><strong>${esc(lead.assignedManagerName||'Unassigned')}</strong></div>
        <div><span>Assigned rep</span><strong>${esc(lead.assignedRepName||lead.rep||'Unassigned')}</strong></div>
        <div><span>Team</span><strong>${esc(lead.team||'Unassigned')}</strong></div>
      </div>
      `;
    if(detail.dataset.leadId===String(activeLeadId)&&detail.querySelector('.lead-detail-summary')){
      window.MCCOY_UI.html(detail.querySelector('.lead-detail-summary'),summary);
      detail._refreshWorkflowLead?.(lead);
      return;
    }
    detail.dataset.leadId=String(activeLeadId);
    detail.innerHTML=`<div class="lead-detail-summary">${summary}</div>
      <div class="map-pin-disposition" aria-label="Map pin disposition">
        <strong>Disposition</strong>
        <div class="map-pin-disposition-grid">
          <label>Activity Type<select id="mapLeadActivityType">${optionList(activityTypes)}</select></label>
          <label>Visit Result<select id="mapLeadVisitResult">${optionList(visitResults,'Select result')}</select></label>
          <label>Stage<select id="mapLeadStage">${optionList(stages,'No stage change')}</select></label>
        </div>
        <div class="map-pin-disposition-actions"><button id="mapPinStartBtn" type="button" class="assign-btn">START PIN ACTIVITY</button><button id="mapPinSaveBtn" type="button" class="primary">SAVE PIN DISPOSITION</button><button id="mapPinSaleBtn" type="button" class="success">PROCESS SALE</button><button id="mapDeleteLeadBtn" type="button" class="danger">DELETE LEAD</button></div>
        <div id="mapPinDispositionMsg" class="muted small" role="status" aria-live="polite">Disposition is allowed regardless of door verification. Location accuracy and distance are coaching signals only; verified-sale rules still apply.</div>
      </div>
      <div class="muted small lead-detail-help">Edit the address in Correct Lead and press ENTER to save it and correct the house location automatically.</div>`;
    wireDisposition(lead);
  }

  function activateLead(id){
    const lead=leadByAnyId(id);
    if(!lead)return;
    activeLeadId=lead.dbId||lead.id;
    renderDetail(lead);
    window.MCCOY_SELECT_MAP_LEAD?.(lead.id);
  }

  function enhanceList(){
    removeLegacyAssign();
    const list=document.getElementById('mapLeadList');
    if(!list)return;
    list.querySelectorAll('.map-pick').forEach(btn=>{
      if(btn.dataset.detailWired)return;
      btn.dataset.detailWired='1';
      const lead=leadByAnyId(btn.dataset.id);
      if(lead){
        btn.innerHTML=`<strong>${esc(lead.address||'Lead')}</strong><span>${esc([lead.city,lead.stateCode,lead.zip].filter(Boolean).join(', '))}</span><span>Owner: ${esc(lead.ownerName||'Unassigned')} · ${esc(lead.disposition||'Uncontacted')}</span>`;
      }
      btn.addEventListener('click',()=>setTimeout(()=>activateLead(btn.dataset.id),0));
    });
    ensureDetailPanel();
  }

  function leadFromCorrectionForm(){
    const a1=document.getElementById('editLeadAddress1')?.value||'';
    const a2=document.getElementById('editLeadAddress2')?.value||'';
    const city=document.getElementById('editLeadCity')?.value||'';
    const stateCode=document.getElementById('editLeadState')?.value||'';
    const zip=document.getElementById('editLeadZip')?.value||'';
    return (state.realLeads||[]).find(l=>(l.address1||l.address||'')===a1&&(l.address2||'')===a2&&(l.city||'')===city&&(l.stateCode||'')===stateCode&&(l.zip||'')===zip)||null;
  }

  function correctionMsg(text){const el=document.getElementById('leadCorrectionMsg');if(el)el.textContent=text;}
  function v(id){return document.getElementById(id)?.value?.trim()||'';}

  async function correctAddressLocation(){
    if(correcting||window.MCCOY_ACCESS?.access?.role!=='admin')return;
    let lead=leadByAnyId(activeLeadId);
    if(!lead){lead=leadFromCorrectionForm();if(lead)activeLeadId=lead.dbId||lead.id;}
    if(!lead){correctionMsg('Select a lead before correcting its address.');return;}
    const payload={action:'correct_address_location',lead_id:lead.dbId||lead.id,address1:v('editLeadAddress1'),address2:v('editLeadAddress2'),city:v('editLeadCity'),state:v('editLeadState').toUpperCase(),zip:v('editLeadZip')};
    if(!payload.address1||!payload.city||!payload.state||!payload.zip){correctionMsg('Street, city, state, and ZIP are required before relocating the lead.');return;}
    correcting=true;
    correctionIds.forEach(id=>{const el=document.getElementById(id);if(el)el.disabled=true;});
    correctionMsg('Saving address and correcting map location…');
    try{
      const {data,error}=await sb.functions.invoke('lead-geocode',{body:payload});
      if(error||!data?.ok)throw error||new Error(data?.detail||data?.error||'address_location_correction_failed');
      const r=data.lead||{};
      lead.address1=r.address1||payload.address1;lead.address2=r.address2||payload.address2;lead.address=[lead.address1,lead.address2].filter(Boolean).join(' ');lead.city=r.city||payload.city;lead.stateCode=r.state||payload.state;lead.zip=r.zip||payload.zip;lead.fullAddress=[[lead.address1,lead.address2].filter(Boolean).join(' '),lead.city,lead.stateCode,lead.zip].filter(Boolean).join(', ');
      lead.geocodeStatus=r.geocode_status||null;lead.geocodeProvider=r.geocode_provider||null;lead.geocodePrecision=r.geocode_precision||null;lead.geocodeVerificationStatus=r.geocode_verification_status||data.decision||null;lead.geocodeComparisonDistanceMeters=r.geocode_comparison_distance_meters==null?null:Number(r.geocode_comparison_distance_meters);
      lead.geocodeCandidateLat=r.geocode_candidate_latitude==null?undefined:Number(r.geocode_candidate_latitude);lead.geocodeCandidateLng=r.geocode_candidate_longitude==null?undefined:Number(r.geocode_candidate_longitude);
      if(Number.isFinite(Number(r.latitude))&&Number.isFinite(Number(r.longitude))){lead.lat=Number(r.latitude);lead.lng=Number(r.longitude);}else{lead.lat=undefined;lead.lng=undefined;}
      if(data.decision==='google_rooftop_applied')correctionMsg('Address saved and the pin moved to a matching Google rooftop result.');
      else if(String(data.decision||'').includes('preserved'))correctionMsg('Address saved. The trusted manual/imported pin was preserved and the Google comparison was recorded.');
      else correctionMsg('Address saved, but Google did not return a matching rooftop result. The lead is safely left off the map until Admin places the pin manually.');
      window.MCCOY_RENDER_LEAD_MAP?.(false);if(Number.isFinite(Number(lead.lat))&&Number.isFinite(Number(lead.lng)))setTimeout(()=>window.MCCOY_SELECT_MAP_LEAD?.(lead.dbId||lead.id),80);
      window.dispatchEvent(new CustomEvent('mccoy-lead-address-corrected',{detail:{leadId:lead.dbId||lead.id}}));
      renderDetail(lead);enhanceList();if(typeof window.renderLeads==='function')window.renderLeads();
    }catch(e){console.error('Address/location correction failed',e);correctionMsg(`Unable to correct address location${e?.message?': '+e.message:''}.`);}finally{correcting=false;correctionIds.forEach(id=>{const el=document.getElementById(id);if(el)el.disabled=false;});}
  }
  window.MCCOY_CORRECT_ADDRESS_LOCATION=correctAddressLocation;

  document.addEventListener('click',e=>{
    const pick=e.target.closest?.('.map-pick');
    if(pick?.dataset?.id){const l=leadByAnyId(pick.dataset.id);if(l)activeLeadId=l.dbId||l.id;}
    const marker=e.target.closest?.('.lead-house-icon');
    if(!marker)return;
    setTimeout(()=>{
      const selected=leadFromCorrectionForm();
      if(selected){activeLeadId=selected.dbId||selected.id;renderDetail(selected);}
    },40);
  },true);

  document.addEventListener('focusin',e=>{if(correctionIds.includes(e.target?.id)){const l=leadFromCorrectionForm();if(l)activeLeadId=l.dbId||l.id;}},true);
  document.addEventListener('keydown',e=>{if(e.key!=='Enter'||!correctionIds.includes(e.target?.id))return;e.preventDefault();e.stopPropagation();correctAddressLocation();},true);

  const obs=new MutationObserver(()=>enhanceList());
  const start=()=>{
    removeLegacyAssign();
    enhanceList();
    const list=document.getElementById('mapLeadList');
    if(list)obs.observe(list,{childList:true,subtree:true});
  };

  window.addEventListener('mccoy-real-leads-loaded',()=>setTimeout(start,300));
  window.addEventListener('mccoy-map-lead-selected',event=>activateLead(event.detail?.leadId));
  window.addEventListener('mccoy-door-visit-started',()=>{const lead=leadByAnyId(activeLeadId);if(lead)renderDetail(lead);});
  window.addEventListener('mccoy-door-visit-completed',()=>{const lead=leadByAnyId(activeLeadId);if(lead){renderDetail(lead);window.MCCOY_RENDER_LEAD_MAP?.(false);}});
  window.addEventListener('load',()=>setTimeout(start,1200));
  setTimeout(start,1800);
})();
