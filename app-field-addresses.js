// Add legitimate door addresses that are not already in the imported lead pool.
(()=>{
  const select=document.getElementById('fieldLeadSelect');
  if(!select)return;

  const originalRenderFieldLeadSelect=window.renderFieldLeadSelect;
  function fieldLeadAddressLabel(lead){
    const street=String(lead?.address||lead?.address1||'Address').trim();
    const city=String(lead?.city||'').trim();
    const stateCode=String(lead?.stateCode||lead?.state||'').trim().toUpperCase();
    const zip=String(lead?.zip||'').trim();
    const stateAndZip=[stateCode,zip].filter(Boolean).join(' ');
    const locality=[city,stateAndZip].filter(Boolean).join(', ');
    return locality?`${street} — ${locality}`:street;
  }
  function renderFieldLeadSelectWithLocality(){
    if(typeof originalRenderFieldLeadSelect==='function')originalRenderFieldLeadSelect();
    const leadsById=new Map((state.leads||[]).map(lead=>[String(lead.id),lead]));
    for(const option of select.options){
      const lead=leadsById.get(option.value);
      if(lead)option.textContent=fieldLeadAddressLabel(lead);
    }
  }
  window.renderFieldLeadSelect=renderFieldLeadSelectWithLocality;
  renderFieldLeadSelectWithLocality();

  const panel=document.createElement('details');
  panel.id='fieldAddressEntry';
  panel.className='field-address-entry';
  panel.style.cssText='margin:0 0 14px;padding:12px;border:1px solid #e5e7eb;border-radius:10px;background:#fff';
  panel.innerHTML='<summary style="cursor:pointer;font-weight:800;color:#1455d9">ADMIN: ADD ADDRESS NOT LISTED</summary>'
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

  // The shared field-user dialog replaces this legacy Admin-only entry point.
  function applyAddressEntryAccess(){panel.hidden=true;}
  window.addEventListener('mccoy-access-ready',applyAddressEntryAccess);
  applyAddressEntryAccess();

  function message(value,ok){const el=document.getElementById('fieldAddressMsg');el.textContent=value;el.style.color=ok?'#166534':'#991b1b';}
  function teamForState(code){return code==='NC'?'North Carolina':(['OR','WA'].includes(code)?'Pacific Northwest':'Unassigned');}

  document.getElementById('addFieldAddressBtn').addEventListener('click',async()=>{
    const access=window.MCCOY_ACCESS?.access;
    if(!access?.active){message('Sign in with an approved McCoy account first.');return;}
    if(access.role!=='admin'){message('Only an Admin can add a new lead address. Use the sale service-address field for an out-of-area completed sale.');return;}
    const address1=document.getElementById('fieldNewAddress').value.trim();
    const address2=document.getElementById('fieldNewAddress2').value.trim();
    const city=document.getElementById('fieldNewCity').value.trim();
    const stateCode=document.getElementById('fieldNewState').value.trim().toUpperCase();
    const zip=document.getElementById('fieldNewZip').value.trim();
    if(address1.length<4){message('Enter a valid street address.');return;}
    if(!city||!stateCode||!zip){message('Street, city, state, and ZIP are required for verified placement.');return;}
    if(stateCode.length!==2){message('Use the two-letter state abbreviation.');return;}
    if(!/^\d{5}(?:-\d{4})?$/.test(zip)){message('Enter a valid ZIP code.');return;}
    const btn=document.getElementById('addFieldAddressBtn');
    btn.disabled=true;message('Adding address and checking its pin with Google…',true);
    try{
      const body={action:'create_field_address',address1,address2,city,state:stateCode,zip};
      const {data,error}=await sb.functions.invoke('lead-admin',{body});
      if(error||!data?.ok||!data.lead)throw error||new Error(data?.error||'address_creation_failed');
      let row=data.lead,verificationError=null;
      try{
        const {data:verified,error:verifyError}=await sb.functions.invoke('lead-geocode',{body:{action:'correct_address_location',lead_id:row.id,address1,address2,city,state:stateCode,zip}});
        if(verifyError||!verified?.ok)throw verifyError||new Error(verified?.error||'google_verification_failed');
        row=verified.lead||row;
      }catch(error){verificationError=error;console.warn('New address is safely unmapped pending Google verification',error);}
      const address=[row.address1,row.address2].filter(Boolean).join(' ');
      const lead={id:Date.now(),dbId:row.id,sourceId:row.source_id,sourceSystem:row.source_system||'FIELD_ENTRY',importBatchId:row.import_batch_id||null,address1:row.address1||'',address2:row.address2||'',address,city:row.city||'',stateCode:row.state||'',zip:row.zip||'',fullAddress:[address,row.city,row.state,row.zip].filter(Boolean).join(', '),lat:row.latitude==null?undefined:Number(row.latitude),lng:row.longitude==null?undefined:Number(row.longitude),geocodeStatus:row.geocode_status||null,geocodeProvider:row.geocode_provider||null,geocodePrecision:row.geocode_precision||null,geocodeVerificationStatus:row.geocode_verification_status||null,geocodeCandidateLat:row.geocode_candidate_latitude==null?undefined:Number(row.geocode_candidate_latitude),geocodeCandidateLng:row.geocode_candidate_longitude==null?undefined:Number(row.geocode_candidate_longitude),assignedRepId:row.assigned_rep_id||null,team:teamForState(row.state||''),rep:null,disposition:row.current_disposition||'Uncontacted',isDemo:false};
      state.realLeads=state.realLeads||[];state.realLeads.unshift(lead);state.leadMode='real';state.leads=state.realLeads;
      if(typeof window.renderLeads==='function')window.renderLeads();
      if(typeof window.renderFieldLeadSelect==='function')window.renderFieldLeadSelect();
      select.value=String(lead.id);select.dispatchEvent(new Event('change',{bubbles:true}));
      window.MCCOY_RENDER_LEAD_MAP?.(false);
      updateClosestDoorAddress();
      message(verificationError?'Address added but left off the map because Google could not verify a rooftop location. Use Correct Lead to review it.':'Address added and its pin was verified with Google.',!verificationError);
      for(const id of ['fieldNewAddress','fieldNewAddress2','fieldNewCity','fieldNewState','fieldNewZip'])document.getElementById(id).value='';
      panel.open=false;
    }catch(error){console.error('Field address creation failed',error);message(error.message||'Unable to add this address.');}
    finally{btn.disabled=false;}
  });
})();
