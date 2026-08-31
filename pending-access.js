const PENDING_SUPABASE_URL='https://athxxrfqxwlfnuvbqadp.supabase.co';
const PENDING_SUPABASE_KEY='sb_publishable_UB8C4-fhWPLpba6xta6EKg_hBtZC2iT';
const pendingClient=window.supabase.createClient(PENDING_SUPABASE_URL,PENDING_SUPABASE_KEY);

const pendingById=id=>document.getElementById(id);
const pendingAuthCard=pendingById('pendingAuthCard');
const pendingAccessCard=pendingById('pendingAccessCard');
const pendingAuthMessage=pendingById('pendingAuthMessage');
const pendingAccessMessage=pendingById('pendingAccessMessage');
const pendingAccessList=pendingById('pendingAccessList');
const pendingAccessCount=pendingById('pendingAccessCount');
let pendingBusy=false;

function pendingSetMessage(element,text,ok=false){
  if(!element)return;
  element.textContent=text;
  element.style.color=ok?'#166534':'#991b1b';
}

function pendingDate(value){
  if(!value)return'Never';
  const date=new Date(value);
  return Number.isNaN(date.getTime())?'Unknown':date.toLocaleString();
}

function pendingStatus(account){
  if(account.waiting_for_email_confirmation&&account.access_active)return'Email not confirmed · access pre-granted';
  if(account.waiting_for_email_confirmation)return'Email not confirmed';
  if(account.request?.status==='pending')return'Approval requested';
  if(account.access_state==='access_inactive')return'Access inactive';
  if(account.access_state==='no_access_record')return'McCoy access not created';
  return'Admin attention required';
}

async function pendingErrorDetail(error,fallback='Request failed.'){
  let detail=error?.message||fallback;
  try{
    if(error?.context?.clone){
      const body=await error.context.clone().json();
      detail=body?.detail||body?.error||detail;
    }
  }catch(_error){}
  return String(detail||fallback).replaceAll('_',' ');
}

async function pendingInvoke(functionName,body){
  const {data,error}=await pendingClient.functions.invoke(functionName,{body});
  if(error)throw new Error(await pendingErrorDetail(error));
  if(data?.error)throw new Error(data.detail||data.error);
  return data||{};
}

async function pendingVerifyAdmin(){
  const {data:{user},error:userError}=await pendingClient.auth.getUser();
  if(userError||!user?.email)throw new Error(userError?.message||'No signed-in McCoy Admin session was found.');
  const email=user.email.trim().toLowerCase();
  const {data:access,error:accessError}=await pendingClient.from('app_user_access')
    .select('email,display_name,role,active')
    .eq('email',email)
    .maybeSingle();
  if(accessError)throw accessError;
  if(!access?.active||access.role!=='admin')throw new Error('Active McCoy Admin access is required.');
  return{user,access};
}

function pendingElement(tag,text,className){
  const element=document.createElement(tag);
  if(text!==undefined&&text!==null)element.textContent=String(text);
  if(className)element.className=className;
  return element;
}

function pendingActionButton(text,className='assign-btn'){
  const button=pendingElement('button',text,className);
  button.type='button';
  return button;
}

