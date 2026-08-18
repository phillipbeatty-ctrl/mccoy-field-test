/*
McCoy SPOTIO Capture Helper
Run only from the browser DevTools Console while signed into https://app.spotio2.com/.
It captures likely lead/pipeline/map JSON responses while you browse SPOTIO and downloads them locally.
It deliberately ignores URLs containing auth/login/token/session/password terms.
*/
(()=>{
  if(window.MCCOY_SPOTIO_CAPTURE){console.log('McCoy SPOTIO capture is already running.');return;}
  const captures=[];
  const startedAt=new Date().toISOString();
  const include=/(lead|pipeline|map|pin|territor|customer|contact|record|prospect|address)/i;
  const exclude=/(auth|login|token|session|password|credential|refresh)/i;
  const safeUrl=(u)=>{try{const s=String(u||'');return include.test(s)&&!exclude.test(s);}catch{return false;}};
  const add=(url,status,data)=>{
    if(!safeUrl(url))return;
    try{
      const serialized=JSON.stringify(data);
      if(serialized.length>5_000_000)return;
      captures.push({captured_at:new Date().toISOString(),url:String(url),status:Number(status||0),data});
      console.log('[McCoy SPOTIO] captured',url,'total:',captures.length);
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
    preview:()=>captures,
    clear:()=>{captures.length=0;console.log('[McCoy SPOTIO] capture cleared');},
    download:()=>{
      const payload={source:'spotio_browser_capture',source_origin:location.origin,started_at:startedAt,finished_at:new Date().toISOString(),captures};
      const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
      const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='spotio-mccoy-capture-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json';document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},1000);
      console.log('[McCoy SPOTIO] downloaded',captures.length,'captured responses.');
    }
  };
  window.MCCOY_SPOTIO_CAPTURE=api;
  console.log('%cMcCoy SPOTIO capture started','font-weight:bold;color:#166534');
  console.log('Now browse/open your lead list, pipeline, map, territories, and scroll through leads so SPOTIO loads them.');
  console.log('When finished run: MCCOY_SPOTIO_CAPTURE.download()');
})();
