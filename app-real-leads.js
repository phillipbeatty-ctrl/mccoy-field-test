(()=>{
  async function getLatestSpotioBatchId(){
    try{
      const {data,error}=await sb.from('spotio_import_batches')
        .select('id,created_at,record_count,status')
        .eq('status','normalized')
        .order('created_at',{ascending:false})
        .limit(1)
        .maybeSingle();
      if(error) return null;
      return data?.id||null;
    }catch{return null;}
  }

  async function loadAllLeadRows(batchId=null){
    const PAGE=1000,rows=[];
    for(let from=0;;from+=PAGE){
      let q=sb.from('leads')
        .select('id,source_id,address1,address2,city,state,zip,latitude,longitude,current_disposition,assigned_rep_id,assigned_team_id,source_system,import_batch_id,created_at')
        .order('address1',{ascending:true})
        .range(from,from+PAGE-1);
      if(batchId) q=q.eq('import_batch_id',batchId);
      const {data,error}=await q;
      if(error)throw error;
      const page=data||[];rows.push(...page);
      if(page.length<PAGE)break;
    }
    return rows;
  }

  function dedupeFallback(rows){
    const seen=new Map();
    for(const r of rows){
      const key=[r.address1,r.address2,r.city,r.state,r.zip].map(v=>String(v||'').trim().toUpperCase()).join('|');
      if(!seen.has(key)) seen.set(key,r);
    }
    return [...seen.values()];
  }

  async function loadMcCoyLeads(){
    try{
      const {data:{user}}=await sb.auth.getUser();if(!user)return;
      const access=window.MCCOY_ACCESS?.access;if(!access?.active)return;
      const latestBatch=await getLatestSpotioBatchId();
      let data=await loadAllLeadRows(latestBatch);
      if(!latestBatch) data=dedupeFallback(data);
      const real=data.map((r,i)=>({
        id:100000+i,dbId:r.id,sourceId:r.source_id,sourceSystem:r.source_system||'SPOTIO',importBatchId:r.import_batch_id,
        address:[r.address1,r.address2].filter(Boolean).join(' '),city:r.city||'',stateCode:r.state||'',zip:r.zip||'',
        fullAddress:[[r.address1,r.address2].filter(Boolean).join(' '),r.city,r.state,r.zip].filter(Boolean).join(', '),
        lat:r.latitude,lng:r.longitude,assignedRepId:r.assigned_rep_id||null,
        team:r.state==='NC'?'North Carolina':(['OR','WA'].includes(r.state)?'Pacific Northwest':'Unassigned'),
        rep:null,disposition:r.current_disposition||'Uncontacted',isDemo:false
      }));
      state.realLeads=real;
      if(!state.demoLeads) state.demoLeads=[];
      state.leadMode=state.leadMode||'real';
      state.leads=state.leadMode==='demo'?state.demoLeads:state.realLeads;
      for(const t of state.teams)t.leads=real.filter(l=>l.team===t.name).length;
      renderAll();
      window.dispatchEvent(new CustomEvent('mccoy-real-leads-loaded',{detail:{count:real.length,batchId:latestBatch}}));
      console.log(`McCoy Real Lead Pool loaded: ${real.length} leads${latestBatch?' from latest SPOTIO batch '+latestBatch:''}.`);
    }catch(e){console.error('Real lead load failed',e);}
  }
  window.loadMcCoyLeads=loadMcCoyLeads;
  sb.auth.onAuthStateChange((_event,session)=>{if(session)setTimeout(loadMcCoyLeads,150);});
  setTimeout(loadMcCoyLeads,600);
})();