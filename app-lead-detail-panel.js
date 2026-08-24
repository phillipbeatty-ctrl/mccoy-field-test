(()=>{
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let activeLeadId=null;
  let correcting=false;
  const correctionIds=['editLeadAddress1','editLeadAddress2','editLeadCity','editLeadState','editLeadZip'];

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

  function renderDetail(lead){
    const detail=ensureDetailPanel();
    if(!detail||!lead)return;
    activeLeadId=lead.dbId||lead.id;
    const address=[lead.address,lead.city,lead.stateCode,lead.zip].filter(Boolean).join(', ');
    detail.innerHTML=`
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
      <div class="muted small lead-detail-help">Edit the address in Correct Lead and press ENTER to save it and correct the house location automatically.</div>`;
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
      if(data.matched&&Number.isFinite(Number(r.latitude))&&Number.isFinite(Number(r.longitude))){lead.lat=Number(r.latitude);lead.lng=Number(r.longitude);correctionMsg('Address saved and house moved to the corrected address location.');window.MCCOY_RENDER_LEAD_MAP?.(false);setTimeout(()=>window.MCCOY_SELECT_MAP_LEAD?.(lead.dbId||lead.id),80);}else{correctionMsg('Address saved, but the geocoder could not confidently place it. Drag the correction house manually if needed.');}
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
  window.addEventListener('load',()=>setTimeout(start,1200));
  setTimeout(start,1800);
})();