function pendingRenderAccount(account){
  const card=pendingElement('article',null,'card');
  card.style.margin='0';
  card.style.borderColor=account.waiting_for_email_confirmation?'#f3d28b':'#dbeafe';

  const heading=pendingElement('div');
  heading.style.cssText='display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap';
  const identity=pendingElement('div');
  identity.appendChild(pendingElement('strong',account.display_name||account.email));
  const email=pendingElement('div',account.email,'muted small');
  identity.appendChild(email);
  const badge=pendingElement('span',pendingStatus(account),'badge');
  badge.style.background=account.waiting_for_email_confirmation?'#fef3c7':'#dbeafe';
  badge.style.color=account.waiting_for_email_confirmation?'#92400e':'#1e40af';
  heading.append(identity,badge);
  card.appendChild(heading);

  const details=pendingElement('div');
  details.style.cssText='display:grid;gap:4px;margin-top:10px;font-size:12px;color:#4b5563';
  details.appendChild(pendingElement('span',`Account created: ${pendingDate(account.account_created_at)}`));
  details.appendChild(pendingElement('span',`Email confirmed: ${account.email_confirmed_at?pendingDate(account.email_confirmed_at):'No'}`));
  details.appendChild(pendingElement('span',`Last authentication: ${pendingDate(account.last_sign_in_at)}`));
  details.appendChild(pendingElement('span',`Access request: ${account.request?.status||'Not submitted'}`));
  details.appendChild(pendingElement('span',`McCoy access: ${account.access_active?'Already granted':'Not active'}`));
  if(account.waiting_for_email_confirmation){
    const warning=pendingElement('strong','This user must confirm the email address before the account can sign in normally.');
    warning.style.color='#92400e';
    details.appendChild(warning);
  }
  card.appendChild(details);

  const actions=pendingElement('div');
  actions.style.cssText='display:flex;gap:8px;flex-wrap:wrap;margin-top:12px';
  const grant=pendingActionButton(account.access_active?'ACCESS ALREADY GRANTED':'GRANT ACCESS',account.access_active?'assign-btn':'primary');
  grant.disabled=Boolean(account.access_active);
  actions.appendChild(grant);
  const reset=pendingActionButton('RESET PASSWORD');
  actions.appendChild(reset);
  card.appendChild(actions);

  const form=pendingElement('div');
  form.hidden=true;
  form.style.cssText='display:grid;grid-template-columns:minmax(180px,1fr) minmax(180px,1fr) auto auto;gap:8px;margin-top:10px';
  const password=pendingElement('input');
  password.type='password';password.autocomplete='new-password';password.placeholder='New password (8+ characters)';
  const confirmation=pendingElement('input');
  confirmation.type='password';confirmation.autocomplete='new-password';confirmation.placeholder='Confirm new password';
  const apply=pendingActionButton('UPDATE PASSWORD','primary');
  const cancel=pendingActionButton('CANCEL');
  form.append(password,confirmation,apply,cancel);
  card.appendChild(form);
  const message=pendingElement('div',null,'muted small');
  message.style.marginTop='8px';
  card.appendChild(message);

  grant.addEventListener('click',async()=>{
    if(account.access_active||pendingBusy)return;
    pendingBusy=true;grant.disabled=true;reset.disabled=true;grant.textContent='GRANTING…';
    try{
      await pendingInvoke('rep-onboarding',{action:'grant_pending_account_access',email:account.email,display_name:account.display_name});
      pendingSetMessage(message,'Access granted. Refreshing…',true);
      await pendingLoad();
    }catch(error){
      pendingSetMessage(message,error?.message||'Unable to grant access.');
      grant.disabled=false;reset.disabled=false;grant.textContent='GRANT ACCESS';
    }finally{pendingBusy=false;}
  });

  reset.addEventListener('click',()=>{
    form.hidden=false;
    form.style.display='grid';
    reset.hidden=true;
    password.focus();
  });
  cancel.addEventListener('click',()=>{
    password.value='';confirmation.value='';form.hidden=true;form.style.display='none';reset.hidden=false;message.textContent='';
  });
  apply.addEventListener('click',async()=>{
    if(pendingBusy)return;
    if(password.value.length<8){pendingSetMessage(message,'Use a password with at least 8 characters.');return;}
    if(password.value!==confirmation.value){pendingSetMessage(message,'Passwords do not match.');return;}
    pendingBusy=true;apply.disabled=true;grant.disabled=true;cancel.disabled=true;apply.textContent='UPDATING…';
    try{
      const action=account.access_active?'reset_user_password':'reset_pending_password';
      await pendingInvoke('rep-onboarding',{action,email:account.email,password:password.value});
      password.value='';confirmation.value='';form.hidden=true;form.style.display='none';reset.hidden=false;
      pendingSetMessage(message,'Password updated securely.',true);
    }catch(error){
      pendingSetMessage(message,error?.message||'Unable to update this password.');
    }finally{
      pendingBusy=false;apply.disabled=false;grant.disabled=Boolean(account.access_active);cancel.disabled=false;apply.textContent='UPDATE PASSWORD';
    }
  });

  return card;
}

async function pendingLoad(){
  if(pendingBusy)return;
  pendingBusy=true;
  const refresh=pendingById('pendingRefresh');
  if(refresh){refresh.disabled=true;refresh.textContent='REFRESHING…';}
  pendingSetMessage(pendingAccessMessage,'Loading authoritative pending-account data…',true);
  try{
    const {access}=await pendingVerifyAdmin();
    const data=await pendingInvoke('pending-account-access',{action:'list'});
    const accounts=Array.isArray(data.accounts)?data.accounts:[];
    pendingAuthCard.hidden=true;
    pendingAccessCard.hidden=false;
    pendingAccessList.replaceChildren();
    pendingAccessCount.textContent=String(accounts.length);
    if(!accounts.length){
      pendingAccessList.appendChild(pendingElement('div','No login accounts currently require Admin attention.','muted'));
    }else{
      for(const account of accounts)pendingAccessList.appendChild(pendingRenderAccount(account));
    }
    pendingSetMessage(pendingAccessMessage,`${accounts.length} account${accounts.length===1?'':'s'} require attention. Signed in as ${access.display_name||access.email}.`,true);
  }catch(error){
    pendingAccessCard.hidden=true;
    pendingAuthCard.hidden=false;
    pendingSetMessage(pendingAuthMessage,error?.message||'Unable to load Pending Account Access.');
  }finally{
    pendingBusy=false;
    if(refresh){refresh.disabled=false;refresh.textContent='REFRESH';}
  }
}

pendingById('pendingSignIn').addEventListener('click',async()=>{
  const button=pendingById('pendingSignIn');
  const email=pendingById('pendingEmail').value.trim().toLowerCase();
  const password=pendingById('pendingPassword').value;
  if(!email||!password){pendingSetMessage(pendingAuthMessage,'Enter the Admin email and password.');return;}
  button.disabled=true;button.textContent='SIGNING IN…';pendingSetMessage(pendingAuthMessage,'Signing in…',true);
  try{
    const {error}=await pendingClient.auth.signInWithPassword({email,password});
    if(error)throw error;
    await pendingLoad();
  }catch(error){pendingSetMessage(pendingAuthMessage,error?.message||'Unable to sign in.');}
  finally{button.disabled=false;button.textContent='SIGN IN';}
});

pendingById('pendingRefresh').addEventListener('click',pendingLoad);
pendingById('pendingSignOut').addEventListener('click',async()=>{await pendingClient.auth.signOut();location.reload();});
window.addEventListener('focus',()=>{if(!document.hidden&&pendingAccessCard&&!pendingAccessCard.hidden)pendingLoad();});
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&pendingAccessCard&&!pendingAccessCard.hidden)pendingLoad();});
setInterval(()=>{if(!document.hidden&&pendingAccessCard&&!pendingAccessCard.hidden)pendingLoad();},30000);

(async()=>{
  const {data:{session}}=await pendingClient.auth.getSession();
  if(session)await pendingLoad();
})();
