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
    stale_location:'A pin changed while this GPS reading was being captured. No pins moved. Press ADD ADDRESS again for a fresh reading.',
    fresh_gps_required:'The GPS reading expired before saving. Press ADD ADDRESS again for a fresh reading.',
    valid_gps_required:'A current GPS position with accuracy information is required. Your address is retained.',
    use_selected_door_contact_editor:'Select the customer’s door on the map to update its contact information. No pins moved.',
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
      'ADD ADDRESS moves this address and its units to your current GPS location. Accuracy is recorded.':
      'Admin doorway pilot for this account. Existing matching pins will move when you add an address.';
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
  async function placeAddress({address,contact={},isCurrent=()=>true,onProgress=()=>{}}){
    const key=identity();
    if(!(await ready())?.enabled)return null;
    if(!isCurrent()||key!==identity())return null;
    const fingerprint=JSON.stringify([key,address,contact]);
    let input=pending.get(fingerprint);
    if(!input){
      onProgress('Capturing your door location. Existing matching pins and units will move here…');
      const gps=await freshGps();
      if(!isCurrent()||key!==identity())return null;
      input={address:{...address},contact:{...contact},gps,request_id:crypto.randomUUID()};
      pending.set(fingerprint,input);
    }else onProgress('Checking the previous placement request…');
    try{
      const data=await call('place_address',input);pending.delete(fingerprint);return data;
    }catch(error){
      // A lost response may follow a committed transaction. Reuse the exact body
      // and UUID until the server confirms the result or a definite rejection.
      if(!['network_uncertain','gps_placement_unavailable','gps_placement_failed'].includes(error.code))pending.delete(fingerprint);
      throw error;
    }
  }
  function placementMessage(data){
    if(!data?.source)return null;
    const count=Number(data.moved_count||0);
    return `${data.created?'Address added. ':''}${count} ${count===1?'pin placed':'pins placed'} at your GPS location (±${Math.round(data.accuracy_meters)} m).`+
      (data.low_accuracy?' Low accuracy recorded; a better reading on a later door visit can improve this pin.':'')+
      (data.requires_door_selection?' Choose a door from the map’s stacked pins to work with a specific lead.':'');
  }
  async function captureForDisposition({activityType,automatic=false}){
    if(automatic||activityType!=='Visit'||!preview)return null;
    const key=identity();
    try{
      if(!(await ready())?.enabled)return null;
      const gps=await freshGps();
      if(identity()!==key)return null;
      return{lat:gps.latitude,lng:gps.longitude,accuracy:gps.accuracy_meters,capturedAt:Date.parse(gps.captured_at),placementAccount:key};
    }catch(_){return null;} // A missing fix must not prevent a door disposition.
  }
  async function dispositionSaved({visitId,leadId,gps}){
    if(!visitId||!leadId||!gps?.placementAccount||gps.placementAccount!==identity())return '';
    const key=identity();
    try{
      const data=await call('refine_disposition',{request_id:visitId,visit_id:visitId,gps:{latitude:gps.lat,longitude:gps.lng,accuracy_meters:gps.accuracy,captured_at:new Date(gps.capturedAt).toISOString()}});
      if(key!==identity())return '';
      if(data.moved_count){
        for(const lead of (typeof state!=='undefined'?state.realLeads||[]:[]))if(String(lead.dbId||lead.id)===String(leadId)){
          lead.lat=data.latitude;lead.lng=data.longitude;lead.pinLocationUpdatedAt=data.pin_version;
        }
        window.dispatchEvent(new CustomEvent('mccoy-leads-updated',{detail:{source:'gps_disposition_refinement',leadId}}));
        return ` Pin location improved (±${Math.round(data.accuracy_meters)} m).`;
      }
      return ' Pin retained: the GPS reading was not more accurate.';
    }catch(_){
      return key===identity()?' Disposition saved; the pin location could not be updated.':'';
    }
  }
  window.MCCOY_GPS_PLACEMENT=Object.freeze({placeAddress,placementMessage,captureForDisposition,dispositionSaved,refreshStatus});
  window.addEventListener('mccoy-access-ready',()=>{refreshStatus().catch(()=>{});});
  window.addEventListener('mccoy-sales-hub-layout-ready',renderNotice);
  if(preview&&window.MCCOY_ACCESS?.access?.active)refreshStatus().catch(()=>{});
})();
