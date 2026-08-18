/*
McCoy SPOTIO Capture Helper
Run only while signed into https://app.spotio2.com/.
Captures lead-related JSON and can page the authenticated SPOTIO lead-list endpoint until all leads are collected.
*/
(()=>{
  if(window.MCCOY_SPOTIO_CAPTURE){console.log('McCoy SPOTIO capture is already running.');return;}
  const captures=[];
  const leadIds=new Set();
  let expectedLeadCount=null;
  let bestListUrl=null;
  let bestFirstPageIds=[];
  const startedAt=new Date().toISOString();
  const include=/(lead|pipeline|map|pin|territor|customer|contact|record|prospect|address|dataobjectssearch)/i;
  const exclude=/(auth|login|token|session|password|credential|refresh)/i;
  const safeUrl=(u)=>{try{const s=String(u||'');return include.test(s)&&!exclude.test(s);}catch{return false;}};
  const inspectLeadPage=(url,data)=>{
    try{
      if(!String(url||'').includes('/api/dataobjectssearch/list'))return;
      const total=Number(data?.totalCount||0);
      const ids=Array.isArray(data?.items)?data.items.map(x=>x?.id).filter(Boolean).map(String):[];
      if(total && (!expectedLeadCount || total>=expectedLeadCount)){
        expectedLeadCount=total;
        bestListUrl=String(url);
        bestFirstPageIds=ids;
      }
      for(const id of ids)leadIds.add(id);
      console.log(`[McCoy SPOTIO] lead progress ${leadIds.size}${expectedLeadCount?` / ${expectedLeadCount}`:''}`);
    }catch{}
  };
  const add=(url,status,data)=>{
    if(!safeUrl(url))return;
    try{
      const serialized=JSON.stringify(data);
      if(serialized.length>5_000_000)return;
      captures.push({captured_at:new Date().toISOString(),url:String(url),status:Number(status||0),data});
      inspectLeadPage(url,data);
    }catch{}
  };
  const originalFetch=window.fetch.bind(window);
  window.fetch=async(...args)=>{
    const res=await originalFetch(...args);
    try{
      const url=typeof args[0]==='string'?args[0]:args[0]?.url;
      if(safeUrl(url)){
        const clone=res.clone();
        const ct=clone.headers.get('content-type')||'';
        if(ct.includes('json'))add(url,clone.status,await clone.json());
      }
    }catch(e){console.debug('[McCoy SPOTIO] fetch capture skipped',e);}
    return res;
  };
  const OrigXHR=window.XMLHttpRequest;
  const origOpen=OrigXHR.prototype.open,origSend=OrigXHR.prototype.send;
  OrigXHR.prototype.open=function(method,url,...rest){this.__mccoyUrl=url;return origOpen.call(this,method,url,...rest);};
  OrigXHR.prototype.send=function(...args){
    this.addEventListener('load',function(){try{if(!safeUrl(this.__mccoyUrl))return;const ct=this.getResponseHeader('content-type')||'';if(ct.includes('json')||typeof this.response==='object'){const data=typeof this.response==='string'?JSON.parse(this.response):this.response;add(this.__mccoyUrl,this.status,data);}}catch{}});
    return origSend.apply(this,args);
  };
  const wait=(ms)=>new Promise(r=>setTimeout(r,ms));
  const pageUrl=(base,strategy,page,size)=>{
    const u=new URL(base,location.origin);
    const offset=(page-1)*size;
    const setters={
      skip_take:()=>{u.searchParams.set('skip',String(offset));u.searchParams.set('take',String(size));},
      offset_limit:()=>{u.searchParams.set('offset',String(offset));u.searchParams.set('limit',String(size));},
      page_pagesize:()=>{u.searchParams.set('page',String(page));u.searchParams.set('pageSize',String(size));},
      page_limit:()=>{u.searchParams.set('page',String(page));u.searchParams.set('limit',String(size));},
      pageindex_pagesize:()=>{u.searchParams.set('pageIndex',String(page-1));u.searchParams.set('pageSize',String(size));},
      start_limit:()=>{u.searchParams.set('start',String(offset));u.searchParams.set('limit',String(size));}
    };
    setters[strategy]();
    return u.pathname+u.search;
  };
  const fetchJson=async(url)=>{
    const res=await originalFetch(url,{credentials:'include'});
    if(!res.ok)throw new Error(`SPOTIO returned ${res.status} for ${url}`);
    const data=await res.json();
    add(url,res.status,data);
    return data;
  };
  const detectPagination=async()=>{
    if(!bestListUrl)throw new Error('Open the SPOTIO lead list once so McCoy can learn the authenticated list endpoint.');
    const size=50, first=new Set(bestFirstPageIds);
    const strategies=['skip_take','offset_limit','page_pagesize','page_limit','pageindex_pagesize','start_limit'];
    for(const strategy of strategies){
      try{
        const url=pageUrl(bestListUrl,strategy,2,size);
        const data=await fetchJson(url);
        const ids=Array.isArray(data?.items)?data.items.map(x=>String(x?.id||'')).filter(Boolean):[];
        const newIds=ids.filter(id=>!first.has(id));
        if(ids.length && newIds.length){
          console.log(`[McCoy SPOTIO] pagination detected: ${strategy}`);
          return {strategy,size};
        }
      }catch(e){console.debug('[McCoy SPOTIO] pagination probe failed',strategy,e);}
      await wait(150);
    }
    throw new Error('McCoy could not automatically identify SPOTIO pagination. Open the actual lead list and scroll once, then run fetchAllLeads() again.');
  };
  const fetchAllLeads=async()=>{
    if(!bestListUrl)throw new Error('Open the actual SPOTIO lead list once before starting full capture.');
    const {strategy,size}=await detectPagination();
    const expected=expectedLeadCount||0;
    const pages=expected?Math.ceil(expected/size):200;
    console.log(`[McCoy SPOTIO] full capture started. Expected ${expected||'unknown'} leads across about ${pages} pages.`);
    for(let page=2;page<=pages;page++){
      if(expected && leadIds.size>=expected)break;
      const url=pageUrl(bestListUrl,strategy,page,size);
      const data=await fetchJson(url);
      const items=Array.isArray(data?.items)?data.items:[];
      if(!items.length)break;
      if(page%10===0||page===pages)console.log(`[McCoy SPOTIO] page ${page}/${pages} · ${leadIds.size}/${expected||'?'}`);
      await wait(175);
    }
    const complete=!!expectedLeadCount&&leadIds.size>=expectedLeadCount;
    console.log(`[McCoy SPOTIO] full capture finished: ${leadIds.size}/${expectedLeadCount||'?'} unique leads. Complete: ${complete}`);
    return api.status();
  };
  const api={
    count:()=>captures.length,
    leadCount:()=>leadIds.size,
    expectedLeadCount:()=>expectedLeadCount,
    status:()=>({capturedResponses:captures.length,uniqueLeads:leadIds.size,expectedLeads:expectedLeadCount,complete:!!expectedLeadCount&&leadIds.size>=expectedLeadCount,listEndpointReady:!!bestListUrl}),
    fetchAllLeads,
    preview:()=>captures,
    clear:()=>{captures.length=0;leadIds.clear();expectedLeadCount=null;bestListUrl=null;bestFirstPageIds=[];console.log('[McCoy SPOTIO] capture cleared');},
    download:()=>{
      const summary={captured_responses:captures.length,unique_leads:leadIds.size,expected_leads:expectedLeadCount,complete:!!expectedLeadCount&&leadIds.size>=expectedLeadCount};
      const payload={source:'spotio_browser_capture',source_origin:location.origin,started_at:startedAt,finished_at:new Date().toISOString(),summary,captures};
      const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
      const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='spotio-mccoy-capture-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json';document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},1000);
      console.log('[McCoy SPOTIO] downloaded',summary);
    }
  };
  window.MCCOY_SPOTIO_CAPTURE=api;
  console.log('%cMcCoy SPOTIO capture started','font-weight:bold;color:#166534');
  console.log('Open the actual SPOTIO lead list once. Then run: MCCOY_SPOTIO_CAPTURE.fetchAllLeads()');
  console.log('When status().complete is true, run: MCCOY_SPOTIO_CAPTURE.download()');
})();
