import {Capacitor} from '@capacitor/core';
import {BackgroundGeolocation} from '@capgo/background-geolocation';
import {createClient} from '@supabase/supabase-js';

const SUPABASE_URL='https://athxxrfqxwlfnuvbqadp.supabase.co';
const SUPABASE_PUBLISHABLE_KEY='sb_publishable_UB8C4-fhWPLpba6xta6EKg_hBtZC2iT';
const client=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY);
const QUEUE_KEY='field_coach_native_location_queue_v1';
let activeSessionId=null;
let sessionToken=null;
let started=false;
let flushing=false;

window.FIELD_COACH_NATIVE={available:Capacitor.isNativePlatform(),platform:Capacitor.getPlatform(),started:false};
if(Capacitor.isNativePlatform())document.documentElement.dataset.fieldCoachNative='true';

function randomToken(){
  const bytes=new Uint8Array(32);crypto.getRandomValues(bytes);
  return [...bytes].map(value=>value.toString(16).padStart(2,'0')).join('');
}
function queue(){try{return JSON.parse(localStorage.getItem(QUEUE_KEY)||'[]')}catch{return[]}}
function saveQueue(items){localStorage.setItem(QUEUE_KEY,JSON.stringify(items.slice(-1000)))}
function enqueue(location){const items=queue();items.push(location);saveQueue(items)}
function status(message,ok=true){
  const el=document.getElementById('telemetryStatus');
  if(el){el.textContent=message;el.style.color=ok?'#137a45':'#b42318'}
}
async function postLocation(location){
  if(!activeSessionId||!sessionToken)return false;
  const response=await fetch(`${SUPABASE_URL}/functions/v1/native-location-ingest?session_id=${encodeURIComponent(activeSessionId)}`,{
    method:'POST',headers:{'Content-Type':'application/json','x-mccoy-location-token':sessionToken},body:JSON.stringify(location)
  });
  if(!response.ok)throw new Error(`native_location_http_${response.status}`);
  return true;
}
async function flushQueue(){
  if(flushing||!activeSessionId||!sessionToken||navigator.onLine===false)return;
  flushing=true;
  try{
    const items=queue(),remaining=[];
    for(const item of items){try{await postLocation(item)}catch{remaining.push(item);break}}
    if(remaining.length){const firstFailed=items.indexOf(remaining[0]);saveQueue(items.slice(firstFailed))}else saveQueue([]);
  }finally{flushing=false}
}
async function handleLocation(location,error){
  if(error){console.warn('Field Coach native location error',error);status('Native location needs attention. Open device location settings if tracking does not resume.',false);return}
  if(!location||!activeSessionId)return;
  const normalized={latitude:Number(location.latitude),longitude:Number(location.longitude),accuracy:Number(location.accuracy),altitude:location.altitude??null,bearing:location.bearing??null,speed:location.speed??null,time:Number(location.time||Date.now()),simulated:location.simulated===true};
  window.dispatchEvent(new CustomEvent('mccoy-gps-update',{detail:{gps:{lat:normalized.latitude,lng:normalized.longitude,accuracy:normalized.accuracy,capturedAt:normalized.time},source:'native_background',sessionActive:true}}));
  try{await postLocation(normalized);await flushQueue()}catch(fetchError){console.warn('Native location queued for retry',fetchError);enqueue(normalized)}
}
async function startNative(sessionId){
  if(!Capacitor.isNativePlatform()||!sessionId||started)return;
  const {data:{user}}=await client.auth.getUser();
  if(!user)throw new Error('native_auth_required');
  const token=randomToken();
  const {error}=await client.rpc('register_native_location_token',{p_session_id:sessionId,p_token:token});
  if(error)throw error;
  activeSessionId=sessionId;sessionToken=token;
  await BackgroundGeolocation.start({backgroundMessage:'Field Coach is tracking your location during an active field session.',backgroundTitle:'Field Coach — session active',requestPermissions:true,stale:false,distanceFilter:10},handleLocation);
  started=true;window.FIELD_COACH_NATIVE.started=true;
  try{window.stopGpsWatch?.()}catch{}
  status('Native field tracking active — Field Coach can continue location tracking while you use other apps.',true);
  await flushQueue();
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
window.addEventListener('online',flushQueue);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')flushQueue()});
