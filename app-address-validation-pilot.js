(()=>{
  const byId=id=>document.getElementById(id);
  const number=value=>Number.isFinite(Number(value))?Number(value):null;
  const meters=value=>number(value)==null?'—':`${Math.round(Number(value)).toLocaleString()} m`;
  const coordinate=value=>number(value)==null?'—':Number(value).toFixed(7);
  const yesNo=value=>value===true?'Yes':value===false?'No':'—';
  const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
  const csvCell=value=>`"${String(value??'').replace(/"/g,'""')}"`;
  let latestRows=[],latestSnapshotToken='',latestReviewRows=[];

  const columns=[
    ['original_address','Original address'],['standardized_address','Standardized address'],['place_id','Place ID'],
    ['old_latitude','Old latitude'],['old_longitude','Old longitude'],['google_latitude','Google latitude'],['google_longitude','Google longitude'],
    ['field_confirmed_latitude','Field latitude'],['field_confirmed_longitude','Field longitude'],['field_confirmation_source','Field source'],
    ['old_to_google_meters','Old → Google'],['google_to_field_meters','Google → field'],['possible_next_action','Google action'],
    ['validation_granularity','Validation granularity'],['geocode_granularity','Geocode granularity'],['usps_dpv_confirmation','USPS DPV'],['address_complete','Complete'],
    ['address_identity_match','Identity match'],['repair_decision','Repair decision'],['repair_reason','Repair reason'],
    ['api_status','API status'],['api_error','API error'],['lead_id','Lead ID']
  ];

  function setMessage(text,tone=''){
    const message=byId('addressValidationPilotMessage');if(!message)return;
    message.textContent=text;message.dataset.tone=tone;
    message.style.color=tone==='error'?'#b91c1c':tone==='ok'?'#166534':'';
  }

  function setReviewMessage(text,tone=''){
    const message=byId('addressValidationReviewMessage');if(!message)return;
    message.textContent=text;message.dataset.tone=tone;
    message.style.color=tone==='error'?'#b91c1c':tone==='ok'?'#166534':'';
  }

  function render(data){
    latestRows=Array.isArray(data?.rows)?data.rows:[];
    latestSnapshotToken=String(data?.pilot_snapshot_token||'');
    const summary=data?.summary||{},distance=summary.old_to_google_meters||{};
    byId('addressValidationPilotSummary').innerHTML=`
      <strong>${Number(summary.validated||0).toLocaleString()} of ${Number(summary.returned||0).toLocaleString()} validated</strong>
      · ${Number(summary.moved_over_25m||0).toLocaleString()} moved over 25 m
      · ${Number(summary.moved_over_50m||0).toLocaleString()} moved over 50 m
      · ${Number(summary.moved_over_100m||0).toLocaleString()} moved over 100 m
      · median ${meters(distance.median)} · p90 ${meters(distance.p90)} · max ${meters(distance.max)}
      · ${Number(summary.field_confirmed||0).toLocaleString()} field-confirmed
      · <strong>${Number(summary.automatic_repair_eligible||0).toLocaleString()} strict automatic</strong>
      · ${Number(summary.admin_review||0).toLocaleString()} Admin review
      · ${Number(summary.protected||0).toLocaleString()} protected.`;
    const body=byId('addressValidationPilotTableBody');
    body.innerHTML=latestRows.map(row=>`<tr>${columns.map(([key])=>{
      let value=row[key];
      if(key.endsWith('_latitude')||key.endsWith('_longitude'))value=coordinate(value);
      if(key.endsWith('_meters'))value=meters(value);
      if(key==='address_complete'||key==='address_identity_match')value=yesNo(value);
      return `<td>${escapeHtml(value==null||value===''?'—':value)}</td>`;
    }).join('')}</tr>`).join('');
    const raw=byId('addressValidationPilotJson');
    raw.textContent=JSON.stringify(data,null,2);
    byId('addressValidationPilotResults').style.display='block';
    byId('downloadAddressValidationPilotBtn').disabled=!latestRows.length;
    const applyButton=byId('applyAddressValidationRepairBtn');
    if(applyButton)applyButton.disabled=!(latestSnapshotToken&&Number(summary.validated||0)===100&&!Object.keys(summary.errors||{}).length&&data?.read_only===true);
  }

  function reviewRowHtml(row){
    const large=Number(row.distance_meters)>100;
    const warning=large?'Movement exceeds 100 m — verify carefully.':row.has_inferred_components?'Google inferred one or more address components.':row.has_unconfirmed_components?'Google returned an unconfirmed component.':'';
    return `<tr data-review-lead="${escapeHtml(row.lead_id)}">
      <td style="min-width:260px"><strong>${escapeHtml(row.original_address||'—')}</strong><div class="muted small">${coordinate(row.old_latitude)}, ${coordinate(row.old_longitude)}</div></td>
      <td style="min-width:260px"><strong>${escapeHtml(row.standardized_address||'—')}</strong><div class="muted small">${coordinate(row.google_latitude)}, ${coordinate(row.google_longitude)}</div><div class="muted small">Place ID: ${escapeHtml(row.place_id||'—')}</div></td>
      <td><strong>${meters(row.distance_meters)}</strong>${warning?`<div style="margin-top:4px;color:${large?'#b91c1c':'#92400e'};max-width:220px">${escapeHtml(warning)}</div>`:''}</td>
      <td>${escapeHtml(row.possible_next_action||'—')}</td>
      <td>${escapeHtml(row.validation_granularity||'—')} / ${escapeHtml(row.geocode_granularity||'—')}</td>
      <td>${escapeHtml(row.usps_dpv_confirmation||'—')}</td>
      <td>${yesNo(row.address_complete)}</td>
      <td>${yesNo(row.address_identity_match)}</td>
      <td style="max-width:240px;white-space:normal">${escapeHtml(row.repair_reason||row.repair_decision||'Admin review required')}</td>
      <td style="min-width:215px"><div style="display:flex;gap:6px;flex-wrap:wrap"><button type="button" class="assign-btn address-review-keep" data-lead-id="${escapeHtml(row.lead_id)}">KEEP ORIGINAL</button><button type="button" class="primary address-review-apply" data-lead-id="${escapeHtml(row.lead_id)}">APPLY GOOGLE PIN</button></div></td>
    </tr>`;
  }

  function renderReviewQueue(data){
    latestReviewRows=Array.isArray(data?.rows)?data.rows:[];
    const panel=byId('addressValidationReviewResults');
    const summary=byId('addressValidationReviewSummary');
    const body=byId('addressValidationReviewTableBody');
    if(!panel||!summary||!body)return;
    const large=latestReviewRows.filter(row=>Number(row.distance_meters)>100).length;
    const inferred=latestReviewRows.filter(row=>row.has_inferred_components===true).length;
    summary.innerHTML=`<strong>${latestReviewRows.length.toLocaleString()} quarantined lead${latestReviewRows.length===1?'':'s'} awaiting Admin review</strong> · ${large.toLocaleString()} move over 100 m · ${inferred.toLocaleString()} include inferred components.`;
    body.innerHTML=latestReviewRows.length?latestReviewRows.map(reviewRowHtml).join(''):'<tr><td colspan="10" style="padding:16px">No Address Validation pins are awaiting Admin review.</td></tr>';
    panel.style.display='block';
    body.querySelectorAll('.address-review-keep').forEach(button=>button.onclick=()=>decideReview(button.dataset.leadId,'keep_original'));
    body.querySelectorAll('.address-review-apply').forEach(button=>button.onclick=()=>decideReview(button.dataset.leadId,'apply_google_candidate'));
  }

  async function loadReviewQueue(){
    if(window.MCCOY_ACCESS?.access?.role!=='admin')return;
    const button=byId('loadAddressValidationReviewBtn');
    if(button){button.disabled=true;button.textContent='LOADING REVIEW QUEUE…';}
    setReviewMessage('Loading quarantined Google Address Validation candidates…');
    try{
      const {data,error}=await sb.functions.invoke('address-validation-admin-review',{body:{action:'list'}});
      if(error||!data?.ok)throw error||new Error(data?.detail||data?.error||'review_queue_failed');
      renderReviewQueue(data);
      setReviewMessage(`${Number(data?.rows?.length||0).toLocaleString()} lead${Number(data?.rows?.length||0)===1?'':'s'} ready for one-by-one Admin review.`,'ok');
    }catch(error){
      console.error('Address Validation Admin review queue failed',error);
      let detail=error?.message||String(error);try{const payload=await error?.context?.json?.();detail=payload?.detail||payload?.error||detail;}catch{}
      setReviewMessage(`Review queue stopped safely: ${detail}`,'error');
    }finally{
      if(button){button.disabled=false;button.textContent='REVIEW QUARANTINED PINS';}
    }
  }

  async function decideReview(leadId,decision){
    if(window.MCCOY_ACCESS?.access?.role!=='admin')return;
    const row=latestReviewRows.find(item=>String(item.lead_id)===String(leadId));
    if(!row)return;
    const apply=decision==='apply_google_candidate';
    const prompt=apply
      ? `Apply Google's candidate pin for ${row.original_address}?\n\nCurrent pin: ${coordinate(row.old_latitude)}, ${coordinate(row.old_longitude)}\nGoogle pin: ${coordinate(row.google_latitude)}, ${coordinate(row.google_longitude)}\nMovement: ${meters(row.distance_meters)}\n\nThis is an explicit Admin override of the automatic quarantine. The action will be audited.`
      : `Keep the original pin for ${row.original_address}?\n\nGoogle's candidate will remain in the audit record, but the lead will leave the review queue.`;
    if(!confirm(prompt))return;
    const tableRow=document.querySelector(`tr[data-review-lead="${CSS.escape(String(leadId))}"]`);
    const buttons=tableRow?.querySelectorAll('button')||[];buttons.forEach(button=>button.disabled=true);
    setReviewMessage(`${apply?'Applying Google pin':'Keeping original pin'} for ${row.original_address}…`);
    try{
      const {data,error}=await sb.functions.invoke('address-validation-admin-review',{body:{action:'decide',lead_id:leadId,decision}});
      if(error||!data?.ok)throw error||new Error(data?.detail||data?.error||'review_decision_failed');
      setReviewMessage(`${apply?'Google pin applied':'Original pin kept'} for ${row.original_address}. Audit recorded.`,'ok');
      await loadReviewQueue();
      await window.loadMcCoyLeads?.();
    }catch(error){
      console.error('Address Validation Admin review decision failed',error);
      let detail=error?.message||String(error);try{const payload=await error?.context?.json?.();detail=payload?.detail||payload?.error||detail;}catch{}
      setReviewMessage(`Review decision stopped safely: ${detail}`,'error');
      buttons.forEach(button=>button.disabled=false);
    }
  }

  async function run(){
    if(window.MCCOY_ACCESS?.access?.role!=='admin')return;
    if(!confirm('Run a read-only Google Address Validation pilot on 100 visible suspicious lead addresses? Residential addresses will be sent to Google. No lead fields will be changed. Google usage charges may apply.'))return;
    const button=byId('runAddressValidationPilotBtn');
    button.disabled=true;button.textContent='RUNNING 100-LEAD PILOT…';
    latestSnapshotToken='';
    const applyButton=byId('applyAddressValidationRepairBtn');if(applyButton)applyButton.disabled=true;
    byId('addressValidationPilotResults').style.display='none';
    setMessage('Selecting 100 distinct suspicious coordinate stacks and validating their addresses…');
    try{
      const {data,error}=await sb.functions.invoke('address-validation-pilot',{body:{action:'run_read_only_pilot',limit:100}});
      if(error||!data?.ok)throw error||new Error(data?.detail||data?.error||'pilot_failed');
      render(data);
      const errors=Object.entries(data?.summary?.errors||{}).map(([key,count])=>`${key}: ${count}`).join(', ');
      setMessage(errors?`Pilot completed read-only, but Google returned errors: ${errors}`:'Pilot completed read-only. No lead data was changed.',errors?'error':'ok');
    }catch(error){
      console.error('Address Validation pilot failed',error);
      let detail=error?.message||String(error);
      try{const payload=await error?.context?.json?.();detail=payload?.detail||payload?.error||detail;}catch{}
      setMessage(`Pilot stopped safely: ${detail}`,'error');
    }finally{
      button.disabled=false;button.textContent='RUN 100-LEAD READ-ONLY PILOT';
    }
  }

  async function applyRepair(){
    if(window.MCCOY_ACCESS?.access?.role!=='admin'||!latestSnapshotToken)return;
    if(!confirm('Apply the guarded repair to this exact 100-lead pilot? Google will revalidate all 100 addresses. Only strict ACCEPT results at premise/subpremise quality, USPS DPV Y, matching address identity, and 100 meters or less will move. Original coordinates will be audited. All other pins will be preserved for Admin review. Google usage charges may apply.'))return;
    const button=byId('applyAddressValidationRepairBtn');
    button.disabled=true;button.textContent='REVALIDATING AND APPLYING…';
    setMessage('Revalidating the exact pilot snapshot before any lead is changed…');
    try{
      const {data,error}=await sb.functions.invoke('address-validation-repair',{body:{action:'apply_safest_pilot_repair',limit:100,pilot_snapshot_token:latestSnapshotToken}});
      if(error||!data?.ok)throw error||new Error(data?.detail||data?.error||'repair_failed');
      render(data);
      const result=data.result||{};
      latestSnapshotToken='';button.disabled=true;
      setMessage(`Guarded repair complete: ${Number(result.applied||0).toLocaleString()} pins moved · ${Number(result.admin_review||0).toLocaleString()} preserved for Admin review · ${Number(result.protected||0).toLocaleString()} field/manual protected · ${Number(result.stale||0).toLocaleString()} stale skipped.`,'ok');
      await loadReviewQueue();
      await window.loadMcCoyLeads?.();
    }catch(error){
      console.error('Address Validation repair failed',error);
      let detail=error?.message||String(error);
      try{const payload=await error?.context?.json?.();detail=payload?.detail||payload?.error||detail;}catch{}
      setMessage(`Repair stopped safely: ${detail}`,'error');
      button.disabled=!latestSnapshotToken;
    }finally{
      button.textContent='APPLY SAFEST 100-LEAD REPAIR';
    }
  }

  function download(){
    if(!latestRows.length)return;
    const lines=[columns.map(([,label])=>csvCell(label)).join(',')];
    for(const row of latestRows)lines.push(columns.map(([key])=>csvCell(row[key])).join(','));
    const blob=new Blob([lines.join('\r\n')],{type:'text/csv;charset=utf-8'}),link=document.createElement('a');
    link.href=URL.createObjectURL(blob);link.download=`mccoy-address-validation-pilot-${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(link.href),1000);
  }

  function ensure(){
    const controls=byId('leadGeoControls');
    if(!controls||byId('addressValidationPilotPanel'))return false;
    if(window.MCCOY_ACCESS?.access?.role!=='admin')return false;
    const panel=document.createElement('section');panel.id='addressValidationPilotPanel';
    panel.style.cssText='margin-top:10px;padding:10px;border:1px solid #cbd5e1;border-radius:10px;background:#f8fafc';
    panel.innerHTML=`
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <button id="runAddressValidationPilotBtn" class="assign-btn">RUN 100-LEAD READ-ONLY PILOT</button>
        <button id="downloadAddressValidationPilotBtn" class="assign-btn" disabled>DOWNLOAD CSV</button>
        <button id="applyAddressValidationRepairBtn" class="primary" disabled>APPLY SAFEST 100-LEAD REPAIR</button>
        <button id="loadAddressValidationReviewBtn" class="assign-btn">REVIEW QUARANTINED PINS</button>
        <span id="addressValidationPilotMessage" class="muted small">Compares legacy pins with Google Address Validation without changing the Lead Pool.</span>
      </div>
      <div id="addressValidationPilotResults" style="display:none;margin-top:10px">
        <div id="addressValidationPilotSummary" class="small" style="margin-bottom:8px"></div>
        <div style="max-height:420px;overflow:auto;border:1px solid #e2e8f0;background:white">
          <table aria-label="100-lead Address Validation pilot comparison" style="width:max-content;min-width:100%;border-collapse:collapse;font-size:11px">
            <thead><tr>${columns.map(([,label])=>`<th style="position:sticky;top:0;background:#e2e8f0;padding:5px;border:1px solid #cbd5e1;text-align:left">${escapeHtml(label)}</th>`).join('')}</tr></thead>
            <tbody id="addressValidationPilotTableBody"></tbody>
          </table>
        </div>
        <details style="margin-top:8px"><summary class="small">Raw JSON comparison</summary><pre id="addressValidationPilotJson" style="max-height:300px;overflow:auto;white-space:pre-wrap;font-size:10px"></pre></details>
      </div>
      <div id="addressValidationReviewSection" style="margin-top:12px;padding-top:12px;border-top:1px solid #cbd5e1">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap"><div><strong>Address Validation Admin Review</strong><div class="muted small">Quarantined pins never move until an Admin explicitly approves the Google candidate.</div></div><span id="addressValidationReviewMessage" class="muted small">Select REVIEW QUARANTINED PINS to load the current queue.</span></div>
        <div id="addressValidationReviewResults" style="display:none;margin-top:10px">
          <div id="addressValidationReviewSummary" class="small" style="margin-bottom:8px"></div>
          <div style="max-height:520px;overflow:auto;border:1px solid #e2e8f0;background:white">
            <table aria-label="Address Validation Admin review queue" style="width:max-content;min-width:100%;border-collapse:collapse;font-size:11px">
              <thead><tr><th>Original pin</th><th>Google candidate</th><th>Movement</th><th>Google action</th><th>Granularity</th><th>USPS DPV</th><th>Complete</th><th>Identity match</th><th>Why quarantined</th><th>Admin decision</th></tr></thead>
              <tbody id="addressValidationReviewTableBody"></tbody>
            </table>
          </div>
        </div>
      </div>`;
    controls.appendChild(panel);
    panel.querySelectorAll('th').forEach(th=>th.style.cssText='position:sticky;top:0;background:#e2e8f0;padding:5px;border:1px solid #cbd5e1;text-align:left;z-index:1');
    panel.querySelectorAll('td').forEach(td=>td.style.cssText='padding:5px;border:1px solid #e2e8f0;vertical-align:top');
    byId('runAddressValidationPilotBtn').onclick=run;
    byId('downloadAddressValidationPilotBtn').onclick=download;
    byId('applyAddressValidationRepairBtn').onclick=applyRepair;
    byId('loadAddressValidationReviewBtn').onclick=loadReviewQueue;
    setTimeout(loadReviewQueue,250);
    return true;
  }

  window.addEventListener('mccoy-access-ready',()=>setTimeout(ensure,100));
  window.addEventListener('mccoy-real-leads-loaded',()=>setTimeout(ensure,100));
  let attempts=0;const timer=setInterval(()=>{if(ensure()||++attempts>40)clearInterval(timer);},250);
})();
