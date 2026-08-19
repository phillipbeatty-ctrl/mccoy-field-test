(()=>{
  let activeLeadId=null;
  let running=false;
  const ids=['editLeadAddress1','editLeadAddress2','editLeadCity','editLeadState','editLeadZip'];

  function findLeadFromForm(){
    const a1=document.getElementById('editLeadAddress1')?.value||'';
    const a2=document.getElementById('editLeadAddress2')?.value||'';
    const city=document.getElementById('editLeadCity')?.value||'';
    const stateCode=document.getElementById('editLeadState')?.value||'';
    const zip=document.getElementById('editLeadZip')?.value||'';
    return (state.realLeads||[]).find(l=>(l.address1||l.address||'')===a1&&(l.address2||'')===a2&&(l.city||'')===city&&(l.stateCode||'')===stateCode&&(l.zip||'')===zip)||null;
  }

  function captureActiveLead(){
    const lead=findLeadFromForm();
    if(lead)activeLeadId=lead.dbId||lead.id;
  }

  function msg(text){
    const el=document.getElementById('leadCorrectionMsg');
    if(el)el.textContent=text;
  }

  function value(id){return document.getElementById(id)?.value?.trim()||'';}

  async function correctAddressAndLocation(){
    if(running||window.MCCOY_ACCESS?.access?.role!=='admin')return;
    if(!activeLeadId)captureActiveLead();
    const lead=(state.realLeads||[]).find(l=>String(l.dbId||l.id)===String(activeLeadId));
    if(!lead){msg('Select a lead before correcting its address.');return;}
    const payload={
      action:'correct_address_location',
      lead_id:lead.dbId||lead.id,
      address1:value('editLeadAddress1'),
      address2:value('editLeadAddress2'),
      city:value('editLeadCity'),
      state:value('editLeadState').toUpperCase(),
      zip:value('editLeadZip')
    };
    if(!payload.address1||!payload.city||!payload.state||!payload.zip){msg('Street, city, state, and ZIP are required before relocating the lead.');return;}
    running=true;
    ids.forEach(id=>{const el=document.getElementById(id);if(el)el.disabled=true;});
    msg('Saving address and correcting map location…');
    try{
      const {data,error}=await sb.functions.invoke('lead-geocode',{body:payload});
      if(error||!data?.ok)throw error||new Error(data?.detail||data?.error||'address_location_correction_failed');
      const r=data.lead||{};
      lead.address1=r.address1||payload.address1;
      lead.address2=r.address2||payload.address2;
      lead.address=[lead.address1,lead.address2].filter(Boolean).join(' ');
      lead.city=r.city||payload.city;
      lead.stateCode=r.state||payload.state;
      lead.zip=r.zip||payload.zip;
      lead.fullAddress=[[lead.address1,lead.address2].filter(Boolean).join(' '),lead.city,lead.stateCode,lead.zip].filter(Boolean).join(', ');
      if(data.matched&&Number.isFinite(Number(r.latitude))&&Number.isFinite(Number(r.longitude))){
        lead.lat=Number(r.latitude);lead.lng=Number(r.longitude);
        msg('Address saved and house moved to the corrected address location.');
        window.MCCOY_RENDER_LEAD_MAP?.(false);
        setTimeout(()=>window.MCCOY_SELECT_MAP_LEAD?.(lead.dbId||lead.id),80);
      }else{
        msg('Address saved, but the geocoder could not confidently place it. Drag the correction house manually if needed.');
      }
      if(typeof window.renderLeads==='function')window.renderLeads();
      window.dispatchEvent(new CustomEvent('mccoy-lead-address-corrected',{detail:{lead_id:lead.dbId||lead.id,matched:!!data.matched}}));
    }catch(e){
      console.error('Address/location correction failed',e);
      msg(`Unable to correct address location${e?.message?': '+e.message:''}.`);
    }finally{
      running=false;
      ids.forEach(id=>{const el=document.getElementById(id);if(el)el.disabled=false;});
      document.getElementById('editLeadAddress1')?.focus();
    }
  }

  document.addEventListener('focusin',e=>{if(ids.includes(e.target?.id))captureActiveLead();},true);
  document.addEventListener('click',e=>{
    const pick=e.target.closest?.('.map-pick');
    if(pick?.dataset?.id){const l=(state.realLeads||[]).find(x=>String(x.id)===String(pick.dataset.id)||String(x.dbId)===String(pick.dataset.id));if(l)activeLeadId=l.dbId||l.id;return;}
    if(e.target.closest?.('.lead-house-icon'))setTimeout(captureActiveLead,60);
  },true);
  document.addEventListener('keydown',e=>{
    if(e.key!=='Enter'||!ids.includes(e.target?.id))return;
    e.preventDefault();
    e.stopPropagation();
    correctAddressAndLocation();
  },true);

  window.MCCOY_CORRECT_ADDRESS_LOCATION=correctAddressAndLocation;
})();
