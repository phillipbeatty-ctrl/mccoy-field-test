// Authenticated workday presence for the authoritative Sales/Hour denominator.
// The compact Sales Hub card shows only the saved Home address and an EDIT action.
// Presence sampling remains independent of the Start/Stop Knocking button.
(()=>{
  if(window.MCCOY_SPH_PRESENCE)return

  const SAMPLE_MS=5*60*1000
  const RETRY_MS=45*1000
  const FRESH_GPS_MS=2*60*1000
  let timer=null
  let inFlight=false
  let initialized=false
  let homeConfigured=false
  let homeLabel=''

  const $=id=>document.getElementById(id)
  const consented=()=>typeof mccoyConsentAccepted!=='undefined'&&mccoyConsentAccepted===true
  const signedIn=()=>!!window.MCCOY_ACCESS?.user&&!!window.MCCOY_ACCESS?.access?.active

  function schedule(delay=SAMPLE_MS){
    clearTimeout(timer)
    timer=null
    if(!signedIn()||document.visibilityState!=='visible'||navigator.onLine===false)return
    timer=setTimeout(()=>record('heartbeat'),Math.max(1000,delay))
  }

  async function currentGps(){
    if(!consented())return null
    const latest=typeof state!=='undefined'?state?.latestGps:null
    const capturedAt=Number(latest?.capturedAt)||0
    if(latest&&Date.now()-capturedAt<=FRESH_GPS_MS)return latest
    if(typeof getGPSOnce!=='function')return null
    try{
      const gps=await getGPSOnce()
      if(typeof state!=='undefined')state.latestGps=gps
      return gps
    }catch(error){
      console.warn('Sales/Hour presence location unavailable',error)
      return null
    }
  }

  async function record(eventType='heartbeat',forceGps=false){
    clearTimeout(timer)
    timer=null
    if(!signedIn()||inFlight)return false
    if(eventType==='heartbeat'&&(document.visibilityState!=='visible'||navigator.onLine===false))return false
    inFlight=true
    try{
      const gps=(consented()||forceGps)?await currentGps():null
      const {data,error}=await sb.rpc('record_sph_presence',{
        p_event_type:eventType,
        p_latitude:gps?.lat??null,
        p_longitude:gps?.lng??null,
        p_accuracy_meters:gps?.accuracy??null
      })
      if(error||!data?.ok)throw error||new Error(data?.reason||'sph_presence_rejected')
      const status=$('sphPresenceStatus')
      if(status)status.textContent=data.inside_area===true?'In assigned area · Sales/Hour timer active':data.area_basis==='none'?'No assigned area detected · 11 AM–7 PM fallback applies':'Outside assigned area'
      schedule()
      return true
    }catch(error){
      console.error('Sales/Hour presence failed',error)
      schedule(RETRY_MS)
      return false
    }finally{inFlight=false}
  }

  function renderHome(){
    const display=$('sphHomeAddressDisplay')
    if(display)display.textContent=homeConfigured&&homeLabel?homeLabel:'Home address not configured'
    const edit=$('sphEditHome')
    if(edit){edit.textContent='EDIT';edit.setAttribute('aria-label',homeConfigured?'Edit Home address':'Set Home address')}
  }

  async function loadStatus(){
    const {data,error}=await sb.rpc('get_sph_status')
    if(error||!data?.ok)throw error||new Error(data?.reason||'sph_status_failed')
    homeConfigured=data.home_configured===true
    homeLabel=String(data.home_label||'').trim()
    const presence=$('sphPresenceStatus')
    if(presence&&data.today?.status_label)presence.textContent=data.today.status_label
    renderHome()
    window.dispatchEvent(new CustomEvent('mccoy-sph-workday-ready',{detail:{homeConfigured,homeLabel}}))
    return data
  }

  function closeEditor(){
    const editor=$('sphHomeEditor')
    if(!editor)return
    editor.classList.remove('show')
    editor.setAttribute('aria-hidden','true')
    document.body.classList.remove('sph-home-editor-open')
  }

  function openEditor(){
    const editor=$('sphHomeEditor'),input=$('sphHomeLabel'),status=$('sphHomeEditStatus')
    if(!editor||!input)return
    input.value=homeLabel
    if(status){status.textContent='Enter the Home address, then save while you are physically at Home.';status.classList.remove('error','success')}
    editor.classList.add('show')
    editor.setAttribute('aria-hidden','false')
    document.body.classList.add('sph-home-editor-open')
    setTimeout(()=>{input.focus();input.select?.()},40)
  }

  async function saveHome(){
    const button=$('sphSaveHome'),status=$('sphHomeEditStatus'),input=$('sphHomeLabel')
    const label=String(input?.value||'').trim().replace(/\s+/g,' ')
    if(!consented()){
      $('privacyModal')?.classList.add('show')
      if(status){status.textContent='Accept the current Privacy & Location Notice before setting Home.';status.classList.add('error')}
      return
    }
    if(label.length<5){
      if(status){status.textContent='Enter the complete Home address.';status.classList.add('error')}
      input?.focus()
      return
    }
    button.disabled=true;button.textContent='GETTING LOCATION…'
    if(status){status.textContent='Getting your current location…';status.classList.remove('error','success')}
    try{
      const gps=await currentGps()
      if(!gps)throw new Error('A current GPS location is required.')
      const {data,error}=await sb.rpc('set_sph_home_location',{
        p_home_label:label,
        p_latitude:gps.lat,
        p_longitude:gps.lng,
        p_accuracy_meters:gps.accuracy
      })
      if(error||!data?.ok)throw error||new Error(data?.reason||'home_update_failed')
      homeConfigured=true;homeLabel=label;renderHome()
      if(status){status.textContent='Home address saved privately for Sales/Hour exit detection.';status.classList.add('success')}
      await record('home_update',true)
      await loadStatus()
      setTimeout(closeEditor,450)
    }catch(error){
      console.error('Home location update failed',error)
      if(status){status.textContent=error?.message||'Unable to save Home. Move outdoors and retry.';status.classList.add('error')}
    }finally{button.disabled=false;button.textContent='SAVE HOME AT CURRENT LOCATION'}
  }

  function ensureStyles(){
    if($('sphWorkdayCompactStyles'))return
    const style=document.createElement('style')
    style.id='sphWorkdayCompactStyles'
    style.textContent=`
      #sphWorkdayControl{margin:0 0 10px;padding:10px 12px;min-width:0}
      #sphWorkdayControl .sph-workday-summary{display:flex;align-items:center;justify-content:space-between;gap:12px;min-width:0}
      #sphWorkdayControl .sph-workday-copy{display:grid;gap:3px;min-width:0}
      #sphWorkdayControl .sph-workday-title{font-size:10px;font-weight:900;letter-spacing:.04em;text-transform:uppercase;color:#64748b}
      #sphHomeAddressDisplay{display:block;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;color:#111827}
      #sphEditHome{flex:0 0 auto;min-width:62px;padding:7px 10px}
      .sph-sr-only{position:absolute!important;width:1px!important;height:1px!important;padding:0!important;margin:-1px!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;white-space:nowrap!important;border:0!important}
      #sphHomeEditor{position:fixed;inset:0;z-index:170500;display:none;align-items:center;justify-content:center;padding:16px;background:rgba(15,23,42,.72)}
      #sphHomeEditor.show{display:flex}
      .sph-home-editor-card{width:min(520px,100%);background:#fff;border-radius:14px;padding:18px;box-shadow:0 24px 70px rgba(15,23,42,.35)}
      .sph-home-editor-card h2{margin:0 0 5px;font-size:18px}.sph-home-editor-card p{margin:0 0 14px}
      .sph-home-editor-card label{display:grid;gap:5px;font-size:11px;font-weight:900}
      #sphHomeLabel{width:100%;box-sizing:border-box;padding:10px;border:1px solid #cbd5e1;border-radius:8px;font:inherit}
      #sphHomeEditStatus{min-height:18px;margin-top:8px;font-size:11px;color:#64748b}#sphHomeEditStatus.error{color:#991b1b}#sphHomeEditStatus.success{color:#166534}
      .sph-home-editor-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:13px}.sph-home-editor-actions button{min-height:38px}
      body.sph-home-editor-open{overflow:hidden}
      @media(max-width:560px){#sphHomeAddressDisplay{white-space:normal;line-height:1.25}.sph-home-editor-actions{display:grid;grid-template-columns:1fr}.sph-home-editor-actions button{width:100%}}
    `
    document.head.appendChild(style)
  }

  function ensurePanel(){
    const field=$('field')
    if(!field)return false
    ensureStyles()
    let panel=$('sphWorkdayControl')
    if(!panel){
      panel=document.createElement('section')
      panel.id='sphWorkdayControl'
      panel.className='card'
      panel.setAttribute('aria-labelledby','sphWorkdayTitle')
      panel.innerHTML='<div class="sph-workday-summary"><div class="sph-workday-copy"><span id="sphWorkdayTitle" class="sph-workday-title">Sales / Hour Workday</span><strong id="sphHomeAddressDisplay">Home address not configured</strong></div><button id="sphEditHome" class="assign-btn" type="button">EDIT</button></div><div id="sphPresenceStatus" class="sph-sr-only" role="status" aria-live="polite">Connecting workday tracking…</div>'
      field.insertBefore(panel,field.firstElementChild)
      $('sphEditHome').addEventListener('click',openEditor)
    }

    let editor=$('sphHomeEditor')
    if(!editor){
      editor=document.createElement('div')
      editor.id='sphHomeEditor'
      editor.setAttribute('role','dialog')
      editor.setAttribute('aria-modal','true')
      editor.setAttribute('aria-labelledby','sphHomeEditorTitle')
      editor.setAttribute('aria-hidden','true')
      editor.innerHTML='<div class="sph-home-editor-card"><h2 id="sphHomeEditorTitle">Edit Home address</h2><p class="muted small">This address label and your current precise location are used only for Sales/Hour workday exit detection.</p><label for="sphHomeLabel">Home address<input id="sphHomeLabel" maxlength="200" autocomplete="street-address" placeholder="Street address, city, state ZIP"></label><div id="sphHomeEditStatus" role="status" aria-live="polite"></div><div class="sph-home-editor-actions"><button id="sphCancelHome" class="assign-btn" type="button">CANCEL</button><button id="sphSaveHome" class="primary" type="button">SAVE HOME AT CURRENT LOCATION</button></div></div>'
      document.body.appendChild(editor)
      $('sphCancelHome').addEventListener('click',closeEditor)
      $('sphSaveHome').addEventListener('click',saveHome)
      editor.addEventListener('click',event=>{if(event.target===editor)closeEditor()})
      document.addEventListener('keydown',event=>{if(event.key==='Escape'&&editor.classList.contains('show'))closeEditor()})
    }
    renderHome()
    window.dispatchEvent(new CustomEvent('mccoy-sph-workday-ready',{detail:{homeConfigured,homeLabel}}))
    return true
  }

  function initialize(){
    if(initialized||!signedIn())return
    initialized=true
    ensurePanel()
    loadStatus().catch(error=>{
      console.error('Sales/Hour status failed',error)
      const display=$('sphHomeAddressDisplay')
      if(display)display.textContent='Home address unavailable'
    })
    record('login')
  }

  window.addEventListener('mccoy-access-ready',initialize)
  window.addEventListener('mccoy-sale-saved',()=>record('sale'))
  window.addEventListener('mccoy-field-session-started',()=>record('field_start'))
  window.addEventListener('mccoy-field-session-ended',()=>record('field_end'))
  window.addEventListener('online',()=>record('heartbeat'))
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')record('heartbeat');else{clearTimeout(timer);timer=null}})
  window.addEventListener('pagehide',()=>{clearTimeout(timer);timer=null})
  const poll=setInterval(()=>{if(signedIn()){clearInterval(poll);initialize()}},300)
  window.MCCOY_SPH_PRESENCE={record,refresh:loadStatus,editHome:openEditor}
})()
