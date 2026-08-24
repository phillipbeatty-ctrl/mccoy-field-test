const SUPABASE_URL = "https://athxxrfqxwlfnuvbqadp.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_UB8C4-fhWPLpba6xta6EKg_hBtZC2iT";
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

const APP_VERSION = "6.1-adaptive-gps-test-auth-fix";
function uuidv4(){
  if(crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c=>{
    const r=Math.random()*16|0, v=c==='x'?r:(r&0x3|0x8);
    return v.toString(16);
  });
}
let telemetrySessionId = null;

async function saveTestSessionStart(startedAt){
  telemetrySessionId = uuidv4();
  const { error } = await sb.from("test_sessions").insert({
    id: telemetrySessionId,
    tester_name: "Phillip Beatty",
    started_at: new Date(startedAt).toISOString(),
    user_agent: navigator.userAgent,
    app_version: APP_VERSION
  });
  if(error){
    console.error("Telemetry session insert failed", error);
    telemetrySessionId = null;
    return false;
  }
  return true;
}

async function saveTestEvent({
  eventType,
  leadLabel=null,
  disposition=null,
  eventTime=Date.now(),
  gps=null,
  dwellMs=null,
  payload=null,
  gpsQuality=null,
  isGpsVerified=null,
  leadLat=null,
  leadLng=null,
  distanceMeters=null
}){
  if(!telemetrySessionId) return;
  const row = {
    session_id: telemetrySessionId,
    event_type: eventType,
    lead_label: leadLabel,
    disposition,
    event_time: new Date(eventTime).toISOString(),
    latitude: gps?.lat ?? null,
    longitude: gps?.lng ?? null,
    accuracy_meters: gps?.accuracy ?? null,
    gps_fix_age_ms: gps?.ageMs != null ? Math.round(gps.ageMs) : null,
    dwell_ms: dwellMs != null ? Math.round(dwellMs) : null,
    gps_quality: gpsQuality,
    is_gps_verified: isGpsVerified,
    lead_latitude: leadLat,
    lead_longitude: leadLng,
    distance_to_lead_meters: distanceMeters,
    payload
  };
  const { error } = await sb.from("test_events").insert(row);
  if(error) console.error("Telemetry event insert failed", error);
}

function telemetryStatus(msg, ok=true){
  const el=document.getElementById("telemetryStatus");
  if(!el) return;
  el.textContent=msg;
  el.style.color=ok?"#137a45":"#b42318";
}

function classifyGps(gps){
  if(!gps) return {quality:"Unverified", verified:false, reason:"No GPS fix"};
  const ageMs = gps.ageMs ?? Math.max(0, Date.now() - (gps.capturedAt || Date.now()));
  const acc = gps.accuracy ?? Infinity;
  if(ageMs > 10000) return {quality:"Stale", verified:false, reason:`Fix ${(ageMs/1000).toFixed(1)}s old`};
  if(acc <= 15 && ageMs <= 5000) return {quality:"Verified", verified:true, reason:`±${Math.round(acc)}m, ${(ageMs/1000).toFixed(1)}s old`};
  if(acc <= 30 && ageMs <= 10000) return {quality:"Acceptable", verified:false, reason:`±${Math.round(acc)}m, ${(ageMs/1000).toFixed(1)}s old`};
  if(acc <= 50 && ageMs <= 10000) return {quality:"Poor", verified:false, reason:`±${Math.round(acc)}m, ${(ageMs/1000).toFixed(1)}s old`};
  return {quality:"Unverified", verified:false, reason:`±${Math.round(acc)}m accuracy`};
}

function updateGpsQualityBox(gps){
  const q=classifyGps(gps);
  const box=document.getElementById("gpsQualityBox");
  if(!box) return q;
  box.className=`gps-quality gps-${q.quality.toLowerCase()}`;
  box.textContent=`GPS ${q.quality}${q.verified?" ✓":""} — ${q.reason}`;
  return q;
}

