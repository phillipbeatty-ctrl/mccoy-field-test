// V8 security + blind tester access layer
// UI hiding is for test integrity. Database authorization is enforced separately by Supabase RLS.
window.MCCOY_ACCESS = { user:null, access:null };

(function(){
  const style=document.createElement('style');
  style.textContent=`
    #authGate{position:fixed;inset:0;z-index:99999;background:#f4f6f8;display:flex;align-items:center;justify-content:center;padding:20px}
    #authGate.hidden{display:none!important}
    .auth-card{width:min(430px,100%);background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:24px;box-shadow:0 12px 40px rgba(0,0,0,.12)}
    .auth-card h2{margin:0 0 8px}.auth-card p{color:#6b7280;font-size:13px}.auth-card input{width:100%;padding:12px;margin:6px 0;border:1px solid #d1d5db;border-radius:9px}.auth-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px}.auth-msg{font-size:12px;margin-top:10px;min-height:18px}.user-strip{position:fixed;right:12px;bottom:12px;z-index:1000;background:#111827;color:#fff;border-radius:999px;padding:7px 10px;font-size:11px;display:flex;gap:8px;align-items:center}.user-strip button{border:0;border-radius:999px;padding:4px 7px;cursor:pointer}
    body.blind-tester .sidebar{display:none!important}
    body.blind-tester .main{margin-left:0!important}
    body.blind-tester #dashboard,body.blind-tester #teams,body.blind-tester #leads,body.blind-tester #settings{display:none!important}
    body.blind-tester #field{display:block!important;padding:16px!important}
    body.blind-tester .topbar .muted,body.blind-tester #modeBadge{display:none!important}
    body.blind-tester .topbar{height:68px;padding:0 16px}
    body.blind-tester #pageTitle{font-size:20px}
    body.blind-tester #geoBox,body.blind-tester #gpsQualityBox,body.blind-tester #doorPresenceBox,body.blind-tester #telemetryStatus{display:none!important}
    body.blind-tester .field-controls>.geo-box:not(#telemetryStatus){display:none!important}
    body.blind-tester .grid-2>.card:nth-child(2){display:none!important}
    body.blind-tester .calibration-panel{display:none!important}
    body.blind-tester #doorVisitStatus,body.blind-tester .door-visit-panel .muted,body.blind-tester .door-timer{display:none!important}
    body.blind-tester #activityLog,body.blind-tester #efficiencySummary{display:none!important}
    body.blind-tester #arriveDoorBtn{margin:8px 0 14px}
    body.blind-tester .card-head p{display:none!important}
    body.blind-tester .card-head h2{font-size:15px}
    body.blind-tester .disposition-grid{margin-top:8px}
  `;
  document.head.appendChild(style);

  const gate=document.createElement('div');
  gate.id='authGate';
  gate.innerHTML=`<div class="auth-card">
    <h2>McCoy Field</h2>
    <p>Authorized testing access only.</p>
    <input id="authEmail" type="email" autocomplete="email" placeholder="Email address" />
    <input id="authPassword" type="password" autocomplete="current-password" placeholder="Password" />
    <div class="auth-actions"><button id="signInBtn" class="primary">SIGN IN</button><button id="signUpBtn" class="assign-btn">CREATE ACCOUNT</button></div>
    <div id="authMsg" class="auth-msg"></div>
  </div>`;
  document.body.appendChild(gate);

  function msg(text,ok=false){const el=document.getElementById('authMsg');if(el){el.textContent=text;el.style.color=ok?'#166534':'#991b1b';}}

  async function getAccess(user){
    if(!user?.email) return null;
    const {data,error}=await sb.from('app_user_access').select('email,role,active,display_name').eq('email',user.email.toLowerCase()).maybeSingle();
    if(error){console.error(error);return null;}
    return data?.active?data:null;
  }

  function applyMode(user,access){
    window.MCCOY_ACCESS={user,access};
    document.getElementById('authGate')?.classList.add('hidden');
    document.body.classList.toggle('blind-tester',access.role!=='admin');
    if(access.role!=='admin'){
      document.getElementById('pageTitle').textContent='Field Test';
      document.getElementById('arriveDoorBtn').textContent='I PHYSICALLY KNOCKED THIS DOOR';
      document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
      document.getElementById('field')?.classList.add('active');
    }else{
      document.getElementById('arriveDoorBtn').textContent='ARRIVE AT DOOR / START VISIT';
    }
    let strip=document.getElementById('userStrip');
    if(!strip){strip=document.createElement('div');strip.id='userStrip';strip.className='user-strip';document.body.appendChild(strip);}
    strip.innerHTML=`<span>${access.display_name||user.email} · ${access.role}</span><button id="signOutBtn">Sign out</button>`;
    document.getElementById('signOutBtn').onclick=async()=>{await sb.auth.signOut();location.reload();};
  }

  async function authorizeCurrent(){
    const {data:{user}}=await sb.auth.getUser();
    if(!user) return false;
    const access=await getAccess(user);
    if(!access){
      await sb.auth.signOut();
      msg('This email is not authorized for McCoy Field testing.');
      return false;
    }
    applyMode(user,access);return true;
  }

  document.getElementById('signInBtn').onclick=async()=>{
    msg('Signing in...',true);
    const email=document.getElementById('authEmail').value.trim().toLowerCase();
    const password=document.getElementById('authPassword').value;
    const {error}=await sb.auth.signInWithPassword({email,password});
    if(error){msg(error.message);return;}
    await authorizeCurrent();
  };

  document.getElementById('signUpBtn').onclick=async()=>{
    const email=document.getElementById('authEmail').value.trim().toLowerCase();
    const password=document.getElementById('authPassword').value;
    if(password.length<8){msg('Use a password at least 8 characters long.');return;}
    msg('Creating account...',true);
    const {data,error}=await sb.auth.signUp({email,password});
    if(error){msg(error.message);return;}
    if(data.session){await authorizeCurrent();}
    else msg('Account created. Check your email for the confirmation link, then return here and sign in.',true);
  };

  // Replace the prototype session writer with the authenticated identity-aware version required by RLS.
  saveTestSessionStart = async function(startedAt){
    const {data:{user},error:userError}=await sb.auth.getUser();
    if(userError||!user){console.error(userError);return false;}
    const access=window.MCCOY_ACCESS.access || await getAccess(user);
    if(!access) return false;
    telemetrySessionId=uuidv4();
    const {error}=await sb.from('test_sessions').insert({
      id:telemetrySessionId,
      tester_name:access.display_name||user.email,
      tester_user_id:user.id,
      tester_email:user.email,
      started_at:new Date(startedAt).toISOString(),
      user_agent:navigator.userAgent,
      app_version:'8.0-secure-blind-test'
    });
    if(error){console.error('Telemetry session insert failed',error);telemetrySessionId=null;return false;}
    return true;
  };

  authorizeCurrent();
})();
