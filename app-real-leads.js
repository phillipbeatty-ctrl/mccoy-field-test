(()=>{
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  let loadPromise=null;
  let startupComplete=false,startupTimer=null;
  let fallbackRunning=false;
  const fallbackAttemptedBatches=new Set();
  let ownersById=new Map(),ownersByEmail=new Map();

  async function waitForActiveAccess(timeoutMs=15000){
    const start=Date.now();
    while(Date.now()-start<timeoutMs){
      const access=window.MCCOY_ACCESS?.access;
      if(access?.active)return access;
      await sleep(250);
    }
    return null;
  }

  async function loadRealLeadRowsFromServer(onProgress=null){
    const PAGE=4000,CONCURRENT=4;
    async function fetchPage(page,totalHint=0){
      const {data,error}=await sb.functions.invoke('lead-admin',{body:{action:'list_real_leads',page,limit:PAGE,...(totalHint?{total_hint:totalHint}:{})}});
      if(error)throw error;
      if(!data?.ok)throw new Error(data?.error||'real_lead_server_read_failed');
      return data;
    }
    const first=await fetchPage(0);
    const total=Math.max(0,Number(first.total||0));
    const rows=Array.isArray(first.leads)?first.leads.slice():[];
    const totalPages=Math.ceil(total/PAGE);
    const resultForRows=leadRows=>({rows:leadRows,total,batchId:first.batch_id||null,scope:first.scope||'all',assignedTeam:first.assigned_team||null,assignmentRequired:!!first.assignment_required,assignmentReason:first.assignment_reason||null,assignedAreas:first.assigned_areas||[],owners:Array.isArray(first.owners)?first.owners:[]});
    if(totalPages>120)throw new Error('real_lead_pagination_guard');
    if(totalPages>1&&typeof onProgress==='function')onProgress(resultForRows(rows.slice()));
    for(let next=1;next<totalPages;next+=CONCURRENT){
      const requests=[];
      for(let page=next;page<Math.min(totalPages,next+CONCURRENT);page++)requests.push(fetchPage(page,total));
      const responses=await Promise.all(requests);
      for(const response of responses)rows.push(...(Array.isArray(response.leads)?response.leads:[]));
    }
    return resultForRows(rows);
  }

  function validCoordinate(v){
    if(v===null||v===undefined||v==='')return undefined;
    const n=Number(v);
    return Number.isFinite(n)?n:undefined;
  }

  function setOwnershipDirectory(accounts){
    const directory=(Array.isArray(accounts)?accounts:[]).filter(account=>account&&account.user_id&&account.email).map(account=>({...account,email:String(account.email).toLowerCase(),display_name:account.display_name||account.email}));
    ownersById=new Map(directory.map(account=>[String(account.user_id),account]));
    ownersByEmail=new Map(directory.map(account=>[account.email,account]));
    state.leadOwnershipDirectory=directory;
    window.MCCOY_LEAD_OWNERSHIP_DIRECTORY=directory;
    window.dispatchEvent(new CustomEvent('mccoy-lead-owners-updated',{detail:{owners:directory}}));
    return directory;
  }

  function applyLeadOwnership(lead){
    if(!lead)return lead;
    const repAccount=lead.assignedRepId?ownersById.get(String(lead.assignedRepId)):null;
    const managerAccount=lead.assignedManagerId?ownersById.get(String(lead.assignedManagerId)):null;
    const administratorAccount=(lead.assignedAdminEmail?ownersByEmail.get(String(lead.assignedAdminEmail).toLowerCase()):null)||(repAccount?.role==='admin'?repAccount:null);
    const ownerAccount=repAccount||managerAccount||administratorAccount||null;
    const display=account=>account?.display_name||account?.email||null;
    lead.assignedRepName=repAccount&&['rep','tester'].includes(repAccount.role)?display(repAccount):null;
    lead.assignedRepEmail=repAccount?.email||null;
    lead.assignedManagerName=display(managerAccount);
    lead.assignedManagerEmail=managerAccount?.email||null;
    lead.assignedAdminName=display(administratorAccount);
    lead.ownerName=display(ownerAccount)||'Unassigned';
    lead.ownerEmail=ownerAccount?.email||null;
    lead.ownerRole=ownerAccount?.role||'unassigned';
    lead.team=repAccount?.team_name||managerAccount?.team_name||(lead.stateCode==='NC'?'North Carolina':(['OR','WA'].includes(lead.stateCode)?'Pacific Northwest':'Unassigned'));
    lead.rep=lead.assignedRepName;
    return lead;
  }
  window.MCCOY_APPLY_LEAD_OWNERSHIP=applyLeadOwnership;

  function mapLeadRows(data){
    return data.map((r,i)=>applyLeadOwnership({
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
      assignedManagerId:r.assigned_manager_id||null,
      assignedAdminEmail:r.assigned_admin_email||null,
      disposition:r.current_disposition||'Uncontacted',
      lastActivityType:r.last_activity_type||null,
      visitResult:r.visit_result||null,
      stage:r.stage||'Prospecting',
      pinColor:r.pin_color||null,
      pinColorSource:r.pin_color_source||null,
      pinDisposition:r.pin_color_source==='stage'?(r.stage||r.current_disposition):r.pin_color_source==='visit_result'?(r.visit_result||r.current_disposition):(r.current_disposition||'Prospecting'),
      isDemo:false
    }));
  }

  function applyLoadedResult(result,{partial=false}={}){
    setOwnershipDirectory(result.owners||[]);
    const real=mapLeadRows(result.rows);
    if(result.total>0&&real.length===0)throw new Error(`Server reported ${result.total} leads but returned none`);
    state.realLeads=real;
    if(!state.demoLeads||window.MCCOY_ACCESS?.access?.role!=='admin')state.demoLeads=[];
    state.leadAccessScope={scope:result.scope||'all',assignedTeam:result.assignedTeam||null,assignmentRequired:!!result.assignmentRequired,assignmentReason:result.assignmentReason||null,assignedAreas:result.assignedAreas||[]};
    state.leadMode='real';
    state.leads=state.realLeads;
    const teamCounts=new Map();for(const lead of real)teamCounts.set(lead.team,(teamCounts.get(lead.team)||0)+1);for(const team of state.teams)team.leads=teamCounts.get(team.name)||0;
    renderAll();
    if(!real.length){const select=document.getElementById('fieldLeadSelect');if(select){const option=document.createElement('option');option.value='';option.textContent=result.assignmentRequired?(result.scope==='manager_pool'?'No leads assigned by your administrator — contact your administrator':result.scope==='manager_assigned_rep'?'No leads assigned by your manager — contact your manager':'No leads assigned to you — contact your administrator or manager'):'No real leads are available in your assigned area';select.replaceChildren(option);}}
    const detail={count:real.length,batchId:result.batchId,total:result.total,partial};
    if(partial){const progress=document.getElementById('geocodeProgress');if(progress)progress.textContent=`Loading leads… ${real.length.toLocaleString()} of ${result.total.toLocaleString()} ready.`;window.dispatchEvent(new CustomEvent('mccoy-real-leads-progress',{detail}));}
    else window.dispatchEvent(new CustomEvent('mccoy-real-leads-loaded',{detail}));
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
    if(access.role!=='admin'){state.demoLeads=[];state.realLeads=state.realLeads||[];state.leadMode='real';state.leads=state.realLeads;if(!state.realLeads.length)renderAll();}

    const started=typeof performance!=='undefined'?performance.now():Date.now();
    const result=await loadRealLeadRowsFromServer(preview=>applyLoadedResult(preview,{partial:true}));
    const real=applyLoadedResult(result);startupComplete=true;const elapsed=Math.round((typeof performance!=='undefined'?performance.now():Date.now())-started);
    window.MCCOY_LAST_LEAD_LOAD={count:real.length,total:result.total,elapsed_ms:elapsed,page_size:4000};
    const missing=real.filter(l=>!Number.isFinite(Number(l.lat))||!Number.isFinite(Number(l.lng))).length;
    if(missing&&access.role==='admin')setTimeout(()=>resolveMissingCoordinates(result.batchId,missing),500);
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
  function scheduleInitialLoad(delay=0){if(startupComplete||loadPromise)return;clearTimeout(startupTimer);startupTimer=setTimeout(()=>{if(!startupComplete&&!loadPromise)loadMcCoyLeads();},delay);}
  sb.auth.onAuthStateChange((_event,session)=>{if(session)scheduleInitialLoad(60);});
  window.addEventListener('mccoy-access-ready',()=>scheduleInitialLoad(0));
  window.addEventListener('load',()=>scheduleInitialLoad(120));
  scheduleInitialLoad(450);
})();
