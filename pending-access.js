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
const pendingMailStatus=pendingById('pendingMailStatus');
let pendingActionBusy=false;
let pendingLoadPromise=null;
let pendingMailConfiguration=null;

function pendingSetMessage(element,text,ok=false){
  if(!element)return;
  if(element.textContent!==text)element.textContent=text;
  const color=ok?'#166534':'#991b1b';
  if(element.style.color!==color)element.style.color=color;
}
function pendingDate(value){
  if(!value)return'Never';
  const date=new Date(value);
  return Number.isNaN(date.getTime())?'Unknown':date.toLocaleString();
}
function pendingStatus(account){
  if(account.requires_membership_repair)return'ACCESS INCOMPLETE — REPAIR ORGANIZATION ACCESS';
  if(account.waiting_for_email_confirmation&&account.access_active)return'Email not confirmed · access pre-granted';
  if(account.waiting_for_email_confirmation)return'Email not confirmed';
  if(account.request?.status==='pending')return'Approval requested';
  if(account.access_state==='access_inactive')return'Access inactive';
  if(account.access_state==='no_access_record')return'McCoy access not created';
  return'Admin attention required';
}
function pendingDeliveryLabel(delivery){
  if(!delivery)return'No McCoy delivery event recorded';
  const labels={
    accepted_by_auth:'Accepted by Auth; awaiting provider event',
    sent:'Sent by provider',
    delivered:'Delivered to recipient mail server',
    delivery_delayed:'Delivery delayed',
    bounced:'Bounced',
    complained:'Marked as spam',
    suppressed:'Suppressed by provider',
    failed:'Delivery failed',
    opened:'Opened',
    clicked:'Confirmation link clicked',
    confirmed:'Email ownership confirmed'
  };
  return labels[delivery.status]||String(delivery.status||delivery.event_type||'Unknown');
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
function pendingRenderMailConfiguration(configuration){
  pendingMailConfiguration=configuration||{};
  if(configuration?.fully_observable){
    pendingMailStatus.textContent=`Production email active · ${configuration.sender_name||'McCoy'} <${configuration.sender_email}> · delivery tracking active`;
    pendingMailStatus.style.borderColor='#86efac';
    pendingMailStatus.style.background='#f0fdf4';
  }else if(configuration?.production_ready){
    pendingMailStatus.textContent=`Production SMTP active through ${configuration.provider||'the configured provider'}, but delivery webhook verification is still pending.`;
    pendingMailStatus.style.borderColor='#f3d28b';
    pendingMailStatus.style.background='#fffbeb';
  }else{
    const missing=(configuration?.activation_required||[]).join(', ')||'SMTP configuration';
    pendingMailStatus.textContent=`Production confirmation delivery is not active. Missing: ${missing}. Resend controls are disabled so the app cannot falsely claim an email was sent.`;
    pendingMailStatus.style.borderColor='#fca5a5';
    pendingMailStatus.style.background='#fef2f2';
  }
}
async function pendingRunAction(action){
  if(pendingActionBusy)return;
  pendingActionBusy=true;
  try{return await action();}
  finally{pendingActionBusy=false;}
}
function pendingRenderAccount(account){
  const repair=account.requires_membership_repair===true;
  const card=pendingElement('article',null,'card');
  card.style.margin='0';
  card.style.borderColor=repair?'#fca5a5':account.waiting_for_email_confirmation?'#f3d28b':'#dbeafe';
  if(repair)card.style.background='#fff7f7';

  const heading=pendingElement('div');
  heading.style.cssText='display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap';
  const identity=pendingElement('div');
  identity.appendChild(pendingElement('strong',account.display_name||account.email));
  identity.appendChild(pendingElement('div',account.email,'muted small'));
  const badge=pendingElement('span',pendingStatus(account),'badge');
  badge.style.background=repair?'#fee2e2':account.waiting_for_email_confirmation?'#fef3c7':'#dbeafe';
  badge.style.color=repair?'#991b1b':account.waiting_for_email_confirmation?'#92400e':'#1e40af';
  heading.append(identity,badge);
  card.appendChild(heading);

  const details=pendingElement('div');
  details.style.cssText='display:grid;gap:4px;margin-top:10px;font-size:12px;color:#4b5563';
  details.appendChild(pendingElement('span',`Account created: ${pendingDate(account.account_created_at)}`));
  details.appendChild(pendingElement('span',`Latest Auth confirmation request: ${pendingDate(account.confirmation_sent_at)}`));
  details.appendChild(pendingElement('span',`Email confirmed: ${account.email_confirmed_at?pendingDate(account.email_confirmed_at):'No'}`));
  details.appendChild(pendingElement('span',`Last authentication: ${pendingDate(account.last_sign_in_at)}`));
  details.appendChild(pendingElement('span',`Access request: ${account.request?.status||'Not submitted'}`));
  details.appendChild(pendingElement('span',`McCoy access: ${account.access_active?'Active':'Not active'}`));
  const membershipLine=pendingElement('strong',`Organization membership: ${account.membership_active?'Active':'Missing or inactive'}`);
  membershipLine.style.color=account.membership_active?'#166534':'#991b1b';
  details.appendChild(membershipLine);
  if(account.membership_role)details.appendChild(pendingElement('span',`Membership role: ${account.membership_role}`));
  const deliveryLine=pendingElement('strong',`Delivery: ${pendingDeliveryLabel(account.delivery)}`);
  deliveryLine.style.color=['bounced','failed','complained','suppressed'].includes(account.delivery?.status)?'#991b1b':'#374151';
  details.appendChild(deliveryLine);
  if(account.delivery?.created_at)details.appendChild(pendingElement('span',`Delivery event time: ${pendingDate(account.delivery.created_at)}`));
  if(repair){
    const warning=pendingElement('strong','The login and McCoy access records exist, but the organization membership is incomplete. Repair it before asking the user to sign in again.');
    warning.style.color='#991b1b';
    details.appendChild(warning);
  }else if(account.waiting_for_email_confirmation){
    const warning=pendingElement('strong','This user must confirm ownership of the email address before normal sign-in.');
    warning.style.color='#92400e';
    details.appendChild(warning);
  }
  card.appendChild(details);

  const actions=pendingElement('div');
  actions.style.cssText='display:flex;gap:8px;flex-wrap:wrap;margin-top:12px';
  const grantText=repair?'REPAIR ORGANIZATION ACCESS':account.access_active?'ACCESS ALREADY GRANTED':'GRANT ACCESS';
  const grant=pendingActionButton(grantText,repair||!account.access_active?'primary':'assign-btn');
  grant.disabled=Boolean(account.access_active&&!repair);
  const reset=pendingActionButton('RESET PASSWORD');
  actions.appendChild(grant);

  if(account.waiting_for_email_confirmation){
    const resend=pendingActionButton('RESEND CONFIRMATION','primary');
    resend.disabled=!pendingMailConfiguration?.production_ready;
    resend.title=resend.disabled?'Production SMTP must be active before a resend is allowed.':'Send a fresh one-time confirmation through the verified production provider.';
    const confirmPage=pendingElement('a','OPEN CONFIRMATION PAGE','assign-btn');
    confirmPage.href=`/confirm-email.html?email=${encodeURIComponent(account.email)}`;
    confirmPage.style.cssText='text-decoration:none;display:inline-flex;align-items:center;justify-content:center;padding:8px 10px';
    actions.append(resend,confirmPage);
    resend.addEventListener('click',()=>pendingRunAction(async()=>{
      resend.disabled=true;
      grant.disabled=true;
      reset.disabled=true;
      resend.textContent='REQUESTING…';
      try{
        const data=await pendingInvoke('pending-account-access',{action:'resend_confirmation',email:account.email});
        await pendingLoad();
        pendingSetMessage(pendingAccessMessage,data.detail||'Fresh confirmation requested.',true);
      }catch(error){
        pendingSetMessage(pendingAccessMessage,error?.message||'Unable to resend confirmation.');
      }finally{
        resend.textContent='RESEND CONFIRMATION';
      }
    }));
  }

  actions.appendChild(reset);
  card.appendChild(actions);

  const form=pendingElement('div');
  form.hidden=true;
  form.style.cssText='display:none;grid-template-columns:minmax(180px,1fr) minmax(180px,1fr) auto auto;gap:8px;margin-top:10px';
  const password=pendingElement('input');
  password.type='password';
  password.autocomplete='new-password';
  password.placeholder='New password (8+ characters)';
  const confirmation=pendingElement('input');
  confirmation.type='password';
  confirmation.autocomplete='new-password';
  confirmation.placeholder='Confirm new password';
  const apply=pendingActionButton('UPDATE PASSWORD','primary');
  const cancel=pendingActionButton('CANCEL');
  form.append(password,confirmation,apply,cancel);
  card.appendChild(form);
  const message=pendingElement('div',null,'muted small');
  message.style.marginTop='8px';
  card.appendChild(message);

  grant.addEventListener('click',()=>pendingRunAction(async()=>{
    if(account.access_active&&!repair)return;
    grant.disabled=true;
    reset.disabled=true;
    grant.textContent=repair?'REPAIRING…':'GRANTING…';
    try{
      if(repair){
        await pendingInvoke('pending-account-access',{action:'repair_organization_access',email:account.email});
        await pendingLoad();
        pendingSetMessage(pendingAccessMessage,`Organization access repaired for ${account.display_name||account.email}.`,true);
      }else{
        await pendingInvoke('rep-onboarding',{action:'grant_pending_account_access',email:account.email,display_name:account.display_name});
        await pendingLoad();
        pendingSetMessage(pendingAccessMessage,`Access granted to ${account.display_name||account.email}.`,true);
      }
    }catch(error){
      grant.disabled=false;
      reset.disabled=false;
      grant.textContent=repair?'REPAIR ORGANIZATION ACCESS':'GRANT ACCESS';
      pendingSetMessage(message,error?.message||'Unable to complete this access action.');
    }
  }));
  reset.addEventListener('click',()=>{
    form.hidden=false;
    form.style.display='grid';
    reset.hidden=true;
    password.focus();
  });
  cancel.addEventListener('click',()=>{
    password.value='';
    confirmation.value='';
    form.hidden=true;
    form.style.display='none';
    reset.hidden=false;
    message.textContent='';
  });
  apply.addEventListener('click',()=>pendingRunAction(async()=>{
    if(password.value.length<8){pendingSetMessage(message,'Use a password with at least 8 characters.');return;}
    if(password.value!==confirmation.value){pendingSetMessage(message,'Passwords do not match.');return;}
    apply.disabled=true;
    grant.disabled=true;
    cancel.disabled=true;
    apply.textContent='UPDATING…';
    try{
      const action=account.access_active?'reset_user_password':'reset_pending_password';
      await pendingInvoke('rep-onboarding',{action,email:account.email,password:password.value});
      password.value='';
      confirmation.value='';
      form.hidden=true;
      form.style.display='none';
      reset.hidden=false;
      pendingSetMessage(message,'Password updated securely.',true);
    }catch(error){
      pendingSetMessage(message,error?.message||'Unable to update this password.');
    }finally{
      apply.disabled=false;
      grant.disabled=Boolean(account.access_active&&!repair);
      cancel.disabled=false;
      apply.textContent='UPDATE PASSWORD';
    }
  }));
  return card;
}
function pendingLoad(){
  if(pendingLoadPromise)return pendingLoadPromise;
  pendingLoadPromise=(async()=>{
    const refresh=pendingById('pendingRefresh');
    if(refresh){refresh.disabled=true;refresh.textContent='REFRESHING…';}
    pendingSetMessage(pendingAccessMessage,'Loading authoritative pending-account and organization-access data…',true);
    try{
      const {access}=await pendingVerifyAdmin();
      const data=await pendingInvoke('pending-account-access',{action:'list'});
      const accounts=Array.isArray(data.accounts)?data.accounts:[];
      pendingRenderMailConfiguration(data.mail_configuration||{});
      pendingAuthCard.hidden=true;
      pendingAccessCard.hidden=false;
      pendingAccessList.replaceChildren();
      pendingAccessCount.textContent=String(accounts.length);
      if(!accounts.length)pendingAccessList.appendChild(pendingElement('div','No login accounts currently require Admin attention.','muted'));
      else for(const account of accounts)pendingAccessList.appendChild(pendingRenderAccount(account));
      pendingSetMessage(pendingAccessMessage,`${accounts.length} account${accounts.length===1?'':'s'} require attention. Signed in as ${access.display_name||access.email}.`,true);
      return{ok:true,count:accounts.length};
    }catch(error){
      pendingAccessCard.hidden=true;
      pendingAuthCard.hidden=false;
      pendingSetMessage(pendingAuthMessage,error?.message||'Unable to load Pending Account Access.');
      return{ok:false,error};
    }finally{
      if(refresh){refresh.disabled=false;refresh.textContent='REFRESH';}
    }
  })().finally(()=>{pendingLoadPromise=null;});
  return pendingLoadPromise;
}

pendingById('pendingSignIn').addEventListener('click',()=>pendingRunAction(async()=>{
  const button=pendingById('pendingSignIn');
  const email=pendingById('pendingEmail').value.trim().toLowerCase();
  const password=pendingById('pendingPassword').value;
  if(!email||!password){pendingSetMessage(pendingAuthMessage,'Enter the Admin email and password.');return;}
  button.disabled=true;
  button.textContent='SIGNING IN…';
  pendingSetMessage(pendingAuthMessage,'Signing in…',true);
  try{
    const {error}=await pendingClient.auth.signInWithPassword({email,password});
    if(error)throw error;
    await pendingLoad();
  }catch(error){
    pendingSetMessage(pendingAuthMessage,error?.message||'Unable to sign in.');
  }finally{
    button.disabled=false;
    button.textContent='SIGN IN';
  }
}));
pendingById('pendingRefresh').addEventListener('click',()=>pendingLoad());
pendingById('pendingSignOut').addEventListener('click',async()=>{
  await pendingClient.auth.signOut();
  location.replace('/pending-access.html?signed_out=1');
});

(async()=>{
  const params=new URLSearchParams(location.search);
  const email=params.get('email');
  if(email)pendingById('pendingEmail').value=email;
  const {data:{session}}=await pendingClient.auth.getSession();
  if(session)await pendingLoad();
})();
