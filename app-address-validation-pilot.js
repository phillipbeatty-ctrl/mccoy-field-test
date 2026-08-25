(()=>{
  const byId=id=>document.getElementById(id);
  const number=value=>Number.isFinite(Number(value))?Number(value):null;
  const meters=value=>number(value)==null?'—':`${Math.round(Number(value)).toLocaleString()} m`;
  const coordinate=value=>number(value)==null?'—':Number(value).toFixed(7);
  const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
  const csvCell=value=>`"${String(value??'').replace(/"/g,'""')}"`;
  let latestRows=[],latestSnapshotToken='';

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
      if(key==='address_complete'||key==='address_identity_match')value=value===true?'Yes':value===false?'No':'—';
      return `<td>${escapeHtml(value==null||value===''?'—':value)}</td>`;
    }).join('')}</tr>`).join('');
    const raw=byId('addressValidationPilotJson');
    raw.textContent=JSON.stringify(data,null,2);
    byId('addressValidationPilotResults').style.display='block';
    byId('downloadAddressValidationPilotBtn').disabled=!latestRows.length;
    const applyButton=byId('applyAddressValidationRepairBtn');
    if(applyButton)applyButton.disabled=!(latestSnapshotToken&&Number(summary.validated||0)===100&&!Object.keys(summary.errors||{}).length&&data?.read_only===true);
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
      </div>`;
    controls.appendChild(panel);
    byId('runAddressValidationPilotBtn').onclick=run;
    byId('downloadAddressValidationPilotBtn').onclick=download;
    byId('applyAddressValidationRepairBtn').onclick=applyRepair;
    return true;
  }

  window.addEventListener('mccoy-access-ready',()=>setTimeout(ensure,100));
  window.addEventListener('mccoy-real-leads-loaded',()=>setTimeout(ensure,100));
  let attempts=0;const timer=setInterval(()=>{if(ensure()||++attempts>40)clearInterval(timer);},250);
})();
