/*
McCoy SPOTIO Capture Helper
Run only from the browser DevTools Console while signed into https://app.spotio2.com/.
Captures lead-related JSON responses already delivered to the authenticated SPOTIO page.
*/
(()=>{
  if(window.MCCOY_SPOTIO_CAPTURE){console.log('McCoy SPOTIO capture is already running.');return;}
  const captures=[];
  const leadIds=new Set();
  let expectedLeadCount=null;
  const startedAt=new Date().toISOString();
  const include=/(lead|pipeline|map|pin|territor|customer|contact|record|prospect|address|dataobjectssearch)/i;
  const exclude=/(auth|login|token|session|password|credential|refresh)/i;
  const safeUrl=(u)=>{try{const s=String(u||'');return include.test(s)&&!exclude.test(s);}catch{return false;}};
  const inspectLeadPage=(url,data)=>{
    try{
      if(!String(url||'').includes('/api/dataobjectssearch/list'))return;
      if(Number.isFinite(Number(data?.totalCount)))expectedLeadCount=Math.max(expectedLeadCount||0,Number(data.totalCount));
      if(Array.isArray(data?.items)) for(const item of data.items) if(item?.id) leadIds.add(String(item.id));
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
  const api={
    count:()=>captures.length,
    leadCount:()=>leadIds.size,
    expectedLeadCount:()=>expectedLeadCount,
    status:()=>({capturedResponses:captures.length,uniqueLeads:leadIds.size,expectedLeads:expectedLeadCount,complete:!!expectedLeadCount&&leadIds.size>=expectedLeadCount}),
    preview:()=>captures,
    clear:()=>{captures.length=0;leadIds.clear();expectedLeadCount=null;console.log('[McCoy SPOTIO] capture cleared');},
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
  console.log('Open the actual SPOTIO lead list and scroll through it so each page of leads loads.');
  console.log('Check progress with: MCCOY_SPOTIO_CAPTURE.status()');
  console.log('Download when uniqueLeads equals expectedLeads: MCCOY_SPOTIO_CAPTURE.download()');
})();