const state = {
  teams: [
    {name:"Pacific Northwest", manager:"Aaron Ruff", leads:0},
    {name:"North Carolina", manager:null, leads:0}
  ],
  people: [
    {name:"Phillip Beatty", role:"Admin", team:null},
    {name:"Aaron Ruff", role:"Manager", team:"Pacific Northwest"}
  ],
  leads: [],
  session: null,
  activities: [],
  activeDoorVisit: null,
  latestGps: null,
  gpsWatchId: null,
  breadcrumbs: [],
  lastTelemetryBreadcrumbAt: 0,
  calibrationLead: null
};

const pnwStreets = ["NE 72nd Ave","SE Division St","NE Alberta St","NW 23rd Ave","SE Hawthorne Blvd"];
const ncStreets = ["Hay St","Bragg Blvd","Cliffdale Rd","Raeford Rd","Ramsey St"];

function seedLeads(n=20){
  const start = state.leads.length + 1;
  for(let i=0;i<n;i++){
    const team = i%2===0 ? "Pacific Northwest" : "North Carolina";
    const streets = team==="Pacific Northwest" ? pnwStreets : ncStreets;
    state.leads.push({
      id:start+i,
      address:`${1100+i*3} ${streets[i%streets.length]}`,
      team,
      rep:null,
      disposition:"Uncontacted"
    });
  }
}
// Demo addresses are opt-in for administrators and must never be seeded into rep sessions.
state.demoLeads=[];
state.realLeads=[];
state.leadMode='real';

document.getElementById("projectUrl").textContent = SUPABASE_URL;

document.querySelectorAll(".nav-btn").forEach(btn=>{
  btn.addEventListener("click",()=>{
    document.querySelectorAll(".nav-btn").forEach(x=>x.classList.remove("active"));
    document.querySelectorAll(".view").forEach(x=>x.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(btn.dataset.view).classList.add("active");
    document.getElementById("pageTitle").textContent = btn.textContent;
  });
});

function renderDashboard(){
  document.getElementById("statTotalLeads").textContent = state.teams.reduce((a,b)=>a+b.leads,0).toLocaleString();
  document.getElementById("statPNW").textContent = state.teams.find(t=>t.name==="Pacific Northwest").leads.toLocaleString();
  document.getElementById("statNC").textContent = state.teams.find(t=>t.name==="North Carolina").leads.toLocaleString();
  document.getElementById("statManagers").textContent = state.teams.filter(t=>t.manager).length;
  document.getElementById("allocationBars").innerHTML = state.teams.map(t=>`
    <div class="progress-row"><div class="progress-label"><span>${t.name}</span><strong>${t.leads.toLocaleString()}</strong></div><div class="progress-track"><div class="progress-fill" style="width:${t.leads/100}%"></div></div></div>`).join("");
  document.getElementById("managerStatus").innerHTML = state.teams.map(t=>`
    <div class="manager-row"><div><strong>${t.name}</strong><div class="muted small">${t.manager||"No manager assigned"}</div></div><div class="${t.manager?"status-ok":"status-warn"}">${t.manager?"Assigned":"Manager Needed"}</div></div>`).join("");
}

function assignManager(teamName, personName){
  const team = state.teams.find(t=>t.name===teamName);
  state.teams.forEach(t=>{ if(t.manager===personName) t.manager=null; });
  team.manager = personName;
  const person = state.people.find(p=>p.name===personName);
  if(person) person.team = teamName;
  renderAll();
  alert(`${personName} is now manager of ${teamName} in DEMO MODE.`);
}
window.assignManager = assignManager;

function renderTeams(){
  document.getElementById("teamsTable").innerHTML = `<table><thead><tr><th>Team</th><th>Manager</th><th>Lead Pool</th><th>Action</th></tr></thead><tbody>${state.teams.map(t=>`<tr><td><strong>${t.name}</strong></td><td>${t.manager||'<span class="status-warn">Manager Needed</span>'}</td><td>${t.leads.toLocaleString()}</td><td>${t.name==="North Carolina" && !t.manager ? `<button class="assign-btn" onclick="assignManager('North Carolina','Phillip Beatty')">Assign Phillip</button>` : `<span class="muted">—</span>`}</td></tr>`).join("")}</tbody></table>`;
}

function renderLeads(){
  const filter = document.getElementById("teamFilter").value;
  const q = document.getElementById("leadSearch").value.toLowerCase();
  const rows = state.leads.filter(l=>(!filter||l.team===filter) && (!q||`${l.address} ${l.rep||""}`.toLowerCase().includes(q)));
  document.getElementById("leadsTable").innerHTML = `<table><thead><tr><th>Address</th><th>Team</th><th>Assigned Rep</th><th>Disposition</th></tr></thead><tbody>${rows.map(l=>`<tr><td>${l.address}</td><td>${l.team}</td><td>${l.rep||'<span class="muted">Unassigned</span>'}</td><td>${l.disposition}</td></tr>`).join("")}</tbody></table>`;
  renderFieldLeadSelect();
}
document.getElementById("teamFilter").addEventListener("change",renderLeads);
document.getElementById("leadSearch").addEventListener("input",renderLeads);
document.getElementById("addDemoLeadsBtn").addEventListener("click",()=>{seedLeads(10);renderLeads();});

function renderFieldLeadSelect(){
  const el=document.getElementById("fieldLeadSelect");if(!el)return;
  const leads=state.leads||[],current=el.value,first=leads[0],last=leads[leads.length-1],signature=`${state.leadMode||"real"}:${leads.length}:${first?.dbId||first?.id||""}:${last?.dbId||last?.id||""}`;
  if(el.dataset.mccoyLeadSignature===signature&&el.options.length){if(current)el.value=current;return;}
  const MAX_FIELD_OPTIONS=750,visible=leads.slice(0,MAX_FIELD_OPTIONS);if(current&&!visible.some(lead=>String(lead.id)===String(current))){const selected=leads.find(lead=>String(lead.id)===String(current));if(selected)visible.push(selected);}
  const escape=value=>String(value??"").replace(/[&<>"\']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","\'":"&#39;"}[char]));
  el.innerHTML=visible.map(lead=>`<option value="${escape(lead.id)}">${escape(lead.address)} — ${escape(lead.team)}</option>`).join("")+(leads.length>MAX_FIELD_OPTIONS?`<option disabled>Showing ${MAX_FIELD_OPTIONS.toLocaleString()} of ${leads.length.toLocaleString()} leads — use Lead Pool search for more</option>`:"");
  el.dataset.mccoyLeadSignature=signature;if(current)el.value=current;
}

