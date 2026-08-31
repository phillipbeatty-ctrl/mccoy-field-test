const CONFIRM_SUPABASE_URL='https://athxxrfqxwlfnuvbqadp.supabase.co';
const CONFIRM_SUPABASE_KEY='sb_publishable_UB8C4-fhWPLpba6xta6EKg_hBtZC2iT';
const confirmClient=window.supabase.createClient(CONFIRM_SUPABASE_URL,CONFIRM_SUPABASE_KEY);
const confirmById=id=>document.getElementById(id);
const confirmMessage=confirmById('confirmEmailMessage');
const confirmProvider=confirmById('confirmEmailProvider');
const confirmLinkPanel=confirmById('confirmEmailLinkPanel');
const confirmLinkButton=confirmById('confirmEmailLinkButton');
const confirmResendButton=confirmById('confirmEmailResendButton');
let confirmMailReady=false;
let confirmBusy=false;

function confirmSetMessage(text,ok=false){
  confirmMessage.textContent=text;
  confirmMessage.style.color=ok?'#166534':'#991b1b';
}
function confirmSafeNext(value){
  const next=String(value||'/');
  return next.startsWith('/')&&!next.startsWith('//')?next:'/';
}
async function confirmAudit(){
  try{await confirmClient.functions.invoke('auth-email-confirmed',{body:{action:'confirmed'}});}catch(_error){}
}
async function confirmSuccess(session){
  await confirmAudit();
  const email=session?.user?.email||'';
  confirmSetMessage(`Email confirmed${email?` for ${email}`:''}. You can now continue to McCoy.`,true);
  confirmLinkPanel.hidden=true;
  const next=confirmSafeNext(new URLSearchParams(location.search).get('next'));
  history.replaceState({},document.title,location.pathname);
  setTimeout(()=>{location.href=next;},1200);
}
async function confirmProviderStatus(){
  try{
    const {data,error}=await confirmClient.functions.invoke('auth-email-status',{body:{}});
    if(error||!data?.ok)throw error||new Error('Email status unavailable');
    confirmMailReady=data.production_ready===true;
    confirmResendButton.disabled=!confirmMailReady;
    if(data.fully_observable){
      confirmProvider.textContent=`Production email active · ${data.sender_name||'McCoy'} <${data.sender_email}> · delivery tracking active`;
      confirmProvider.style.borderColor='#86efac';
      confirmProvider.style.background='#f0fdf4';
    }else if(confirmMailReady){
      confirmProvider.textContent=`Production email active · ${data.sender_email||data.provider} · provider delivery webhook pending`;
      confirmProvider.style.borderColor='#f3d28b';
      confirmProvider.style.background='#fffbeb';
    }else{
      confirmProvider.textContent='Production confirmation email is not active yet. Admin must finish SMTP and verified-sender activation before resends are enabled.';
      confirmProvider.style.borderColor='#fca5a5';
      confirmProvider.style.background='#fef2f2';
    }
  }catch(_error){
    confirmMailReady=false;
    confirmResendButton.disabled=true;
    confirmProvider.textContent='Unable to verify the production email provider. Resend is disabled.';
  }
}
async function confirmTokenHash(){
  if(confirmBusy)return;
  const params=new URLSearchParams(location.search);
  const tokenHash=params.get('token_hash');
  const requestedType=params.get('type')||'email';
  if(!tokenHash)return;
  const allowedTypes=new Set(['email','signup','invite','recovery','email_change']);
  if(!allowedTypes.has(requestedType)){confirmSetMessage('This confirmation link has an unsupported token type.');return;}
  confirmBusy=true;
  confirmLinkButton.disabled=true;
  confirmLinkButton.textContent='CONFIRMING…';
  confirmSetMessage('Confirming your email address…',true);
  try{
    const {data,error}=await confirmClient.auth.verifyOtp({token_hash:tokenHash,type:requestedType});
    if(error)throw error;
    await confirmSuccess(data.session);
  }catch(error){
    confirmSetMessage(error?.message||'The confirmation link is invalid or expired. Request a fresh confirmation below.');
  }finally{
    confirmBusy=false;
    confirmLinkButton.disabled=false;
    confirmLinkButton.textContent='CONFIRM EMAIL ADDRESS';
  }
}
async function confirmCode(){
  if(confirmBusy)return;
  const email=confirmById('confirmEmailAddress').value.trim().toLowerCase();
  const token=confirmById('confirmEmailCode').value.trim().replace(/\s+/g,'');
  if(!email||!token){confirmSetMessage('Enter the email address and confirmation code.');return;}
  confirmBusy=true;
  const button=confirmById('confirmEmailCodeButton');
  button.disabled=true;button.textContent='VERIFYING…';
  try{
    const {data,error}=await confirmClient.auth.verifyOtp({email,token,type:'signup'});
    if(error)throw error;
    await confirmSuccess(data.session);
  }catch(error){confirmSetMessage(error?.message||'The confirmation code is invalid or expired.');}
  finally{confirmBusy=false;button.disabled=false;button.textContent='VERIFY CODE';}
}
async function confirmResend(){
  if(confirmBusy)return;
  if(!confirmMailReady){confirmSetMessage('McCoy production email is not active, so a resend was not attempted.');return;}
  const email=confirmById('confirmEmailResendAddress').value.trim().toLowerCase();
  if(!email){confirmSetMessage('Enter the email address that needs confirmation.');return;}
  confirmBusy=true;
  confirmResendButton.disabled=true;confirmResendButton.textContent='REQUESTING…';
  try{
    const {data,error}=await confirmClient.functions.invoke('auth-email-resend',{body:{email}});
    if(error)throw error;
    if(data?.error)throw new Error(data.detail||data.error);
    confirmSetMessage(data?.detail||'A fresh confirmation was requested. Check the inbox, spam, and junk folders.',true);
  }catch(error){confirmSetMessage(error?.message||'Unable to request a new confirmation.');}
  finally{confirmBusy=false;confirmResendButton.disabled=!confirmMailReady;confirmResendButton.textContent='RESEND CONFIRMATION';}
}

confirmLinkButton.addEventListener('click',confirmTokenHash);
confirmById('confirmEmailCodeButton').addEventListener('click',confirmCode);
confirmResendButton.addEventListener('click',confirmResend);

(async()=>{
  await confirmProviderStatus();
  const params=new URLSearchParams(location.search);
  const tokenHash=params.get('token_hash');
  if(tokenHash){
    confirmLinkPanel.hidden=false;
    confirmSetMessage('Confirmation token found. Press the confirmation button to complete verification.',true);
    return;
  }
  const errorDescription=params.get('error_description')||params.get('error');
  if(errorDescription)confirmSetMessage(String(errorDescription).replaceAll('+',' '));
  const {data:{session}}=await confirmClient.auth.getSession();
  if(session?.user?.email_confirmed_at){await confirmSuccess(session);}
})();
