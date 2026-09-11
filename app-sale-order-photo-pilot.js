// Admin-only controlled 30-50 screenshot extraction pilot.
// Images are private, must be redacted, expire after 45 days, and never modify sales.
(function(){
  if(window.MCCOY_SALE_ORDER_PHOTO_PILOT)return;
  window.MCCOY_SALE_ORDER_PHOTO_PILOT=true;

  const fallbackProviders=['Quantum','Brightspeed','AT&T','T-Mobile / T-Fiber','Kinetic','Fidium','Ziply','Ascend Fiber','Lightcurve','Ripple Fiber','Starlink','DIRECTV','Vivint','Other'];
  const fieldDefinitions=[
    ['customer_name','Customer name','text'],
    ['service_address','Address','text'],
    ['provider_order_number','Order number','text'],
    ['provider_account_number','Account number','text'],
    ['order_date','Order date','date'],
    ['install_date','Install date','date'],
    ['internet_speed_mbps','Internet speed Mbps','number'],
    ['isp','Provider','provider']
  ];
  const state={rows:[],summary:null,loading:false};
  const byId=id=>document.getElementById(id);
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const isAdmin=()=>window.MCCOY_ACCESS?.access?.role==='admin';

  function providers(){
    const source=byId('sessionIsp');
    const values=source?[...source.options].map(option=>String(option.value||option.textContent||'').trim()).filter(Boolean):fallbackProviders;
    return [...new Set(values.length?values:fallbackProviders)];
  }
  function providerOptions(current=''){
    const values=providers(),selected=String(current||'');
    const legacy=selected&&!values.includes(selected)?`<option value="${esc(selected)}" selected>${esc(selected)} · current</option>`:'';
    return `<option value="">Choose provider…</option>${legacy}${values.map(value=>`<option value="${esc(value)}" ${value===selected?'selected':''}>${esc(value)}</option>`).join('')}`;
  }
  function percent(value){return value==null?'—':`${Math.round(Number(value)*100)}%`;}
  function statusLabel(value){return String(value||'uploaded').replaceAll('_',' ');}
  function extractedValue(row,key){
    const x=row.extracted_fields||{};
    if(key==='customer_name')return x.customer_name||[x.customer_first_name,x.customer_last_name].filter(Boolean).join(' ');
    return x[key];
  }

  const style=document.createElement('style');
  style.textContent=`
    #saleOrderPhotoPilot{margin-top:16px;border:1px solid #c4b5fd;background:#faf5ff}.pilot-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap}.pilot-stats{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:9px;margin:12px 0}.pilot-stat{padding:10px;border:1px solid #ddd6fe;border-radius:10px;background:#fff}.pilot-stat span{display:block;font-size:11px;color:#6b7280}.pilot-stat strong{display:block;font-size:20px;margin-top:4px}.pilot-upload{display:grid;grid-template-columns:1fr 1.2fr;gap:10px;padding:12px;border:1px solid #ddd6fe;border-radius:12px;background:#fff}.pilot-upload label{display:grid;gap:5px;font-size:12px;font-weight:800}.pilot-upload input,.pilot-upload select{padding:9px;border:1px solid #d1d5db;border-radius:8px;background:#fff}.pilot-attestation{grid-column:1/-1;display:flex!important;grid-template-columns:auto 1fr!important;align-items:flex-start;gap:8px!important;font-weight:600!important}.pilot-attestation input{margin-top:2px}.pilot-upload-actions{grid-column:1/-1;display:flex;align-items:center;gap:9px;flex-wrap:wrap}.pilot-summary-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px}.pilot-table{width:100%;border-collapse:collapse}.pilot-table th,.pilot-table td{text-align:left;padding:7px;border-bottom:1px solid #ede9fe;font-size:12px}.pilot-list{display:grid;gap:12px;margin-top:14px}.pilot-sample{padding:12px;border:1px solid #ddd6fe;border-radius:12px;background:#fff}.pilot-sample-head{display:flex;justify-content:space-between;gap:10px;align-items:flex-start;flex-wrap:wrap}.pilot-sample-grid{display:grid;grid-template-columns:minmax(190px,280px) 1fr;gap:12px;margin-top:10px}.pilot-sample img{display:block;width:100%;max-height:300px;object-fit:contain;border-radius:8px;background:#f8fafc}.pilot-fields{display:grid;gap:8px}.pilot-field{display:grid;grid-template-columns:1fr 1fr auto;gap:8px;align-items:end}.pilot-field label{display:grid;gap:4px;font-size:11px;font-weight:800}.pilot-field input,.pilot-field select{padding:8px;border:1px solid #d1d5db;border-radius:8px;background:#fff;min-width:0}.pilot-extracted{padding:8px;border:1px solid #e5e7eb;border-radius:8px;background:#f8fafc;font-size:11px;min-height:34px}.pilot-result{font-size:10px;font-weight:900;padding:4px 7px;border-radius:999px;white-space:nowrap}.pilot-match{background:#dcfce7;color:#166534}.pilot-mismatch,.pilot-missing{background:#fee2e2;color:#991b1b}.pilot-not-scored{background:#f3f4f6;color:#6b7280}.pilot-sample-actions{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap;margin-top:10px}.pilot-danger{background:#b91c1c!important;color:#fff!important}.pilot-warning{padding:10px;border:1px solid #fecaca;border-radius:8px;background:#fff1f2;color:#991b1b;font-size:12px}@media(max-width:900px){.pilot-stats{grid-template-columns:repeat(2,minmax(0,1fr))}.pilot-summary-grid,.pilot-sample-grid{grid-template-columns:1fr}}@media(max-width:650px){.pilot-upload{grid-template-columns:1fr}.pilot-field{grid-template-columns:1fr}.pilot-attestation,.pilot-upload-actions{grid-column:auto}}
  `;
  document.head.appendChild(style);

  function ensure(){
    if(!isAdmin()||byId('saleOrderPhotoPilot'))return;
    const settings=byId('settings');if(!settings)return;
    const card=document.createElement('div');
    card.id='saleOrderPhotoPilot';card.className='card';
    card.innerHTML=`
      <div class="pilot-head"><div><h2 style="margin:0">ORDER PHOTO EXTRACTION PILOT</h2><p class="muted" style="margin:5px 0 0">Collect 30–50 real, redacted provider screenshots. Enter independent ground truth and measure each field separately. Pilot samples never modify sales, rankings, Customer List, or Admin approval.</p></div><button id="pilotRefresh" type="button" class="assign-btn">Refresh</button></div>
      <div id="pilotStats" class="pilot-stats"></div>
      <div class="pilot-upload"><label>Declared provider<select id="pilotProvider">${providerOptions()}</select></label><label>Redacted screenshot<input id="pilotFile" type="file" accept="image/jpeg,image/png,image/webp" capture="environment"></label><label class="pilot-attestation"><input id="pilotRedaction" type="checkbox"><span>I confirm this screenshot is redacted and contains no Social Security number, full payment-card number, password, PIN, security answer, or provider-login credential.</span></label><div class="pilot-upload-actions"><button id="pilotUpload" type="button" class="primary">UPLOAD & EXTRACT</button><span id="pilotMessage" class="muted small" role="status" aria-live="polite">No pilot samples loaded.</span></div></div>
      <div id="pilotSummary" class="pilot-summary-grid"></div>
      <div id="pilotSamples" class="pilot-list"></div>`;
    settings.appendChild(card);
    byId('pilotRefresh').onclick=()=>load(true);
    byId('pilotUpload').onclick=upload;
    load(true);
  }

  async function invoke(action,payload={}){
    const {data,error}=await sb.functions.invoke('sale-order-photo-pilot',{body:{action,...payload}});
    if(error||!data?.ok)throw new Error(data?.error||error?.message||'pilot_request_failed');
    return data;
  }

  function renderSummary(){
    const summary=state.summary||{};
    const stats=byId('pilotStats');if(!stats)return;
    stats.innerHTML=`<div class="pilot-stat"><span>Samples</span><strong>${Number(summary.sample_count||0)} / ${Number(summary.minimum_samples||30)}</strong></div><div class="pilot-stat"><span>Scored</span><strong>${Number(summary.scored_samples||0)}</strong></div><div class="pilot-stat"><span>Providers</span><strong>${Number(summary.provider_count||0)}</strong></div><div class="pilot-stat"><span>Blocked sensitive</span><strong>${Number(summary.blocked_sensitive_samples||0)}</strong></div><div class="pilot-stat"><span>Decision ready</span><strong>${summary.ready_for_decision?'YES':'NO'}</strong></div>`;
    const fieldRows=fieldDefinitions.map(([key,label])=>{const metric=summary.fields?.[key]||{};return `<tr><td>${esc(label)}</td><td>${Number(metric.correct||0)} / ${Number(metric.scored||0)}</td><td>${percent(metric.accuracy)}</td></tr>`;}).join('');
    const providerRows=(summary.providers||[]).map(row=>`<tr><td>${esc(row.provider)}</td><td>${Number(row.samples||0)}</td><td>${Number(row.scored||0)}</td><td>${Number(row.blocked||0)}</td></tr>`).join('')||'<tr><td colspan="4">No provider samples yet.</td></tr>';
    const core=summary.core_provider_coverage||{};
    byId('pilotSummary').innerHTML=`<div><h3 style="margin:0 0 6px">Field accuracy</h3><table class="pilot-table"><thead><tr><th>Field</th><th>Correct / scored</th><th>Accuracy</th></tr></thead><tbody>${fieldRows}</tbody></table></div><div><h3 style="margin:0 0 6px">Provider coverage</h3><div class="muted small" style="margin-bottom:6px">Quantum ${core.quantum?'✓':'—'} · Brightspeed ${core.brightspeed?'✓':'—'} · AT&T ${core.att?'✓':'—'} · Include at least one additional active provider.</div><table class="pilot-table"><thead><tr><th>Provider</th><th>Samples</th><th>Scored</th><th>Blocked</th></tr></thead><tbody>${providerRows}</tbody></table></div>`;
  }

  function resultBadge(result){
    const status=String(result?.status||'not_scored');
    const cls=status==='match'?'pilot-match':status==='mismatch'?'pilot-mismatch':status==='missing'?'pilot-missing':'pilot-not-scored';
    return `<span class="pilot-result ${cls}">${esc(status.replaceAll('_',' '))}</span>`;
  }
  function truthControl(row,key,type){
    const value=row.ground_truth?.[key]??'';
    if(type==='provider')return `<select data-pilot-truth="${key}">${providerOptions(value)}</select>`;
    return `<input data-pilot-truth="${key}" type="${type}" value="${esc(value)}" ${type==='number'?'min="0" step="1"':''}>`;
  }

  function renderSamples(){
    const root=byId('pilotSamples');if(!root)return;
    if(!state.rows.length){root.innerHTML='<div class="muted">No pilot screenshots have been uploaded.</div>';return;}
    root.innerHTML=state.rows.map((row,index)=>{
      const blocked=row.extraction_status==='blocked_sensitive';
      const failed=row.extraction_status==='failed';
      const fields=fieldDefinitions.map(([key,label,type])=>`<div class="pilot-field"><label>${esc(label)}${truthControl(row,key,type)}</label><div class="pilot-extracted"><strong>Extracted:</strong> ${esc(extractedValue(row,key)??'—')}</div>${resultBadge(row.field_results?.[key])}</div>`).join('');
      return `<article class="pilot-sample" data-pilot-sample="${esc(row.id)}"><div class="pilot-sample-head"><div><strong>#${state.rows.length-index} · ${esc(row.provider)}</strong><div class="muted small">${esc(new Date(row.created_at).toLocaleString())} · ${esc(statusLabel(row.extraction_status))} · confidence ${percent(row.extracted_fields?.confidence)} · expires ${esc(new Date(row.expires_at).toLocaleDateString())}</div></div><button type="button" class="assign-btn pilot-danger" data-pilot-delete="${esc(row.id)}">DELETE SAMPLE</button></div><div class="pilot-sample-grid"><div>${row.signed_url?`<a href="${esc(row.signed_url)}" target="_blank" rel="noopener"><img src="${esc(row.signed_url)}" alt="Redacted provider screenshot pilot sample"></a>`:'<div class="muted">Preview unavailable.</div>'}${Array.isArray(row.extracted_fields?.warnings)&&row.extracted_fields.warnings.length?`<div class="pilot-warning" style="margin-top:8px">Warnings: ${esc(row.extracted_fields.warnings.join('; '))}</div>`:''}</div><div>${blocked?`<div class="pilot-warning"><strong>Sensitive data detected.</strong> Delete this sample and upload a properly redacted replacement. It cannot be scored.</div>`:failed?`<div class="pilot-warning"><strong>Extraction failed.</strong> ${esc(row.extraction_error||'Retry the sample.')}</div>`:`<div class="muted small" style="margin-bottom:8px">Enter independent ground truth from the screenshot. Leave a field blank only when that field is not visibly present; blank fields are excluded from that field’s denominator.</div><div class="pilot-fields">${fields}</div>`}<div class="pilot-sample-actions">${failed?`<button type="button" class="assign-btn" data-pilot-reprocess="${esc(row.id)}">REPROCESS</button>`:''}${!blocked&&!failed?`<button type="button" class="primary" data-pilot-score="${esc(row.id)}">SAVE GROUND TRUTH & SCORE</button>`:''}</div></div></div></article>`;
    }).join('');
  }

  async function load(force=false){
    if(state.loading&&!force)return;state.loading=true;
    const message=byId('pilotMessage');if(message)message.textContent='Loading pilot…';
    try{const data=await invoke('list');state.rows=data.rows||[];state.summary=data.summary||{};renderSummary();renderSamples();if(message)message.textContent=state.summary.ready_for_decision?'Pilot minimum and provider coverage reached. Review field accuracy before deciding.':`${state.summary.remaining_to_minimum||0} more sample${state.summary.remaining_to_minimum===1?'':'s'} to reach the 30-sample minimum.`;}
    catch(error){if(message)message.textContent=error?.message||'Unable to load pilot.';}
    finally{state.loading=false;}
  }

  async function upload(){
    const provider=byId('pilotProvider')?.value,file=byId('pilotFile')?.files?.[0],confirmed=byId('pilotRedaction')?.checked===true,button=byId('pilotUpload'),message=byId('pilotMessage');
    if(!provider){message.textContent='Choose the provider shown in the screenshot.';return;}
    if(!file){message.textContent='Choose one redacted screenshot.';return;}
    if(!confirmed){message.textContent='Confirm the redaction attestation before upload.';return;}
    if(!['image/jpeg','image/png','image/webp'].includes(file.type)){message.textContent='Use a JPEG, PNG, or WebP image.';return;}
    if(file.size>10485760){message.textContent='Screenshot must be 10 MB or less.';return;}
    button.disabled=true;button.textContent='UPLOADING…';message.textContent='Creating private signed upload…';
    try{
      const created=await invoke('create_upload',{provider,mime_type:file.type,file_size_bytes:file.size,redaction_confirmed:true,redaction_attestation:'Admin confirms this pilot screenshot is redacted and contains no prohibited sensitive credentials or financial identifiers.'});
      const upload=await sb.storage.from('sale-order-photo-pilot').uploadToSignedUrl(created.path,created.token,file,{contentType:file.type});
      if(upload.error)throw upload.error;
      message.textContent='Uploaded privately. Extracting visible fields…';
      const processed=await invoke('process',{sample_id:created.sample_id});
      if(processed.extraction_status==='blocked_sensitive')message.textContent='Sensitive data was detected. Delete the sample and upload a properly redacted replacement.';
      else message.textContent='Extraction complete. Enter independent ground truth and score the sample.';
      byId('pilotFile').value='';byId('pilotRedaction').checked=false;
      await load(true);
    }catch(error){message.textContent=error?.message||'Pilot upload or extraction failed.';}
    finally{button.disabled=false;button.textContent='UPLOAD & EXTRACT';}
  }

  async function score(button){
    const sample=button.closest('[data-pilot-sample]'),id=sample?.dataset.pilotSample,message=byId('pilotMessage');if(!id)return;
    const truth={};sample.querySelectorAll('[data-pilot-truth]').forEach(input=>{truth[input.dataset.pilotTruth]=input.value;});
    button.disabled=true;button.textContent='SCORING…';
    try{const data=await invoke('score',{sample_id:id,ground_truth:truth});state.summary=data.summary||state.summary;message.textContent='Ground truth saved. Field accuracy recalculated.';await load(true);}
    catch(error){message.textContent=error?.message||'Unable to score this sample.';button.disabled=false;button.textContent='SAVE GROUND TRUTH & SCORE';}
  }
  async function reprocess(button){
    const id=button.dataset.pilotReprocess,message=byId('pilotMessage');button.disabled=true;button.textContent='PROCESSING…';
    try{await invoke('reprocess',{sample_id:id});message.textContent='Sample reprocessed.';await load(true);}catch(error){message.textContent=error?.message||'Unable to reprocess sample.';button.disabled=false;button.textContent='REPROCESS';}
  }
  async function deleteSample(button){
    const id=button.dataset.pilotDelete,message=byId('pilotMessage');
    if(button.dataset.confirm!=='1'){button.dataset.confirm='1';button.textContent='CLICK AGAIN TO DELETE';return;}
    button.disabled=true;button.textContent='DELETING…';
    try{await invoke('delete',{sample_id:id});message.textContent='Pilot sample and private image permanently deleted.';await load(true);}catch(error){message.textContent=error?.message||'Unable to delete sample.';button.disabled=false;button.textContent='DELETE SAMPLE';}
  }

  document.addEventListener('click',event=>{
    const scoreButton=event.target?.closest?.('[data-pilot-score]');if(scoreButton){score(scoreButton);return;}
    const reprocessButton=event.target?.closest?.('[data-pilot-reprocess]');if(reprocessButton){reprocess(reprocessButton);return;}
    const deleteButton=event.target?.closest?.('[data-pilot-delete]');if(deleteButton){deleteSample(deleteButton);return;}
    if(event.target?.closest?.('.nav-btn[data-view="settings"]'))setTimeout(()=>{ensure();load(true);},150);
  });
  window.addEventListener('mccoy-access-ready',()=>setTimeout(ensure,150));
  let attempts=0;const timer=setInterval(()=>{attempts++;ensure();if(byId('saleOrderPhotoPilot')||attempts>=40)clearInterval(timer);},250);
})();
