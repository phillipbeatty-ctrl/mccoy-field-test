(()=>{
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

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
    const address=[lead.address,lead.city,lead.stateCode,lead.zip].filter(Boolean).join(', ');
    const coords=(Number.isFinite(Number(lead.lat))&&Number.isFinite(Number(lead.lng)))?`${Number(lead.lat).toFixed(6)}, ${Number(lead.lng).toFixed(6)}`:'Not mapped';
    detail.innerHTML=`
      <div class="lead-detail-head"><strong>${esc(lead.address||'Lead')}</strong><span class="tag">${esc(lead.disposition||'Uncontacted')}</span></div>
      <div class="lead-detail-address">${esc(address||'No address')}</div>
      <div class="lead-detail-grid">
        <div><span>Assigned rep</span><strong>${esc(lead.rep||'Unassigned')}</strong></div>
        <div><span>Team</span><strong>${esc(lead.team||'Unassigned')}</strong></div>
        <div><span>Source</span><strong>${esc(lead.sourceSystem||'SPOTIO')}</strong></div>
        <div><span>Source ID</span><strong>${esc(lead.sourceId||'—')}</strong></div>
        <div><span>Coordinates</span><strong>${esc(coords)}</strong></div>
        <div><span>Lead ID</span><strong>${esc(lead.dbId||'—')}</strong></div>
      </div>
      <div class="muted small lead-detail-help">This lead is now active for selection, assignment, address correction, and map-location correction.</div>`;
  }

  function activateLead(id){
    const lead=leadByAnyId(id);
    if(!lead)return;
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
        btn.innerHTML=`<strong>${esc(lead.address||'Lead')}</strong><span>${esc([lead.city,lead.stateCode,lead.zip].filter(Boolean).join(', '))}</span><span>${esc(lead.rep||'Unassigned')} · ${esc(lead.disposition||'Uncontacted')}</span>`;
      }
      btn.addEventListener('click',()=>setTimeout(()=>activateLead(btn.dataset.id),0));
    });
    ensureDetailPanel();
  }

  document.addEventListener('click',e=>{
    const marker=e.target.closest?.('.lead-house-icon');
    if(!marker)return;
    setTimeout(()=>{
      const selected=(state.realLeads||[]).find(l=>document.getElementById('editLeadAddress1')?.value===(l.address1||l.address||''));
      if(selected)renderDetail(selected);
    },40);
  },true);

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
