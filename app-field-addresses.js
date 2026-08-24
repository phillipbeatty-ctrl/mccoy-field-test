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

  const closestBox=document.createElement('div');
  closestBox.id='closestDoorAddress';
  closestBox.className='geo-box';
  closestBox.style.cssText='margin:0 0 10px;border-color:#bfdbfe;background:#eff6ff;color:#1e3a8a';
  closestBox.setAttribute('role','status');
  closestBox.setAttribute('aria-live','polite');
  closestBox.textContent='Closest address: Waiting for current location…';
  select.insertAdjacentElement('beforebegin',closestBox);

  function metersBetween(lat1,lng1,lat2,lng2){
    const radians=value=>value*Math.PI/180,R=6371000,dLat=radians(lat2-lat1),dLng=radians(lng2-lng1);
    const value=Math.sin(dLat/2)**2+Math.cos(radians(lat1))*Math.cos(radians(lat2))*Math.sin(dLng/2)**2;
    return 2*R*Math.asin(Math.sqrt(value));
  }
  function formatRepDistance(meters){
    const feet=meters*3.28084;
    return feet<1000?`${Math.round(feet)} ft away`:`${(feet/5280).toFixed(2)} mi away`;
  }
  function updateClosestDoorAddress(){
    if(window.MCCOY_DISTANCE_TO_LEAD_CONTROL?.render)return window.MCCOY_DISTANCE_TO_LEAD_CONTROL.render();
    const gps=state.latestGps||null,lat=Number(gps?.lat),lng=Number(gps?.lng);
    if(!Number.isFinite(lat)||!Number.isFinite(lng)){
      closestBox.dataset.closestLeadId='';
      closestBox.textContent='Closest address: Waiting for current location…';
      return null;
    }
    let nearest=null;
    for(const lead of state.leads||[]){
      if(lead?.isDemo===true)continue;
      const leadLat=Number(lead?.lat),leadLng=Number(lead?.lng);
      if(!Number.isFinite(leadLat)||!Number.isFinite(leadLng))continue;
      const distance=metersBetween(lat,lng,leadLat,leadLng);
      if(!nearest||distance<nearest.distance)nearest={lead,distance};
    }
    if(!nearest){
      closestBox.dataset.closestLeadId='';
      closestBox.textContent='Closest address: No mapped addresses available.';
      return null;
    }
    closestBox.dataset.closestLeadId=String(nearest.lead.id);
    closestBox.textContent=`Closest address: ${fieldLeadAddressLabel(nearest.lead)} · ${formatRepDistance(nearest.distance)}`;
    return nearest;
  }
  window.MCCOY_UPDATE_CLOSEST_DOOR=updateClosestDoorAddress;
  updateClosestDoorAddress();
  const closestTimer=setInterval(updateClosestDoorAddress,1500);
  for(const eventName of ['mccoy-real-leads-progress','mccoy-real-leads-loaded','mccoy-gps-update'])window.addEventListener(eventName,updateClosestDoorAddress);
  window.addEventListener('beforeunload',()=>clearInterval(closestTimer));

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

  function applyAddressEntryAccess(){panel.hidden=window.MCCOY_ACCESS?.access?.role!=='admin';}
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
    if(stateCode&&stateCode.length!==2){message('Use the two-letter state abbreviation.');return;}
    if(zip&&!/^\d{5}(?:-\d{4})?$/.test(zip)){message('Enter a valid ZIP code.');return;}
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
      const lead={id:Date.now(),dbId:row.id,sourceId:row.source_id,sourceSystem:row.source_system||'FIELD_ENTRY',importBatchId:row.import_batch_id||null,address1:row.address1||'',address2:row.address2||'',address,city:row.city||'',stateCode:row.state||'',zip:row.zip||'',fullAddress:[address,row.city,row.state,row.zip].filter(Boolean).join(', '),lat:row.latitude==null?undefined:Number(row.latitude),lng:row.longitude==null?undefined:Number(row.longitude),geocodeStatus:row.geocode_status||null,assignedRepId:row.assigned_rep_id||null,team:teamForState(row.state||''),rep:null,disposition:row.current_disposition||'Uncontacted',isDemo:false};
      state.realLeads=state.realLeads||[];state.realLeads.unshift(lead);state.leadMode='real';state.leads=state.realLeads;
      if(typeof window.renderLeads==='function')window.renderLeads();
      if(typeof window.renderFieldLeadSelect==='function')window.renderFieldLeadSelect();
      select.value=String(lead.id);select.dispatchEvent(new Event('change',{bubbles:true}));
      window.MCCOY_RENDER_LEAD_MAP?.(false);
      updateClosestDoorAddress();
      message(gps?'Address added to the real-lead map and selected for this door.':'Address added and selected. Enable location to place it on the map.',true);
      for(const id of ['fieldNewAddress','fieldNewAddress2','fieldNewCity','fieldNewState','fieldNewZip'])document.getElementById(id).value='';
      panel.open=false;
    }catch(error){console.error('Field address creation failed',error);message(error.message||'Unable to add this address.');}
    finally{btn.disabled=false;}
  });
})();
