// Explicit doorway actions only. No watchPosition, interval, nearest-lead choice,
// or automatic arrival/departure. The server owns pilot and movement permissions.
(()=>{
  if(window.MCCOY_GPS_PLACEMENT)return;
  const preview=/^https?:$/.test(location.protocol)&&(
    /^(localhost|127\.0\.0\.1)$/.test(location.hostname)||
    /^mccoy-field-test-(?:git-|[a-z0-9]+-)[a-z0-9-]+\.vercel\.app$/.test(location.hostname));
  const identity=()=>`${window.MCCOY_ACCESS?.user?.id||''}:${window.MCCOY_ACCESS?.access?.organization_id||''}`;
  const consented=()=>typeof mccoyConsentAccepted!=='undefined'&&mccoyConsentAccepted===true;
  let account='',status=null,loading=null,notice=null;
  const pending=new Map();
  const messages={
    current_location_consent_required:'Accept the current location notice before placing a pin.',
    gps_pilot_not_enabled:'The GPS pilot is paused for this account. Your address is retained.',
    address_group_not_authorized:'Some pins at this address are outside your movement permissions. No pins moved. Ask your Manager or Admin to place the group.',
    lead_not_authorized:'This pin is outside your movement permissions.',
    stale_location:'A pin changed while this GPS reading was being captured. No pins moved. Tap KNOCK DOOR again for a fresh reading.',
    fresh_gps_required:'The GPS reading expired before saving. Tap KNOCK DOOR again for a fresh reading.',
    valid_gps_required:'A current GPS position with accuracy information is required. Your address is retained.',
    use_selected_door_contact_editor:'Select the customer’s door on the map to update its contact information. No pins moved.',
    active_manual_knock_required:'Start a manual door visit before updating its pin.',
    knock_address_changed:'The address differs from the started visit. No pins moved.',
    unsupported_action:'Reload this preview to use KNOCK DOOR for GPS placement.',
    organization_access_denied:'This organization does not currently have lead-management access.',
  };
  async function call(action,input={}){
    const {data,error}=await sb.functions.invoke('lead-gps-placement',{body:{action,input}});
    let failure=data;
    if(error?.context?.clone){try{failure=await error.context.clone().json();}catch(_){}}
    if(error||!data?.ok){
      const code=failure?.error||'network_uncertain';
      const problem=new Error(messages[code]||'GPS placement could not be confirmed. Your address is retained; retry to check the same request.');
      problem.code=code;throw problem;
    }
    return data;
  }
  function renderNotice(){
    if(!preview)return;
    const button=document.getElementById('addFieldAddressBtn');
    if(!button)return;
    if(!notice?.isConnected){
      notice=document.createElement('div');notice.id='gpsPlacementPilotNotice';notice.className='muted small';
      notice.style.cssText='margin-top:6px';
      const toggle=document.createElement('button');toggle.id='gpsPlacementPilotToggle';toggle.type='button';
      toggle.style.cssText='min-height:44px;margin-right:8px';
      toggle.addEventListener('click',togglePilot);
      const text=document.createElement('span');text.id='gpsPlacementPilotStatus';text.setAttribute('role','status');
      notice.append(toggle,text);(button.closest('.field-lead-combobox')||button.parentElement).appendChild(notice);
    }
    notice.hidden=!status?.can_manage&&!status?.enabled;
    const toggle=notice.querySelector('button');toggle.hidden=!status?.can_manage;
    toggle.textContent=status?.enabled?'PAUSE GPS PILOT':'START GPS PILOT';
    notice.querySelector('span').textContent=status?.enabled?
      'KNOCK DOOR places this address and its units at your GPS location. ADD ADDRESS does not move pins.':
      'Admin doorway pilot for this account. Matching pins move when you tap KNOCK DOOR.';
  }
  function refreshStatus(){
    if(!preview||!window.MCCOY_ACCESS?.access?.active||!window.MCCOY_ACCESS?.user?.id){status=null;renderNotice();return Promise.resolve(null);}
    const key=identity();
    if(key!==account){account=key;status=null;loading=null;pending.clear();}
    if(loading)return loading;
    const request=call('status').then(data=>{if(identity()===key){status=data;renderNotice();}return data;});
    loading=request;
    request.finally(()=>{if(loading===request)loading=null;}).catch(()=>{});
    return request;
  }
  async function ready(){
    if(!preview)return null;
    if(identity()!==account||!status)await refreshStatus();
    return status;
  }
  async function togglePilot(){
    const key=identity(),button=document.getElementById('gpsPlacementPilotToggle');if(button)button.disabled=true;
    try{
      const result=await call('set_pilot',{enabled:!status?.enabled});
      if(identity()!==key)return;
      status=result;pending.clear();renderNotice();
    }catch(error){if(identity()===key&&notice)notice.querySelector('span').textContent=error.message;}
    finally{if(button)button.disabled=false;}
  }
  function freshGps(){
    if(!consented())return Promise.reject(new Error(messages.current_location_consent_required));
    return new Promise((resolve,reject)=>{
      if(!navigator.geolocation){reject(new Error(messages.valid_gps_required));return;}
      navigator.geolocation.getCurrentPosition(position=>{
        const {latitude,longitude,accuracy}=position.coords||{},capturedAt=Number(position.timestamp);
        if(![latitude,longitude,accuracy,capturedAt].every(Number.isFinite)||Math.abs(latitude)>90||Math.abs(longitude)>180||accuracy<0||accuracy>100000||Date.now()-capturedAt>30000||capturedAt-Date.now()>5000){
          reject(new Error(messages.valid_gps_required));return;
        }
        resolve({latitude,longitude,accuracy_meters:accuracy,captured_at:new Date(capturedAt).toISOString()});
      },error=>reject(new Error(error?.code===1?
        'Location permission was denied. Your address is retained; you can still process the sale.':
        'A current GPS reading is unavailable. Your address is retained; retry or process the sale.')),
      {enableHighAccuracy:true,maximumAge:0,timeout:7000});
    });
  }
  async function submit(action,fingerprint,input){
    pending.set(fingerprint,input);
    try{
      const data=await call(action,input);pending.delete(fingerprint);return data;
    }catch(error){
      // Lost responses retry the exact payload; definite rejections permit a new fix.
      if(!['network_uncertain','gps_placement_unavailable','gps_placement_failed'].includes(error.code))pending.delete(fingerprint);
      throw error;
    }
  }
  async function addAddress({address,contact={},isCurrent=()=>true}){
    const key=identity();
    if(!(await ready())?.enabled||!isCurrent()||key!==identity())return null;
    const fingerprint=JSON.stringify(['add',key,address,contact]);
    const input=pending.get(fingerprint)||{address:{...address},contact:{...contact},request_id:crypto.randomUUID()};
    return submit('add_address',fingerprint,input);
  }
  async function knockDoor({visitId,address,isCurrent=()=>true,onProgress=()=>{}}){
    const key=identity();
    if(!(await ready())?.enabled||!isCurrent()||key!==identity())return null;
    if(!visitId)throw new Error(messages.active_manual_knock_required);
    const fingerprint=JSON.stringify(['knock',key,visitId,address]);
    let input=pending.get(fingerprint);
    if(!input){
      onProgress('Door visit started. Capturing GPS to place this address and its units…');
      const gps=await freshGps();
      if(!isCurrent()||key!==identity())return null;
      input={visit_id:visitId,address:address?{...address}:null,gps,request_id:crypto.randomUUID()};
    }else onProgress('Door visit started. Checking the previous GPS save…');
    const data=await submit('knock_door',fingerprint,input);
    return isCurrent()&&key===identity()?data:null;
  }
  function placementMessage(data){
    if(!data?.source)return null;
    if(data.source==='address_only')return `${data.created?'Address added to the Lead Pool.':'Address found in the Lead Pool.'} Tap KNOCK DOOR at the door to place its pin.`+(data.requires_door_selection?' Choose a specific door from the map’s stacked pins when needed.':'');
    const count=Number(data.moved_count||0);
    return `${data.created?'Address added. ':''}${count} ${count===1?'pin placed':'pins placed'} at your GPS location (±${Math.round(data.accuracy_meters)} m).`+
      (data.low_accuracy?' Low accuracy recorded; the next KNOCK DOOR can update this location.':'')+
      (data.requires_door_selection?' Choose a door from the map’s stacked pins to work with a specific lead.':'');
  }
  function versionMicros(value){
    const match=String(value||'').match(/^(.*:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/);
    if(!match)return null;
    const seconds=Date.parse(match[1]+match[3]);
    return Number.isFinite(seconds)?BigInt(seconds)*1000n+BigInt((match[2]||'').padEnd(6,'0').slice(0,6)):null;
  }
  function applyPlacement(data){
    if(data?.source!=='user_reported_door'||!Array.isArray(data.lead_ids)||!data.pin_version)return;
    const ids=new Set(data.lead_ids.map(String)),version=versionMicros(data.pin_version);
    if(version===null)return;
    // A list request can have started before the placement transaction. Apply its
    // confirmed coordinates after that list resolves, but retain any newer edit.
    const rows=typeof state!=='undefined'?[...(state.realLeads||[]),...(state.leads||[])]:[];
    let changed=false;
    for(const lead of new Set(rows))if(ids.has(String(lead.dbId||lead.id))){
      const current=versionMicros(lead.updatedAt);
      if(current!==null&&current>version)continue;
      if(current===version&&lead.lat===data.latitude&&lead.lng===data.longitude)continue;
      changed=true;
      lead.lat=data.latitude;lead.lng=data.longitude;lead.updatedAt=data.pin_version;
      lead.geocodeProvider='device_gps';lead.geocodePrecision='reported_door';
      lead.geocodeStatus='field_reported';lead.geocodeVerificationStatus=data.low_accuracy?'gps_reported_door_low_accuracy':'gps_reported_door';
    }
    if(changed)window.dispatchEvent(new CustomEvent('mccoy-leads-updated',{detail:{source:'gps_placement',leadIds:data.lead_ids}}));
  }
  window.MCCOY_GPS_PLACEMENT=Object.freeze({addAddress,knockDoor,placementMessage,applyPlacement,refreshStatus});
  window.addEventListener('mccoy-access-ready',()=>{refreshStatus().catch(()=>{});});
  window.addEventListener('mccoy-sales-hub-layout-ready',renderNotice);
  if(preview&&window.MCCOY_ACCESS?.access?.active)refreshStatus().catch(()=>{});
})();
