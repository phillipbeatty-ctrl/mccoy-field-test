// Opt-in QA control: ?move_pin_diagnostics=1. It never uses a selected lead,
// real coordinates, or a user's GPS. The deliberately non-UUID lead ID is
// rejected while binding the RPC arguments, before the transaction can execute.
(()=>{
  if(window.MCCOY_MOVE_PIN_PROBE_INSTALLED)return;
  window.MCCOY_MOVE_PIN_PROBE_INSTALLED=true;
  const generic='Unable to save the proposed location. The original pin is unchanged.';
  const panel=document.createElement('section');
  panel.id='movePinDiagnosticProbe';
  panel.setAttribute('aria-label','MOVE PIN diagnostic test');
  panel.style.cssText='position:fixed;z-index:250000;right:12px;bottom:12px;max-width:min(560px,calc(100vw - 24px));padding:14px;background:#fff;color:#111827;border:2px solid #334155;border-radius:10px;box-shadow:0 4px 18px #0003;font:14px/1.5 system-ui';
  const title=document.createElement('strong');title.textContent='MOVE PIN diagnostic test — no live pin changes';
  const note=document.createElement('p');note.textContent='Uses a deliberately invalid lead identifier. Sign in with the role you want to test.';
  const button=document.createElement('button');button.id='runMovePinDiagnosticProbe';button.type='button';button.textContent='RUN REJECTED MOVE PIN CHECK';button.style.cssText='min-height:44px;padding:8px 12px';
  const result=document.createElement('p');result.id='movePinDiagnosticProbeResult';result.setAttribute('role','status');
  const output=document.createElement('p');output.id='movePinDiagnosticProbeMessage';output.style.overflowWrap='anywhere';
  panel.append(title,note,button,result,output);document.body.appendChild(panel);
  sb.auth.onAuthStateChange(()=>{output.textContent='';result.textContent='';});

  button.onclick=async()=>{
    const role=String(window.MCCOY_ACCESS?.access?.role||'').toLowerCase();
    if(!window.MCCOY_ACCESS?.user?.id||!role){result.textContent='Sign in before running the check.';return;}
    const source=document.getElementById('leadCorrectionMsg');
    if(!source||typeof window.MCCOY_INVOKE_MOVE_PIN!=='function'){result.textContent='MOVE PIN diagnostics are not ready.';return;}
    button.disabled=true;output.textContent='';result.textContent=`Testing ${role} with an invalid lead identifier…`;
    const userId=window.MCCOY_ACCESS.user.id;
    try{
      const response=await window.MCCOY_INVOKE_MOVE_PIN({
        action:'move_lead_pin',
        lead_id:'__invalid_uuid_move_pin_probe__',
        client_request_id:crypto.randomUUID(),
        proposed_latitude:0,
        proposed_longitude:0,
        original_latitude:null,
        original_longitude:null,
        actor_latitude:null,
        actor_longitude:null,
        actor_accuracy_meters:null,
        gps_captured_at:null,
        expected_updated_at:null,
        client_context:{platform:'diagnostic-probe',app_version:'pr127'}
      });
      const payload=await response?.error?.context?.clone?.().json().catch(()=>null);
      const detail=typeof payload?.detail==='string'?payload.detail:'';
      if(window.MCCOY_ACCESS?.user?.id!==userId||String(window.MCCOY_ACCESS?.access?.role||'').toLowerCase()!==role){result.textContent='Account changed. Run the check again.';return;}
      if(!response?.error||payload?.error!=='lead_admin_failed'||!detail.includes('invalid input syntax for type uuid')){
        result.textContent='The expected UUID rejection was not reached; this check is inconclusive.';
        return;
      }
      source.textContent=generic;
      // Allow the actual diagnostic and in-map status observers to render.
      await new Promise(resolve=>setTimeout(resolve,0));
      if(window.MCCOY_ACCESS?.user?.id!==userId||String(window.MCCOY_ACCESS?.access?.role||'').toLowerCase()!==role){output.textContent='';result.textContent='Account changed. Run the check again.';return;}
      const shown=source.textContent;
      output.textContent=shown;
      const pass=role==='admin'
        ? shown.includes(detail)&&shown.includes('Admin diagnostic:')
        : shown===generic&&!window.MCCOY_LAST_MOVE_PIN_ERROR;
      result.textContent=`${pass?'PASS':'FAIL'} · Role: ${role} · Live rejected MOVE PIN · No lead transaction executed`;
    }catch{
      result.textContent='The check could not complete. No valid lead identifier was submitted.';
    }finally{button.disabled=false;}
  };
})();
