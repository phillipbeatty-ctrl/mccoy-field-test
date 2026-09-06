(()=>{
  const GENERIC_FAILURE='Unable to save the proposed location. The original pin is unchanged.';
  const currentRole=()=>String(window.MCCOY_ACCESS?.access?.role||'').toLowerCase();
  const clean=value=>String(value??'').trim();

  if(typeof sb==='undefined'||!sb?.functions||typeof sb.functions.invoke!=='function')return;

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
    }catch(error){
      console.warn('MOVE PIN diagnostic response parsing failed',error);
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

  function renderAdminDiagnostic(){
    if(currentRole()!=='admin')return;
    const el=document.getElementById('leadCorrectionMsg');
    const detail=window.MCCOY_LAST_MOVE_PIN_ERROR;
    if(!el||!detail||clean(el.textContent)!==GENERIC_FAILURE)return;
    const suffix=[detail.reason,detail.status?`HTTP ${detail.status}`:'',detail.sb_error_code?`Supabase ${detail.sb_error_code}`:''].filter(Boolean).join(' · ');
    el.textContent=`${GENERIC_FAILURE} Admin diagnostic: ${suffix}.`;
  }

  function attach(){
    const root=document.getElementById('leadCorrectionPanel')||document.body;
    const observer=new MutationObserver(renderAdminDiagnostic);
    observer.observe(root,{subtree:true,childList:true,characterData:true});
    renderAdminDiagnostic();
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',attach,{once:true});
  else attach();
})();