function getGPSOnce(){
  return new Promise((resolve,reject)=>{
    if(!navigator.geolocation) return reject(new Error("Geolocation not supported."));
    navigator.geolocation.getCurrentPosition(
      p=>resolve({lat:p.coords.latitude,lng:p.coords.longitude,accuracy:p.coords.accuracy,capturedAt:Date.now()}),
      e=>{publishGpsError(e,'initial');reject(e);},
      {enableHighAccuracy:true,timeout:10000,maximumAge:0}
    );
  });
}

function publishGpsUpdate(gps,source='watch'){
  if(!gps)return;
  window.dispatchEvent(new CustomEvent('mccoy-gps-update',{detail:{gps:{...gps},source,sessionActive:Boolean(state.session)}}));
}

function publishGpsError(error,source='watch'){
  const code=Number(error?.code),reason=code===1?'permission_denied':code===2?'position_unavailable':code===3?'timeout':'unknown';
  window.dispatchEvent(new CustomEvent('mccoy-gps-error',{detail:{reason,code:Number.isFinite(code)?code:null,message:String(error?.message||''),source,sessionActive:Boolean(state.session)}}));
}

function startGpsWatch(){
  if(!navigator.geolocation || state.gpsWatchId!==null) return;
  state.gpsWatchId = navigator.geolocation.watchPosition(
    p=>{
      state.latestGps = {lat:p.coords.latitude,lng:p.coords.longitude,accuracy:p.coords.accuracy,capturedAt:Date.now()};
      publishGpsUpdate(state.latestGps,'watch');
      if(state.session){
        state.breadcrumbs.push({...state.latestGps, eventType:"breadcrumb"});
        const now=Date.now();
        if(!state.lastTelemetryBreadcrumbAt || now-state.lastTelemetryBreadcrumbAt>=5000){
          state.lastTelemetryBreadcrumbAt=now;
          saveTestEvent({eventType:"breadcrumb",eventTime:now,gps:{...state.latestGps,ageMs:0}});
        }
      }
      document.getElementById("geoBox").textContent = `Live GPS: ${state.latestGps.lat.toFixed(6)}, ${state.latestGps.lng.toFixed(6)} (±${Math.round(state.latestGps.accuracy)}m)`;
      updateGpsQualityBox({...state.latestGps,ageMs:0});
    },
    e=>{publishGpsError(e,'watch');document.getElementById("geoBox").textContent = "GPS permission unavailable. Use localhost/HTTPS and allow location access.";},
    {enableHighAccuracy:true,maximumAge:2000,timeout:15000}
  );
}

