(()=>{
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  let loadPromise=null;
  let startupComplete=false,startupTimer=null;
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

  // Classifies a failed page fetch so a page failure reads as "rate limited"
  // or "timeout" rather than an opaque generic message -- the whole point of
  // this pass is to know WHY a page failed, not just that it did. Falls back
  // to 'other' with the raw message always preserved, since a wrong guess at
  // classification shouldn't ever cost losing the actual error text.
  function classifyLeadPageError(error){
    const status=Number(error?.context?.status??error?.status??error?.context?.response?.status)||null;
    const message=String(error?.message||error||'unknown_error');
    if(status===429)return{type:'rate_limited',status,message};
    if(status===504||status===408)return{type:'timeout',status,message};
    if(status&&status>=500)return{type:'server_error',status,message};
    if(status&&status>=400)return{type:'client_error',status,message};
    if(/timeout|timed out/i.test(message))return{type:'timeout',status,message};
    if(/network|failed to fetch|load failed/i.test(message))return{type:'network_error',status,message};
    if(error?.name==='FunctionsFetchError')return{type:'network_error',status,message};
    if(error?.name==='FunctionsRelayError')return{type:'relay_error',status,message};
    return{type:'other',status,message};
  }

  // Reset once per top-level loadMcCoyLeads() call (not per internal retry),
  // so by the time a load finishes -- successfully or not -- this holds the
  // complete picture of every page attempted across however many retries it
  // took. Bounded so a long session with many loads can't grow this forever.
  function resetLeadLoadDiagnostics(){
    window.MCCOY_LEAD_LOAD_DIAGNOSTICS={startedAt:new Date().toISOString(),pages:[]};
  }
  function recordLeadPageDiagnostic(entry){
    const log=window.MCCOY_LEAD_LOAD_DIAGNOSTICS;
    if(!log)return;
    log.pages.push(entry);
    if(log.pages.length>300)log.pages.splice(0,log.pages.length-300);
  }
  function summarizeLeadLoadFailure(){
    const pages=window.MCCOY_LEAD_LOAD_DIAGNOSTICS?.pages||[];
    const failures=pages.filter(p=>p.outcome==='failed');
    if(!failures.length)return null;
    const last=failures[failures.length-1];
    // Only this same attempt's successes count -- each retry restarts from
    // page 0 and discards the prior attempt's rows entirely, so summing
    // across attempts would overstate what was actually usable at the end.
    const loadedRows=pages.filter(p=>p.outcome==='success'&&p.attempt===last.attempt).reduce((sum,p)=>sum+(p.rowCount||0),0);
    const statusPart=last.httpStatus?` (HTTP ${last.httpStatus})`:'';
    return `page ${last.page} failed on attempt ${last.attempt}: ${last.errorType}${statusPart} — ${loadedRows.toLocaleString()} leads loaded before the failure`;
  }

  async function loadRealLeadRowsFromServer(onProgress=null,attemptNumber=1){
    const PAGE=4000,CONCURRENT=4;
    async function fetchPage(page,totalHint=0){
      const startedAt=Date.now();
      try{
        const {data,error}=await sb.functions.invoke('lead-admin',{body:{action:'list_real_leads',page,limit:PAGE,...(totalHint?{total_hint:totalHint}:{})}});
        if(error)throw error;
        if(!data?.ok)throw new Error(data?.error||'real_lead_server_read_failed');
        recordLeadPageDiagnostic({attempt:attemptNumber,page,startedAt:new Date(startedAt).toISOString(),durationMs:Date.now()-startedAt,outcome:'success',rowCount:Array.isArray(data.leads)?data.leads.length:0});
        return data;
      }catch(e){
        const classified=classifyLeadPageError(e);
        recordLeadPageDiagnostic({attempt:attemptNumber,page,startedAt:new Date(startedAt).toISOString(),durationMs:Date.now()-startedAt,outcome:'failed',errorType:classified.type,httpStatus:classified.status,message:classified.message});
        throw e;
      }
    }
    const first=await fetchPage(0);
    const total=Math.max(0,Number(first.total||0));
    const rows=Array.isArray(first.leads)?first.leads.slice():[];
    const totalPages=Math.ceil(total/PAGE);
    const resultForRows=leadRows=>({rows:leadRows,total,batchId:first.batch_id||null,scope:first.scope||'all',assignedTeam:first.assigned_team||null,assignmentRequired:!!first.assignment_required,assignmentReason:first.assignment_reason||null,assignedAreas:first.assigned_areas||[],owners:Array.isArray(first.owners)?first.owners:[]});
    if(totalPages>120)throw new Error('real_lead_pagination_guard');
    if(totalPages>1&&typeof onProgress==='function')onProgress(resultForRows(rows.slice()));
    for(let next=1;next<totalPages;next+=CONCURRENT){
      const pageNumbers=[];
      for(let page=next;page<Math.min(totalPages,next+CONCURRENT);page++)pageNumbers.push(page);
      // allSettled rather than all: every page in this batch gets its own
      // recorded outcome above even when a sibling request fails, instead of
      // Promise.all's short-circuit hiding what the other 3 concurrent
      // requests were doing. Behavior is unchanged from the original --
      // still aborts on the first rejection found, still discards this
      // batch's rows on any failure -- only the visibility into WHY changes.
      const settled=await Promise.allSettled(pageNumbers.map(page=>fetchPage(page,total)));
      const rejected=settled.find(s=>s.status==='rejected');
      if(rejected)throw rejected.reason;
      for(const outcome of settled)rows.push(...(Array.isArray(outcome.value.leads)?outcome.value.leads:[]));
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
      updatedAt:r.pin_location_updated_at||null,
      geocodeStatus:r.geocode_status||null,
      geocodeProvider:r.geocode_provider||null,
      geocodePrecision:r.geocode_precision||null,
      geocodeVerificationStatus:r.geocode_verification_status||null,
      geocodeComparisonDistanceMeters:r.geocode_comparison_distance_meters==null?null:Number(r.geocode_comparison_distance_meters),
      geocodeCandidateLat:r.geocode_candidate_latitude==null?undefined:Number(r.geocode_candidate_latitude),
      geocodeCandidateLng:r.geocode_candidate_longitude==null?undefined:Number(r.geocode_candidate_longitude),
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

  function renderLoadedLeadShell(){
    const calls=[
      ['dashboard',()=>typeof renderDashboard==='function'&&renderDashboard()],
      ['teams',()=>typeof renderTeams==='function'&&renderTeams()],
      ['stats',()=>typeof renderStats==='function'&&renderStats()],
      ['activities',()=>typeof renderActivities==='function'&&renderActivities()],
      ['efficiency',()=>typeof renderEfficiency==='function'&&renderEfficiency()],
      ['field lead select',()=>typeof renderFieldLeadSelect==='function'&&renderFieldLeadSelect()]
    ];
    for(const [label,fn] of calls){try{fn();}catch(error){console.error(`Real lead ${label} render failed`,error);}}
  }

  function setLeadLoadStatus(text,error=false){
    let status=document.getElementById('leadLoadStatus');
    const bar=document.getElementById('leadModeBar');
    if(!status&&bar){status=document.createElement('div');status.id='leadLoadStatus';status.className='muted small';status.setAttribute('role','status');status.setAttribute('aria-live','polite');bar.insertAdjacentElement('afterend',status);}
    if(status){status.textContent=text;status.style.color=error?'#991b1b':'';}
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
    renderLoadedLeadShell();
    if(!real.length){const select=document.getElementById('fieldLeadSelect');if(select){const option=document.createElement('option');option.value='';option.textContent='No real leads are available';select.replaceChildren(option);}}
    const detail={count:real.length,batchId:result.batchId,total:result.total,partial};
    window.MCCOY_LAST_LEAD_LOAD_PHASE={phase:partial?'partial_rendered':'final_rendered',count:real.length,total:result.total};
    if(partial){setLeadLoadStatus(`Loading real leads: ${real.length.toLocaleString()} of ${result.total.toLocaleString()} received.`);const progress=document.getElementById('geocodeProgress');if(progress)progress.textContent=`Loading leads… ${real.length.toLocaleString()} of ${result.total.toLocaleString()} ready.`;window.dispatchEvent(new CustomEvent('mccoy-real-leads-progress',{detail}));}
    else{setLeadLoadStatus(`Real leads loaded: ${real.length.toLocaleString()} of ${result.total.toLocaleString()}.`);window.dispatchEvent(new CustomEvent('mccoy-real-leads-loaded',{detail}));}
    window.MCCOY_RENDER_LEAD_MAP?.(false);
    return real;
  }

  async function performLoad(attemptNumber=1){
    const {data:{user}}=await sb.auth.getUser();
    if(!user)throw new Error('No authenticated user');
    const access=await waitForActiveAccess();
    if(!access)throw new Error('Account access did not finish loading');
    if(access.role!=='admin'){state.demoLeads=[];state.realLeads=state.realLeads||[];state.leadMode='real';state.leads=state.realLeads;if(!state.realLeads.length)renderLoadedLeadShell();}

    setLeadLoadStatus('Loading real leads…');
    const started=typeof performance!=='undefined'?performance.now():Date.now();
    const result=await loadRealLeadRowsFromServer(preview=>applyLoadedResult(preview,{partial:true}),attemptNumber);
    const real=applyLoadedResult(result);startupComplete=true;const elapsed=Math.round((typeof performance!=='undefined'?performance.now():Date.now())-started);
    window.MCCOY_LAST_LEAD_LOAD={count:real.length,total:result.total,elapsed_ms:elapsed,page_size:4000};
    const missing=real.filter(l=>!Number.isFinite(Number(l.lat))||!Number.isFinite(Number(l.lng))).length;
    console.log(`McCoy Real Lead Pool loaded through lead-admin: ${real.length}/${result.total} leads; ${missing} awaiting verified placement.`);
    if(attemptNumber>1&&real.length===result.total)setLeadLoadStatus(`Real leads loaded: ${real.length.toLocaleString()} of ${result.total.toLocaleString()} (recovered after ${attemptNumber-1} retry${attemptNumber-1===1?'':'ies'} -- see window.MCCOY_LEAD_LOAD_DIAGNOSTICS for what failed).`);
    return real;
  }

  async function loadMcCoyLeads(){
    if(loadPromise)return loadPromise;
    loadPromise=(async()=>{
      resetLeadLoadDiagnostics();
      let lastErr=null;
      for(let attempt=1;attempt<=5;attempt++){
        try{return await performLoad(attempt);}
        catch(e){
          lastErr=e;
          console.warn(`Real lead server load attempt ${attempt} failed`,e);
          if(attempt<5)await sleep(1000*attempt);
        }
      }
      console.error('Real lead server load failed',lastErr);
      const genericMessage=lastErr?.message||String(lastErr);
      const diagnosticSummary=summarizeLeadLoadFailure();
      const message=diagnosticSummary?`${genericMessage} -- ${diagnosticSummary}`:genericMessage;
      window.MCCOY_LAST_LEAD_LOAD={count:0,total:0,page_size:4000,error:message};
      window.MCCOY_LAST_LEAD_LOAD_PHASE={phase:'error',count:0,total:0,error:message};
      setLeadLoadStatus(`Lead load error: ${message}`,true);
      window.dispatchEvent(new CustomEvent('mccoy-real-leads-load-error',{detail:{message}}));
      return [];
    })();
    try{return await loadPromise;}finally{loadPromise=null;}
  }

  window.loadMcCoyLeads=loadMcCoyLeads;
  window.MCCOY_RESOLVE_MISSING_LEAD_LOCATIONS=()=>Promise.resolve({ok:false,reason:'admin_google_verification_required'});
  function scheduleInitialLoad(delay=0){if(startupComplete||loadPromise)return;clearTimeout(startupTimer);startupTimer=setTimeout(()=>{if(!startupComplete&&!loadPromise)loadMcCoyLeads();},delay);}
  sb.auth.onAuthStateChange((_event,session)=>{if(session)scheduleInitialLoad(60);});
  window.addEventListener('mccoy-access-ready',()=>scheduleInitialLoad(0));
  window.addEventListener('load',()=>scheduleInitialLoad(120));
  scheduleInitialLoad(450);
})();