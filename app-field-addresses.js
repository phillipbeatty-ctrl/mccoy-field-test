// Add legitimate door addresses that are not already in the imported lead pool.
(()=>{
  const select=document.getElementById('fieldLeadSelect');
  if(!select)return;

  const panel=document.createElement('details');
  panel.id='fieldAddressEntry';
  panel.className='field-address-entry';
  panel.style.cssText='margin:0 0 14px;padding:12px;border:1px solid #e5e7eb;border-radius:10px;background:#fff';
  panel.innerHTML='<summary style="cursor:pointer;font-weight:800;color:#1455d9">ADD ADDRESS NOT LISTED</summary>'
    +'<div style="display:grid;gap:8px;margin-top:10px">'
    +'<input id="fieldNewAddress" autocomplete="street-address" placeholder="Street address" style="padding:10px;border:1px solid #d1d5db;border-radius:8px">'
    +'<input id="fieldNewAddress2" autocomplete="address-line2" placeholder="Apartment or unit (optional)" style="padding:10px;border:1px solid #d1d5db;border-radius:8px">'
    +'<div style="display:grid;grid-template-columns:1fr 75px 110px;gap:8px">'
    +'<input id="fieldNewCity" autocomplete="address-level2" placeholder="City" style="padding:10px;border:1px solid #d1d5db;border-radius:8px">'
    +'<input id="fieldNewState" autocomplete="address-level1" maxlength="2" placeholder="State" style="padding:10px;border:1px solid #d1d5db;border-radius:8px;text-transform:uppercase">'
    +'<input id="fieldNewZip" autocomplete="postal-code" maxlength="10" placeholder="ZIP" style="padding:10px;border:1px solid #d1d5db;border-radius:8px">'
    +'</div><button id="addFieldAddressBtn" class="primary" type="button">ADD ADDRESS TO REAL LEADS</button>'
    +'<div id="fieldAddressMsg" class="muted small" aria-live="polite"></div></div>';
  select.insertAdjacentElement('afterend',panel);

  function message(value,ok){const el=document.getElementById('fieldAddressMsg');el.textContent=value;el.style.color=ok?'#166534':'#991b1b';}
  function teamForState(code){return code==='NC'?'North Carolina':(['OR','WA'].includes(code)?'Pacific Northwest':'Unassigned');}

  document.getElementById('addFieldAddressBtn').addEventListener('click',async()=>{
    const access=window.MCCOY_ACCESS?.access;
    if(!access?.active){message('Sign in with an approved McCoy account first.');return;}
    const address1=document.getElementById('fieldNewAddress').value.trim();
    const address2=document.getElementById('fieldNewAddress2').value.trim();
    const city=document.getElementById('fieldNewCity').value.trim();
    const stateCode=document.getElementById('fieldNewState').value.trim().toUpperCase();
    const zip=document.getElementById('fieldNewZip').value.trim();
    if(address1.length<4){message('Enter a valid street address.');return;}
    if(stateCode&&stateCode.length!==2){message('Use the two-letter state abbreviation.');return;}
    if(zip&&!/^\\d{5}(?:-\\d{4})?$/.test(zip)){message('Enter a valid ZIP code.');return;}
    const btn=document.getElementById('addFieldAddressBtn');
    btn.disabled=true;message('Adding address and locating the current door...',true);
    try{
      let gps=state.latestGps||null;
      if(!gps&&typeof getGPSOnce==='function'){try{gps=await getGPSOnce();state.latestGps=gps;}catch(_){}}
      const body={action:'create_field_address',address1,address2,city,state:stateCode,zip,latitude:gps?.lat??null,longitude:gps?.lng??null};
      const {data,error}=await sb.functions.invoke('lead-admin',{body});
      if(error||!data?.ok||!data.lead)throw error||new Error(data?.error||'address_creation_failed');
      const row=data.lead;
      const address=[row.address1,row.address2].filter(Boolean).join(' ');
      const lead={id:Date.now(),dbId:row.id,sourceId:row.source_id,sourceSystem:row.source_system||'FIELD_ENTRY',importBatchId:row.import_batch_id||null,address1:row.address1||'',address2:row.address2||'',address,city:row.city||'',stateCode:row.state||'',zip:row.zip||'',fullAddress:[address,row.city,row.state,row.zip].filter(Boolean).join(', '),lat:row.latitude==null?undefined:Number(row.latitude),lng:row.longitude==null?undefined:Number(row.longitude),assignedRepId:row.assigned_rep_id||null,team:teamForState(row.state||''),rep:null,disposition:row.current_disposition||'Uncontacted',isDemo:false};
      state.realLeads=state.realLeads||[];state.realLeads.unshift(lead);state.leadMode='real';state.leads=state.realLeads;
      if(typeof window.renderLeads==='function')window.renderLeads();
      if(typeof window.renderFieldLeadSelect==='function')window.renderFieldLeadSelect();
      select.value=String(lead.id);
      window.MCCOY_RENDER_LEAD_MAP?.(false);
      message(gps?'Address added to the real-lead map and selected for this door.':'Address added and selected. Enable location to place it on the map.',true);
      for(const id of ['fieldNewAddress','fieldNewAddress2','fieldNewCity','fieldNewState','fieldNewZip'])document.getElementById(id).value='';
      panel.open=false;
    }catch(error){console.error('Field address creation failed',error);message(error.message||'Unable to add this address.');}
    finally{btn.disabled=false;}
  });
})();