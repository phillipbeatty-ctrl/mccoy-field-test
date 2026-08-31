// Compatibility and fail-closed guard for McCoy SPOTIO imports.
(()=>{
  if(window.MCCOY_SPOTIO_IMPORT_COMPAT?.installed)return;
  const ENDPOINT='/functions/v1/spotio-import';
  const originalFetch=window.fetch.bind(window);
  const version='20260831.2';
  const clean=value=>String(value??'').trim().replace(/\s+/g,' ');

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
  const dateLike=value=>/^(?:[A-Z][a-z]{2}\s+\d{1,2},\s+\d{4}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\b/.test(clean(value));
  const stageLike=value=>/^(?:Prospecting(?:\s*\/\s*Keep Knocking)?|Hot Lead|Contacted|Follow[- ]?Up|Migrator|Existing Customer|SMB|Sale Made|No Sale(?: Made)?|Admin Hold)$/i.test(clean(value));
  const addressLike=value=>{
    const text=clean(value);
    if(!text||dateLike(text)||stageLike(text))return false;
    if(!/\b[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/i.test(text))return false;
    return /^(?:\d+[A-Z-]?\s+|P\.?\s*O\.?\s+BOX\s+\d+)/i.test(text);
  };
  const addressParts=value=>{
    const text=clean(value).replace(/,\s*(?:US|USA)\s*$/i,'').replace(/,\s*$/,'');
    const match=text.match(/,\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)\s*$/i);
    return {address:text,state:match?match[1].toUpperCase():'',zip:match?match[2]:''};
  };
  const findAddress=row=>{
    const direct=[row?.full_address,row?.address,row?.pin?.address];
    for(const value of direct)if(addressLike(value))return clean(value);
    const cells=Array.isArray(row?.raw_cells)?row.raw_cells:[];
    for(let index=cells.length-1;index>=0;index--)if(addressLike(cells[index]))return clean(cells[index]);
    return '';
  };
  const findUnit=(row,address)=>{
    for(const value of [row?.address2,row?.addressUnit,row?.unit,row?.suite]){
      const text=clean(value);if(text&&text!=='-')return text;
    }
    const candidates=[address,...(Array.isArray(row?.raw_cells)?row.raw_cells:[])];
    for(const value of candidates){
      const match=clean(value).match(/\b(?:APT|APARTMENT|UNIT|STE|SUITE|BLDG|BUILDING|LOT)\s*[#-]?\s*[A-Z0-9-]+\b/i);
      if(match)return clean(match[0]);
    }
    return '';
  };
  const findPhone=row=>{
    for(const value of [row?.phone,row?.phone_number,...(Array.isArray(row?.raw_cells)?row.raw_cells:[])]){
      const text=clean(value);if(!text||dateLike(text))continue;
      const digits=text.replace(/\D/g,'');
      if(digits.length===10||(digits.length===11&&digits.startsWith('1')))return digits;
    }
    return '';
  };
  function normalizeDomRow(row){
    if(!row||typeof row!=='object'||row._mccoy_dom_schema_normalized)return row;
    const cells=Array.isArray(row.raw_cells)?row.raw_cells:[];
    const address=findAddress(row);
    const parts=addressParts(address);
    const name=clean(row.name||cells[1]);
    const stage=clean(row.stage||row.status||(stageLike(row.address)?row.address:'')||cells[2]);
    const updatedAt=clean(row.updated_at||row.updatedAt||cells[3]||row.captured_at);
    const unit=findUnit(row,address);
    const phone=findPhone(row);
    const normalizedCells=Array(11).fill('');
    normalizedCells[1]=name;
    normalizedCells[2]=stage;
    normalizedCells[3]=updatedAt;
    normalizedCells[4]=parts.address;
    normalizedCells[8]=unit;
    normalizedCells[10]=phone;
    return {
      ...row,
      name:name||row.name||'',
      address:parts.address,
      full_address:parts.address,
      state:parts.state||clean(row.state).toUpperCase(),
      zip:parts.zip||clean(row.zip),
      raw_cells:normalizedCells,
      _mccoy_dom_schema_normalized:true,
      _mccoy_dom_schema_version:'address_scan_v2'
    };
  }
  function normalizeCaptureText(text,fileName=''){
    const sample=String(text||'').trimStart();
    if(!sample.startsWith('{')||(!String(fileName).toLowerCase().endsWith('.json')&&!sample.includes('"dom_leads"')))return text;
    let payload;
    try{payload=JSON.parse(text);}catch{return text;}
    if(!Array.isArray(payload?.dom_leads)||!payload.dom_leads.length)return text;
    payload.dom_leads=payload.dom_leads.map(normalizeDomRow);
    payload.mccoy_import_normalization={version:'address_scan_v2',normalized_at:new Date().toISOString(),dom_rows:payload.dom_leads.length};
    return JSON.stringify(payload);
  }
  function installFileNormalizer(){
    if(typeof File==='undefined'||!File.prototype?.text||File.prototype.text.__mccoySpotioNormalized)return;
    const originalText=File.prototype.text;
    const patched=async function(){
      const text=await originalText.call(this);
      return normalizeCaptureText(text,this?.name||'');
    };
    patched.__mccoySpotioNormalized=true;
    File.prototype.text=patched;
  }
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

  installFileNormalizer();
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

    if(body.action==='normalize')return runLegacyChunkedNormalization(url,init,body);
    return originalFetch(input,init);
  };

  window.MCCOY_SPOTIO_IMPORT_COMPAT={installed:true,version,normalizeCaptureText};
})();
