const SUPABASE_URL='https://athxxrfqxwlfnuvbqadp.supabase.co';
const SUPABASE_PUBLISHABLE_KEY='sb_publishable_UB8C4-fhWPLpba6xta6EKg_hBtZC2iT';
const sb=window.supabase.createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY);

const authMsg=document.getElementById('authMsg');
const uploadMsg=document.getElementById('uploadMsg');
const signInBtn=document.getElementById('signIn');
const uploadBtn=document.getElementById('upload');

function setAuth(message,ok=false){
  authMsg.textContent=message;
  authMsg.style.color=ok?'#166534':'#991b1b';
}

async function verifyAdmin(){
  const {data:{user},error:userError}=await sb.auth.getUser();
  if(userError||!user?.email) throw new Error(userError?.message||'No signed-in McCoy user found.');
  const {data:access,error:accessError}=await sb.from('app_user_access').select('role,active,display_name').eq('email',user.email.toLowerCase()).maybeSingle();
  if(accessError) throw accessError;
  if(!access?.active||access.role!=='admin') throw new Error('Admin access required.');
  return {user,access};
}

async function restoreSession(){
  try{
    const {data:{session}}=await sb.auth.getSession();
    if(!session) return;
    const {access}=await verifyAdmin();
    setAuth(`Already signed in as ${access.display_name||session.user.email}.`,true);
    signInBtn.textContent='SIGNED IN';
  }catch(e){
    await sb.auth.signOut().catch(()=>{});
  }
}

signInBtn.addEventListener('click',async()=>{
  try{
    signInBtn.disabled=true;
    setAuth('Signing in…',true);
    const email=document.getElementById('email').value.trim().toLowerCase();
    const password=document.getElementById('password').value;
    if(!email||!password) throw new Error('Enter your McCoy Admin email and password.');
    const {error}=await sb.auth.signInWithPassword({email,password});
    if(error) throw error;
    const {access}=await verifyAdmin();
    setAuth(`Admin signed in as ${access.display_name||email}.`,true);
    signInBtn.textContent='SIGNED IN';
  }catch(e){
    await sb.auth.signOut().catch(()=>{});
    setAuth(e?.message||String(e));
    signInBtn.textContent='SIGN IN';
  }finally{
    signInBtn.disabled=false;
  }
});

uploadBtn.addEventListener('click',async()=>{
  try{
    uploadBtn.disabled=true;
    const f=document.getElementById('file').files[0];
    if(!f) throw new Error('Choose the downloaded SPOTIO capture JSON first.');
    uploadMsg.textContent='Checking Admin session…';
    await verifyAdmin();
    uploadMsg.textContent='Reading capture…';
    const raw=JSON.parse(await f.text());
    const {data:{session}}=await sb.auth.getSession();
    if(!session) throw new Error('Sign in as Admin first.');
    uploadMsg.textContent='Uploading securely…';
    const r=await fetch(SUPABASE_URL+'/functions/v1/spotio-import',{method:'POST',headers:{Authorization:'Bearer '+session.access_token,apikey:SUPABASE_PUBLISHABLE_KEY,'Content-Type':'application/json'},body:JSON.stringify({source_filename:f.name,captured_at:raw.finished_at||raw.started_at||new Date().toISOString(),raw_payload:raw})});
    const d=await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(d.error||'Upload failed');
    uploadMsg.style.color='#166534';
    uploadMsg.textContent='Capture stored securely. Batch '+d.batch.id+' · '+(d.batch.record_count??'unknown')+' captured responses.';
  }catch(e){
    uploadMsg.style.color='#991b1b';
    uploadMsg.textContent=e?.message||String(e);
  }finally{
    uploadBtn.disabled=false;
  }
});

restoreSession();
