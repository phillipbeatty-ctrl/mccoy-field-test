(()=>{
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  let loadPromise=null;

  async function waitForActiveAccess(timeoutMs=15000){
    const start=Date.now();
    while(Date.now()-start<timeoutMs){
      const access=window.MCCOY_ACCESS?.access;
      if(access?.active)return access;
      await sleep(250);
    }
    return null;
  }

  async function getLatestSpotioBatchId(){
    try{
      const {data,error}=await sb.from('spotio_import_batches')
        .select('id,created_at,record_count,status')
        .eq('status','normalized')
        .order('created_at',{ascending:false})
        .limit(1)
        .maybeSingle();
      if(!error&&data?.id)return data.id;
    }catch{}

    // Recovery path: infer the newest imported batch directly from the lead rows.
    try{
      const {data,error}=await sb.from('leads')
        .select('import_batch_id,created_at')
        .not('import_batch_id','is',null)
        .order('created_at',{ascending:false})
        .limit(1)
        .maybeSingle();
      if(!error&&data?.import_batch_id)return data.import_batch_id;
    }catch{}
    return null;
  }

  async function loadAllLeadRows(batchId=null){
    const PAGE=1000,rows=[];
    for(let from=0;;from+=PAGE){
      let q=sb.from('leads')
        .select('id,source_id,address1,address2,city,state,zip,latitude,longitude,current_disposition,assigned_rep_id,assigned_team_id,source_system,import_batch_id,created_at')
        .order('address1',{ascending:true})
        .range(from,from+PAGE-1);
      if(batchId)q=q.eq('import_batch_id',batchId);
      const {data,error}=await q;
      if(error)throw error;
      const page=data||[];
      rows.push(...page);
      if(page.length<PAGE)break;
    }
    return rows;
  }

  function dedupeFallback(rows){
    const seen=new Map();
    for(const r of rows){
      const key=[r.address1,r.address2,r.city,r.state,r.zip].map(v=>String(v||'').trim().toUpperCase()).join('|');
      if(!seen.has(key))seen.set(key,r);
    }
    return [...seen.values()];
  }

  async function performLoad(){
    const {data:{user}}=await sb.auth.getUser();
    if(!user)throw new Error('No authenticated user');

    const access=await waitForActiveAccess();
    if(!access)throw new Error('Account access did not finish loading');

    const latestBatch=await getLatestSpotioBatchId();
    let data=await loadAllLeadRows(latestBatch);
    if(!latestBatch)data=dedupeFallback(data);

    if(latestBatch&&data.length===0){
      // A stale/blocked batch lookup must never blank a previously populated pool.
      const fallback=await loadAllLeadRows(null);
      data=dedupeFallback(fallback);
    }

    const real=data.map((r,i)=>({
      id:100000+i,dbId:r.id,sourceId:r.source_id,sourceSystem:r.source_system||'SPOTIO',importBatchId:r.import_batch_id,
      address:[r.address1,r.address2].filter(Boolean).join(' '),city:r.city||'',stateCode:r.state||'',zip:r.zip||'',
      fullAddress:[[r.address1,r.address2].filter(Boolean).join(' '),r.city,r.state,r.zip].filter(Boolean).join(', '),
      lat:r.latitude,lng:r.longitude,assignedRepId:r.assigned_rep_id||null,
      team:r.state==='NC'?'North Carolina':(['OR','WA'].includes(r.state)?'Pacific Northwest':'Unassigned'),
      rep:null,disposition:r.current_disposition||'Uncontacted',isDemo:false
    }));

    state.realLeads=real;
    if(!state.demoLeads)state.demoLeads=[];
    state.leadMode='real';
    state.leads=state.realLeads;
    for(const t of state.teams)t.leads=real.filter(l=>l.team===t.name).length;
    renderAll();
    window.dispatchEvent(new CustomEvent('mccoy-real-leads-loaded',{detail:{count:real.length,batchId:latestBatch}}));
    console.log(`McCoy Real Lead Pool loaded: ${real.length} leads${latestBatch?' from latest SPOTIO batch '+latestBatch:''}.`);
    return real;
  }

  async function loadMcCoyLeads(){
    if(loadPromise)return loadPromise;
    loadPromise=(async()=>{
      let lastErr=null;
      for(let attempt=1;attempt<=4;attempt++){
        try{return await performLoad();}
        catch(e){lastErr=e;console.warn(`Real lead load attempt ${attempt} failed`,e);if(attempt<4)await sleep(750*attempt);}
      }
      console.error('Real lead load failed',lastErr);
      window.dispatchEvent(new CustomEvent('mccoy-real-leads-load-error',{detail:{message:lastErr?.message||String(lastErr)}}));
      return [];
    })();
    try{return await loadPromise;}finally{loadPromise=null;}
  }

  window.loadMcCoyLeads=loadMcCoyLeads;
  sb.auth.onAuthStateChange((_event,session)=>{if(session)setTimeout(loadMcCoyLeads,250);});
  window.addEventListener('load',()=>setTimeout(loadMcCoyLeads,500));
  setTimeout(loadMcCoyLeads,900);
})();