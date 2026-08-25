import {Capacitor} from '@capacitor/core';
import {BackgroundGeolocation} from '@capgo/background-geolocation';
import {createClient} from '@supabase/supabase-js';

const SUPABASE_URL='https://athxxrfqxwlfnuvbqadp.supabase.co';
const SUPABASE_PUBLISHABLE_KEY='sb_publishable_UB8C4-fhWPLpba6xta6EKg_hBtZC2iT';
const client=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY);
let activeSessionId=null;
let sessionToken=null;
let started=false;

window.FIELD_COACH_NATIVE={available:Capacitor.isNativePlatform(),platform:Capacitor.getPlatform(),started:false};
if(Capacitor.isNativePlatform())document.documentElement.dataset.fieldCoachNative='true';

function randomToken(){
  const bytes=new Uint8Array(32);crypto.getRandomValues(bytes);
  return [...bytes].map(value=>value.toString(16).padStart(2,'0')).join('');
}
function status(message,ok=true){
  const el=document.getElementById('telemetryStatus');
  if(el){el.textContent=message;el.style.color=ok?'#137a45':'#b42318'}
}
function handleLocation(location,error){
  if(error){console.warn('Field Coach native location error',error);status('Native location needs attention. Open device location settings if tracking does not resume.',false);return}
  if(!location||!activeSessionId)return;
  window.dispatchEvent(new CustomEvent('mccoy-gps-update',{detail:{gps:{lat:Number(location.latitude),lng:Number(location.longitude),accuracy:Number(location.accuracy),capturedAt:Number(location.time||Date.now())},source:'native_background',sessionActive:true}}));
}
async function startNative(sessionId){
  if(!Capacitor.isNativePlatform()||!sessionId||started)return;
  const {data:{user}}=await client.auth.getUser();
  if(!user)throw new Error('native_auth_required');
  const token=randomToken();
  const {error}=await client.rpc('register_native_location_token',{p_session_id:sessionId,p_token:token});
  if(error)throw error;
  activeSessionId=sessionId;sessionToken=token;
  await BackgroundGeolocation.start({
    backgroundMessage:'Field Coach is tracking your location during an active field session.',
    backgroundTitle:'Field Coach — session active',
    requestPermissions:true,
    stale:false,
    distanceFilter:10,
    minIntervalMs:15000,
    url:`${SUPABASE_URL}/functions/v1/native-location-ingest?session_id=${encodeURIComponent(sessionId)}`,
    headers:{'x-mccoy-location-token':token}
  },handleLocation);
  started=true;window.FIELD_COACH_NATIVE.started=true;
  try{window.stopGpsWatch?.()}catch{}
  status('Native field tracking active — Field Coach can continue location tracking while you use other apps.',true);
}
async function stopNative(sessionId){
  if(!Capacitor.isNativePlatform())return;
  try{if(started)await BackgroundGeolocation.stop()}catch(error){console.warn('Native location stop failed',error)}
  try{if(sessionId)await client.rpc('revoke_native_location_token',{p_session_id:sessionId})}catch(error){console.warn('Native token revoke failed',error)}
  started=false;window.FIELD_COACH_NATIVE.started=false;activeSessionId=null;sessionToken=null;
  status('Native field tracking stopped.',true);
}

window.addEventListener('mccoy-field-session-started',event=>startNative(event.detail?.sessionId).catch(error=>{console.error('Native tracking start failed',error);status('Field session started, but native background tracking did not start. Keep Field Coach open and check location permissions.',false)}));
window.addEventListener('mccoy-field-session-ended',event=>stopNative(event.detail?.sessionId));
