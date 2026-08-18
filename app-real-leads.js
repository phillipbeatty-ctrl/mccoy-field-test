(()=>{
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  let loadPromise=null;

  async function waitForAdminAccess(timeoutMs=15000){
    const start=Date.now();
    while(Date.now()-start<timeoutMs){
      const access=window.MCCOY_ACCESS?.access;
      if(access?.active&&access?.role==='admin')return access;
      await sleep(250);
    }
    return null;
  }

  async function loadRealLeadRowsFromServer(){
    const PAGE=1000,rows=[];
    let page=0,total=null,batchId=null;
    while(total===null||rows.length<total){
      const {data,error}=await sb.functions.invoke('lead-admin',{body:{action:'list_real_leads',page,limit:PAGE}});
      if(error)throw error;
      if(!data?.ok)throw new Error(data?.error||'real_lead_server_read_failed');
      if(total===null)total=Number(data.total||0);
      batchId=data.batch_id||batchId;
      const chunk=Array.isArray(data.leads)?data.leads:[];
      rows.push(...chunk);
      if(!chunk.length||chunk.length<PAGE)break;
      page++;
      if(page>20)throw new Error('real_lead_pagination_guard');
    }
    return {rows,total:Number(total||rows.length),batchId};
  }

  function mapLeadRows(data){
    return data.map((r,i)=>({
      id:100000+i,
      dbId:r.id,
      sourceId:r.source_id,
      sourceSystem:r.source_system||'SPOTIO',
      importBatchId:r.import_batch_id,
      address:[r.address1,r.address2].filter(Boolean).join(' '),
      city:r.city||'',stateCode:r.state||'',zip:r.zip||'',
      fullAddress:[[r.address1,r.address2].filter(Boolean).join(' '),r.city,r.state,r.zip].filter(Boolean).join(', '),
      lat:r.latitude,lng:r.longitude,
      assignedRepId:r.assigned_rep_id||null,
      team:r.state==='NC'?'North Carolina':(['OR','WA'].includes(r.state)?'Pacific Northwest':'Unassigned'),
      rep:null,
      disposition:r.current_disposition||'Uncontacted',
      isDemo:false
    }));
  }

  async function performLoad(){
    const {data:{user}}=await sb.auth.getUser();
    if(!user)throw new Error('No authenticated user');
    const access=await waitForAdminAccess();
    if(!access)throw new Error('Admin access did not finish loading');

    const result=await loadRealLeadRowsFromServer();
    const real=mapLeadRows(result.rows);
    if(result.total>0&&real.length===0)throw new Error(`Server reported ${result.total} leads but returned none`);

    state.realLeads=real;
    if(!state.demoLeads)state.demoLeads=[];
    state.leadMode='real';
    state.leads=state.realLeads;
    for(const t of state.teams)t.leads=real.filter(l=>l.team===t.name).length;

    renderAll();
    if(typeof window.renderLeads==='function')window.renderLeads();
    window.dispatchEvent(new CustomEvent('mccoy-real-leads-loaded',{detail:{count:real.length,batchId:result.batchId,total:result.total}}));
    console.log(`McCoy Real Lead Pool loaded through lead-admin: ${real.length}/${result.total} leads from ${result.batchId||'no batch'}.`);
    return real;
  }

  async function loadMcCoyLeads(){
    if(loadPromise)return loadPromise;
    loadPromise=(async()=>{
      let lastErr=null;
      for(let attempt=1;attempt<=5;attempt++){
        try{return await performLoad();}
        catch(e){
          lastErr=e;
          console.warn(`Real lead server load attempt ${attempt} failed`,e);
          if(attempt<5)await sleep(1000*attempt);
        }
      }
      console.error('Real lead server load failed',lastErr);
      window.dispatchEvent(new CustomEvent('mccoy-real-leads-load-error',{detail:{message:lastErr?.message||String(lastErr)}}));
      return [];
    })();
    try{return await loadPromise;}finally{loadPromise=null;}
  }

  window.loadMcCoyLeads=loadMcCoyLeads;
  sb.auth.onAuthStateChange((_event,session)=>{if(session)setTimeout(loadMcCoyLeads,300);});
  window.addEventListener('load',()=>setTimeout(loadMcCoyLeads,600));
  setTimeout(loadMcCoyLeads,1000);
})();