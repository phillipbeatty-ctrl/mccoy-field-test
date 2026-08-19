(()=>{
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  let loadPromise=null;
  let fallbackRunning=false;
  const fallbackAttemptedBatches=new Set();

  async function waitForActiveAccess(timeoutMs=15000){
    const start=Date.now();
    while(Date.now()-start<timeoutMs){
      const access=window.MCCOY_ACCESS?.access;
      if(access?.active)return access;
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
      if(page>30)throw new Error('real_lead_pagination_guard');
    }
    return {rows,total:Number(total||rows.length),batchId};
  }

  function validCoordinate(v){
    if(v===null||v===undefined||v==='')return undefined;
    const n=Number(v);
    return Number.isFinite(n)?n:undefined;
  }

  function mapLeadRows(data){
    return data.map((r,i)=>({
      id:100000+i,
      dbId:r.id,
      sourceId:r.source_id,
      sourceSystem:r.source_system||'SPOTIO',
      importBatchId:r.import_batch_id,
      address1:r.address1||'',
      address2:r.address2||'',
      address:[r.address1,r.address2].filter(Boolean).join(' '),
      city:r.city||'',stateCode:r.state||'',zip:r.zip||'',
      fullAddress:[[r.address1,r.address2].filter(Boolean).join(' '),r.city,r.state,r.zip].filter(Boolean).join(', '),
      lat:validCoordinate(r.latitude),lng:validCoordinate(r.longitude),
      geocodeStatus:r.geocode_status||null,
      assignedRepId:r.assigned_rep_id||null,
      team:r.state==='NC'?'North Carolina':(['OR','WA'].includes(r.state)?'Pacific Northwest':'Unassigned'),
      rep:null,
      disposition:r.current_disposition||'Uncontacted',
      isDemo:false
    }));
  }

  function applyLoadedResult(result){
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
    window.MCCOY_RENDER_LEAD_MAP?.(false);
    return real;
  }

  async function resolveMissingCoordinates(batchId,missingCount){
    if(!batchId||!missingCount||fallbackRunning||fallbackAttemptedBatches.has(batchId))return;
    fallbackRunning=true;fallbackAttemptedBatches.add(batchId);
    try{
      let remaining=Number(missingCount||0),totalResolved=0,round=0;
      const maxRounds=Math.min(20,Math.max(1,Math.ceil(remaining/500)+2));
      while(remaining>0&&round<maxRounds){
        round++;
        const {data,error}=await sb.functions.invoke('lead-geocode',{body:{action:'resolve_missing_locations',limit:Math.min(500,remaining)}});
        if(error||!data?.ok)throw error||new Error(data?.detail||data?.error||'missing_location_resolution_failed');
        const resolved=Number(data.resolved||0);
        totalResolved+=resolved;
        console.log(`McCoy location fallback round ${round}: ${resolved} resolved (${data.exact||0} exact, ${data.approx_zip||0} ZIP, ${data.approx_city||0} city); ${data.still_unmatched||0} still unmatched in this round.`);
        if(resolved<=0)break;
        remaining=Math.max(0,remaining-resolved);
        await sleep(150);
      }
      if(totalResolved>0){
        const refreshed=await loadRealLeadRowsFromServer();
        applyLoadedResult(refreshed);
      }
    }catch(e){console.warn('Automatic missing-coordinate fallback paused',e);}
    finally{fallbackRunning=false;}
  }

  async function performLoad(){
    const {data:{user}}=await sb.auth.getUser();
    if(!user)throw new Error('No authenticated user');
    const access=await waitForActiveAccess();
    if(!access)throw new Error('Account access did not finish loading');

    const result=await loadRealLeadRowsFromServer();
    const real=applyLoadedResult(result);
    const missing=real.filter(l=>!Number.isFinite(Number(l.lat))||!Number.isFinite(Number(l.lng))).length;
    if(missing)setTimeout(()=>resolveMissingCoordinates(result.batchId,missing),500);
    console.log(`McCoy Real Lead Pool loaded through lead-admin: ${real.length}/${result.total} leads; ${missing} awaiting location fallback.`);
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
  window.MCCOY_RESOLVE_MISSING_LEAD_LOCATIONS=()=>{
    const batchId=state.realLeads?.find(l=>!Number.isFinite(Number(l.lat))||!Number.isFinite(Number(l.lng)))?.importBatchId||state.realLeads?.[0]?.importBatchId;
    const missing=(state.realLeads||[]).filter(l=>!Number.isFinite(Number(l.lat))||!Number.isFinite(Number(l.lng))).length;
    fallbackAttemptedBatches.delete(batchId);
    return resolveMissingCoordinates(batchId,missing);
  };
  sb.auth.onAuthStateChange((_event,session)=>{if(session)setTimeout(loadMcCoyLeads,300);});
  window.addEventListener('load',()=>setTimeout(loadMcCoyLeads,600));
  setTimeout(loadMcCoyLeads,1000);
})();