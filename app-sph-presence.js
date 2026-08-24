// Authenticated workday presence for the authoritative Sales/Hour denominator.
// This is independent of the Start/Stop Knocking button: while McCoy is open,
// it records a lightweight, consent-gated location sample every five minutes.
(()=>{
  if(window.MCCOY_SPH_PRESENCE)return

  const SAMPLE_MS=5*60*1000
  const RETRY_MS=45*1000
  const FRESH_GPS_MS=2*60*1000
  let timer=null
  let inFlight=false
  let initialized=false

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

  async function loadStatus(){
    const {data,error}=await sb.rpc('get_sph_status')
    if(error||!data?.ok)throw error||new Error(data?.reason||'sph_status_failed')
    const home=$('sphHomeStatus'),presence=$('sphPresenceStatus')
    if(home)home.textContent=data.home_configured?`Home set${data.home_label?` · ${data.home_label}`:''}`:'Home not set · homeward exit detection is unavailable'
    if(presence&&data.today?.status_label)presence.textContent=data.today.status_label
    return data
  }

  function ensurePanel(){
    const field=$('field')
    if(!field||$('sphWorkdayControl'))return
    const panel=document.createElement('div')
    panel.id='sphWorkdayControl'
    panel.className='card'
    panel.style.marginBottom='14px'
    panel.innerHTML='<div class="card-head"><div><h2>Sales / Hour Workday</h2><p class="muted">Generated from authenticated McCoy workday sessions. Start/Stop Knocking does not shorten the timer.</p></div><button id="sphRefreshStatus" class="assign-btn" type="button">Refresh</button></div><div id="sphPresenceStatus" class="muted small" role="status" aria-live="polite">Connecting workday tracking…</div><div style="display:flex;gap:8px;align-items:end;flex-wrap:wrap;margin-top:10px"><label style="flex:1;min-width:210px"><span class="muted small">Private Home label or address</span><input id="sphHomeLabel" maxlength="200" autocomplete="street-address" placeholder="Home" style="display:block;width:100%;box-sizing:border-box;margin-top:4px;padding:9px;border:1px solid #d1d5db;border-radius:8px"></label><button id="sphSetHome" class="primary" type="button">SET HOME AT CURRENT LOCATION</button></div><div id="sphHomeStatus" class="muted small" style="margin-top:7px">Checking Home…</div><p class="muted small">Home coordinates are private and used only to detect a workday exit. Sunday is excluded. One lunch hour is removed automatically.</p>'
    const first=field.firstElementChild
    field.insertBefore(panel,first)
    $('sphRefreshStatus').onclick=()=>loadStatus().catch(error=>{$('sphPresenceStatus').textContent=error?.message||'Unable to load Sales/Hour status.'})
    $('sphSetHome').onclick=async()=>{
      const button=$('sphSetHome'),status=$('sphHomeStatus')
      if(!consented()){$('privacyModal')?.classList.add('show');status.textContent='Accept the current Privacy & Location Notice before setting Home.';return}
      button.disabled=true;button.textContent='GETTING LOCATION…';status.textContent='Getting your current location…'
      try{
        const gps=await currentGps()
        if(!gps)throw new Error('A current GPS location is required.')
        const {data,error}=await sb.rpc('set_sph_home_location',{p_home_label:$('sphHomeLabel').value.trim()||'Home',p_latitude:gps.lat,p_longitude:gps.lng,p_accuracy_meters:gps.accuracy})
        if(error||!data?.ok)throw error||new Error(data?.reason||'home_update_failed')
        status.textContent='Home location saved privately for Sales/Hour exit detection.'
        await record('home_update',true)
      }catch(error){console.error('Home location update failed',error);status.textContent=error?.message||'Unable to save Home. Move outdoors and retry.'}
      finally{button.disabled=false;button.textContent='SET HOME AT CURRENT LOCATION'}
    }
  }

  function initialize(){
    if(initialized||!signedIn())return
    initialized=true
    ensurePanel()
    loadStatus().catch(error=>console.error('Sales/Hour status failed',error))
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
  window.MCCOY_SPH_PRESENCE={record,refresh:loadStatus}
})()
