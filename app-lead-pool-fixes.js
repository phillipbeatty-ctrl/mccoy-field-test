(()=>{
  function wireImport(){const b=document.getElementById('adminLeadImportBtn');if(!b||b.dataset.mccoyWired)return;b.dataset.mccoyWired='1';b.addEventListener('click',()=>{window.location.href='/spotio-import.html';});}
  async function resolveAssignments(){
    if(!['admin','manager'].includes(window.MCCOY_ACCESS?.access?.role)||!state.realLeads?.length)return;
    try{
      const {data,error}=await sb.functions.invoke('lead-admin',{body:{action:'list_reps'}});if(error)throw error;
      const reps=data?.reps||[],byId=new Map(reps.filter(r=>r.user_id).map(r=>[r.user_id,r]));
      let changed=false;
      for(const l of state.realLeads){const role=window.MCCOY_ACCESS?.access?.role,ownerId=l.assignedRepId||(role==='admin'?l.assignedManagerId:null),r=ownerId?byId.get(ownerId):null;const name=r?.display_name||r?.email||(role==='manager'&&l.assignedManagerId&&!l.assignedRepId?'Manager Pool':null);if(l.rep!==name){l.rep=name;changed=true;}}
      if(changed&&window.renderLeads)window.renderLeads();
    }catch(e){console.error('Assignment name resolution failed',e);}
  }
  wireImport();
  window.addEventListener('mccoy-real-leads-loaded',()=>{wireImport();setTimeout(resolveAssignments,150);});
  setTimeout(()=>{wireImport();resolveAssignments();},1200);
})();