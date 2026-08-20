(()=>{
  function wireImport(){const b=document.getElementById('adminLeadImportBtn');if(!b||b.dataset.mccoyWired)return;b.dataset.mccoyWired='1';b.addEventListener('click',()=>{window.location.href='/spotio-import.html';});}
  function resolveAssignments(){
    if(!state.realLeads?.length||typeof window.MCCOY_APPLY_LEAD_OWNERSHIP!=='function')return;
    let changed=false;
    for(const lead of state.realLeads){
      const before=`${lead.ownerName||''}|${lead.ownerRole||''}|${lead.assignedRepName||''}|${lead.assignedManagerName||''}`;
      window.MCCOY_APPLY_LEAD_OWNERSHIP(lead);
      const after=`${lead.ownerName||''}|${lead.ownerRole||''}|${lead.assignedRepName||''}|${lead.assignedManagerName||''}`;
      if(before!==after)changed=true;
    }
    if(changed&&window.renderLeads)window.renderLeads();
  }
  wireImport();
  window.addEventListener('mccoy-real-leads-loaded',()=>{wireImport();setTimeout(resolveAssignments,150);});
  setTimeout(()=>{wireImport();resolveAssignments();},1200);
})();