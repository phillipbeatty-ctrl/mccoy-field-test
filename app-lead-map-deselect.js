(function mapDeselectApp(){
  function resetSelectedLeadDetails(){
    const detail=document.getElementById('mapLeadDetail');
    if(detail)detail.innerHTML='<div class="muted small">Select a lead from the list or map to view details.</div>';
    const legacy=document.getElementById('mapLeadInfo');
    if(legacy)legacy.innerHTML='<span class="muted">Select a real lead.</span>';
    const correction=document.getElementById('leadCorrectionPanel');
    if(correction)correction.style.display='none';
    const message=document.getElementById('mapAssignMsg');
    if(message)message.textContent='';
  }
  function clearMapSelection(){
    document.getElementById('clearMapSelectionBtn')?.click();
    resetSelectedLeadDetails();
  }
  document.addEventListener('click',event=>{
    const canvas=event.target?.closest?.('#leadMapFrame');
    if(!canvas)return;
    if(window.MCCOY_MAP_MOVE_PIN_ACTIVE||window.MCCOY_LASSO_ACTIVE||Date.now()<Number(window.MCCOY_LASSO_IGNORE_MAP_CLEAR_UNTIL||0))return;
    if(event.target.closest?.('.lead-house-icon,.mccoy-lead-cluster,.leaflet-control'))return;
    const lasso=document.getElementById('lassoSelectBtn');
    if(lasso&&lasso.textContent!=='LASSO SELECT')return;
    clearMapSelection();
  },true);
  document.addEventListener('click',event=>{
    if(event.target?.closest?.('#clearMapSelectionBtn'))setTimeout(resetSelectedLeadDetails,0);
  });

  const GENERIC_MOVE_FAILURE='Unable to save the proposed location. The original pin is unchanged.';
  const clean=value=>String(value??'').trim();
  const currentRole=()=>String(window.MCCOY_ACCESS?.access?.role||'').toLowerCase();

  function installMovePinDiagnostics(){
    if(window.MCCOY_MOVE_PIN_DIAGNOSTICS_INSTALLED)return;
    if(typeof sb==='undefined'||!sb?.functions||typeof sb.functions.invoke!=='function')return;
    window.MCCOY_MOVE_PIN_DIAGNOSTICS_INSTALLED=true;

    const originalInvoke=sb.functions.invoke.bind(sb.functions);
    sb.functions.invoke=async function(name,options){
      const result=await originalInvoke(name,options);
      const body=options?.body||{};
      if(name!=='lead-admin'||body.action!=='move_lead_pin'||!result?.error)return result;

      let payload=null,status=null,sbErrorCode=null;
      const context=result.error?.context;
      try{
        status=Number(context?.status)||null;
        sbErrorCode=clean(context?.headers?.get?.('sb-error-code'))||null;
        if(typeof context?.clone==='function'){
          try{payload=await context.clone().json();}
          catch{
            const text=clean(await context.clone().text().catch(()=>''));
            if(text)payload={message:text.slice(0,500)};
          }
        }
      }catch(parseError){
        console.warn('MOVE PIN diagnostic response parsing failed',parseError);
      }

      const backendReason=clean(payload?.error||payload?.detail||payload?.message||result.error?.message)||'location_save_failed';
      window.MCCOY_LAST_MOVE_PIN_ERROR={
        reason:backendReason,
        status,
        sb_error_code:sbErrorCode,
        lead_id:clean(body.lead_id)||null,
        client_request_id:clean(body.client_request_id)||null,
        captured_at:new Date().toISOString()
      };

      if(payload&&(!result.data||!result.data.error)){
        result.data={...(result.data||{}),...payload,ok:false,error:backendReason};
      }
      return result;
    };

    const source=document.getElementById('leadCorrectionMsg');
    if(!source)return;
    const renderAdminDiagnostic=()=>{
      if(currentRole()!=='admin')return;
      const detail=window.MCCOY_LAST_MOVE_PIN_ERROR;
      if(!detail||clean(source.textContent)!==GENERIC_MOVE_FAILURE)return;
      const diagnostic=[detail.reason,detail.status?`HTTP ${detail.status}`:'',detail.sb_error_code?`Supabase ${detail.sb_error_code}`:''].filter(Boolean).join(' · ');
      source.textContent=`${GENERIC_MOVE_FAILURE} Admin diagnostic: ${diagnostic}.`;
    };
    const observer=new MutationObserver(renderAdminDiagnostic);
    observer.observe(source,{childList:true,subtree:true,characterData:true});
  }

  const installTimer=setInterval(()=>{
    if(typeof sb==='undefined'||!document.getElementById('leadCorrectionMsg'))return;
    clearInterval(installTimer);
    installMovePinDiagnostics();
  },100);
  setTimeout(()=>clearInterval(installTimer),10000);
})();
