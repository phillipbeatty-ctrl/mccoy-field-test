// Compatibility and fail-closed guard for McCoy SPOTIO imports.
(()=>{
  if(window.MCCOY_SPOTIO_IMPORT_COMPAT?.installed)return;
  const ENDPOINT='/functions/v1/spotio-import';
  const originalFetch=window.fetch.bind(window);
  const version='20260831.1';

  const responseJson=(body,status=200)=>new Response(JSON.stringify(body),{
    status,
    headers:{'Content-Type':'application/json','Cache-Control':'no-store'}
  });
  const requestUrl=input=>typeof input==='string'?input:String(input?.url||'');
  const requestBody=init=>{
    if(typeof init?.body!=='string')return null;
    try{return JSON.parse(init.body);}catch{return null;}
  };
  const positiveNumber=value=>{
    const number=Number(value);
    return Number.isFinite(number)&&number>0?number:null;
  };
  function captureSummaries(body){
    const metadata=body?.metadata||{};
    const summaries=[];
    if(metadata.summary&&typeof metadata.summary==='object')summaries.push(metadata.summary);
    for(const source of Array.isArray(metadata.source_files)?metadata.source_files:[]){
      if(source?.summary&&typeof source.summary==='object')summaries.push(source.summary);
    }
    return summaries;
  }
  function incompleteCapture(body){
    if(body?.action!=='init')return null;
    const summaries=captureSummaries(body);
    if(!summaries.length)return null;
    const expected=Math.max(0,...summaries.map(summary=>positiveNumber(summary.expected_leads)||0));
    const captured=positiveNumber(body.record_count)||0;
    const explicitlyComplete=summaries.some(summary=>summary.complete===true);
    const explicitlyIncomplete=summaries.some(summary=>summary.complete===false);
    if(!expected||explicitlyComplete||!explicitlyIncomplete||captured>=expected)return null;
    return {expected,captured,missing:Math.max(0,expected-captured)};
  }
  async function postAction(url,init,body,action,extra={}){
    const response=await originalFetch(url,{...init,body:JSON.stringify({...body,...extra,action})});
    const data=await response.clone().json().catch(()=>({}));
    return {response,data};
  }
  async function runLegacyChunkedNormalization(url,init,body){
    const prepared=await postAction(url,init,body,'prepare_normalization');
    if(!prepared.response.ok)return prepared.response;
    const total=Math.max(0,Number(prepared.data.total)||0);
    const chunkSize=Math.max(1,Math.min(500,Number(prepared.data.chunk_size)||250));
    let offset=0;
    while(offset<total){
      const normalized=await postAction(url,init,body,'normalize_chunk',{offset,limit:chunkSize});
      if(!normalized.response.ok)return normalized.response;
      const next=Number(normalized.data.next_offset);
      if(!Number.isFinite(next)||next<=offset){
        return responseJson({error:'chunked_normalization_stalled',detail:`Normalization stopped at source row ${offset+1}.`},500);
      }
      offset=next;
    }
    const completed=await postAction(url,init,body,'complete_normalization');
    return completed.response;
  }

  window.fetch=async(input,init)=>{
    const url=requestUrl(input);
    const body=requestBody(init);
    if(!url.includes(ENDPOINT)||!body?.action)return originalFetch(input,init);

    const incomplete=incompleteCapture(body);
    if(incomplete){
      return responseJson({
        error:'incomplete_spotio_capture',
        detail:`SPOTIO capture is incomplete: ${incomplete.captured.toLocaleString()} lead rows were available, but SPOTIO reported ${incomplete.expected.toLocaleString()} expected. Rerun the capture until it reports complete, or upload all split capture files together. No import batch was created.`,
        ...incomplete
      },422);
    }

    if(body.action==='normalize'){
      return runLegacyChunkedNormalization(url,init,body);
    }
    return originalFetch(input,init);
  };

  window.MCCOY_SPOTIO_IMPORT_COMPAT={installed:true,version};
})();