function stopGpsWatch(){
  if(state.gpsWatchId!==null && navigator.geolocation){navigator.geolocation.clearWatch(state.gpsWatchId);state.gpsWatchId=null;}
}

function snapshotGpsInstant(){
  const now = Date.now();
  if(!state.latestGps) return null;
  return {...state.latestGps,snapshotAt:now,ageMs:now-state.latestGps.capturedAt};
}

function requestFreshGpsInBackground(callback){
  if(!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    p=>{const fresh={lat:p.coords.latitude,lng:p.coords.longitude,accuracy:p.coords.accuracy,capturedAt:Date.now()};state.latestGps=fresh;publishGpsUpdate(fresh,'fresh_request');if(callback) callback(fresh);},
    e=>publishGpsError(e,'fresh_request'),
    {enableHighAccuracy:true,timeout:5000,maximumAge:0}
  );
}

let timerHandle=null;
function fmt(ms){
  const s=Math.floor(ms/1000), h=Math.floor(s/3600), m=Math.floor((s%3600)/60), sec=s%60;
  return [h,m,sec].map(v=>String(v).padStart(2,"0")).join(":");
}
function startTimer(){
  clearInterval(timerHandle);
  timerHandle=setInterval(()=>{if(state.session) document.getElementById("elapsed").textContent=fmt(Date.now()-state.session.startedAt);},1000);
}

document.getElementById("startKnockingBtn").addEventListener("click", async ()=>{
  let gps=null;
  try{gps=await getGPSOnce(); state.latestGps=gps;}catch(e){}
  const startedAt=Date.now();
  state.session={startedAt,startGps:gps};
  if(gps){state.breadcrumbs.push({...gps,eventType:"session_start"});publishGpsUpdate(gps,'session_start');}
  startGpsWatch();
  document.getElementById("fieldState").textContent="Knocking — Session Active";
  document.getElementById("startKnockingBtn").classList.add("hidden");
  document.getElementById("stopKnockingBtn").classList.remove("hidden");
  document.getElementById("geoBox").textContent=gps?`Start GPS: ${gps.lat.toFixed(6)}, ${gps.lng.toFixed(6)} (±${Math.round(gps.accuracy)}m)`:"GPS permission unavailable; session still started in demo.";
  updateGpsQualityBox(gps?{...gps,ageMs:0}:null);
  startTimer();
  telemetryStatus("Saving test session...");
  const ok=await saveTestSessionStart(startedAt);
  telemetryStatus(ok?"Live test telemetry connected.":"Telemetry connection failed — browser console has details.", ok);
  if(ok){await saveTestEvent({eventType:"session_start",eventTime:startedAt,gps});}
});

document.getElementById("stopKnockingBtn").addEventListener("click", ()=>{
  let gps=snapshotGpsInstant();
  const duration=Date.now()-state.session.startedAt;
  if(gps) state.breadcrumbs.push({...gps,eventType:"session_end"});
  saveTestEvent({eventType:"session_end",eventTime:Date.now(),gps});
  state.session=null;
  state.activeDoorVisit=null;
  clearInterval(timerHandle);
  stopGpsWatch();
  document.getElementById("doorElapsed").textContent="00:00";
  document.getElementById("doorVisitStatus").textContent="No active door visit.";
  document.getElementById("fieldState").textContent=`Session Complete — ${fmt(duration)}`;
  document.getElementById("startKnockingBtn").classList.remove("hidden");
  document.getElementById("stopKnockingBtn").classList.add("hidden");
  document.getElementById("geoBox").textContent=gps?`Stop GPS: ${gps.lat.toFixed(6)}, ${gps.lng.toFixed(6)} (±${Math.round(gps.accuracy)}m)`:"Stop GPS unavailable.";
});
