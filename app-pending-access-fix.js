// Keep Pending Account Access authoritative and live, including pre-granted accounts awaiting email confirmation.
(()=>{
  if(window.MCCOY_PENDING_ACCESS_FIX?.installed)return;
  const VERSION='20260831.2';
  const DIRECT_VIEW='/pending-access.html?v=20260831.2';
  const state={accounts:new Map(),lastRefreshAt:0};

  function client(){
    if(typeof sb!=='undefined'&&sb?.functions?.invoke)return sb;
    if(window.sb?.functions?.invoke)return window.sb;
    return null;
  }

  function ensureDirectLink(){
    const heading=document.querySelector('.pending-account-heading');
    if(!heading||document.getElementById('pendingAccountDirectLink'))return;
    const link=document.createElement('a');
    link.id='pendingAccountDirectLink';
    link.href=DIRECT_VIEW;
    link.className='assign-btn';
    link.textContent='OPEN DIRECT PENDING ACCESS';
    link.style.cssText='text-decoration:none;display:inline-flex;align-items:center;justify-content:center;padding:8px 10px;white-space:nowrap';
    heading.appendChild(link);
  }

  function install(){
    const supabaseClient=client();
    if(!supabaseClient)return false;
    const functions=supabaseClient.functions;
    if(functions.invoke?.__mccoyPendingAccessPatched){
      window.MCCOY_PENDING_ACCESS_FIX={installed:true,version:VERSION,refresh:refreshVisibleAdminUsers,directView:DIRECT_VIEW};
      return true;
    }
    const originalInvoke=functions.invoke.bind(functions);

    const patchedInvoke=async(functionName,options={})=>{
      const body=options?.body||{};
      if(functionName==='rep-onboarding'&&body.action==='list_pending_accounts'){
        const authoritative=await originalInvoke('pending-account-access',{body:{action:'list'}});
        if(!authoritative.error&&authoritative.data?.ok){
          const accounts=authoritative.data.accounts||[];
          state.accounts=new Map(accounts.map(account=>[String(account.email||'').toLowerCase(),account]));
          queueMicrotask(()=>{decoratePendingRows();ensureDirectLink();});
          return authoritative;
        }
        return originalInvoke(functionName,options);
      }

      if(functionName==='rep-onboarding'&&body.action==='reset_pending_password'){
        const email=String(body.email||'').trim().toLowerCase();
        if(state.accounts.get(email)?.access_active){
          return originalInvoke(functionName,{...options,body:{...body,action:'reset_user_password'}});
        }
      }
      return originalInvoke(functionName,options);
    };
    patchedInvoke.__mccoyPendingAccessPatched=true;
    functions.invoke=patchedInvoke;

    const observer=new MutationObserver(()=>{decoratePendingRows();ensureDirectLink();});
    observer.observe(document.body,{childList:true,subtree:true});
    window.addEventListener('focus',refreshVisibleAdminUsers);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshVisibleAdminUsers();});
    setInterval(refreshVisibleAdminUsers,30000);
    setTimeout(refreshVisibleAdminUsers,300);
    setTimeout(refreshVisibleAdminUsers,1200);
    setTimeout(refreshVisibleAdminUsers,3500);
    window.MCCOY_PENDING_ACCESS_FIX={installed:true,version:VERSION,refresh:refreshVisibleAdminUsers,directView:DIRECT_VIEW};
    return true;
  }

  function pendingEmail(row){
    return [...row.querySelectorAll('.muted.small')]
      .map(element=>String(element.textContent||'').trim().toLowerCase())
      .find(text=>text.includes('@'))||'';
  }

  function decoratePendingRows(){
    ensureDirectLink();
    for(const row of document.querySelectorAll('.pending-account-row')){
      const email=pendingEmail(row);
      const account=state.accounts.get(email);
      if(!account)continue;
      row.dataset.pendingAccessState=account.access_state||'';
      row.dataset.accessActive=account.access_active?'1':'0';
      const badge=row.querySelector('.pending-account-state');
      if(account.access_active&&account.waiting_for_email_confirmation){
        if(badge)badge.textContent='Email not confirmed · access pre-granted';
        const grant=row.querySelector('button[id^="paGrant"]');
        if(grant){grant.disabled=true;grant.textContent='ACCESS ALREADY GRANTED';grant.title='This account will become usable after the email address is confirmed.';}
        const details=row.querySelector('.pending-account-details');
        if(details&&!details.querySelector('.pending-account-active-note')){
          const note=document.createElement('span');
          note.className='pending-account-active-note';
          note.textContent='The account is intentionally listed here until email confirmation is complete.';
          details.insertBefore(note,details.querySelector('.pending-account-actions'));
        }
      }
    }
  }

  function refreshVisibleAdminUsers(){
    if(document.hidden||window.MCCOY_ACCESS?.access?.role!=='admin')return;
    const teams=document.getElementById('teams');
    const panel=document.getElementById('userAdminPanel');
    if(!teams?.classList.contains('active')&&!panel?.classList.contains('show'))return;
    const now=Date.now();
    if(now-state.lastRefreshAt<5000)return;
    state.lastRefreshAt=now;
    document.getElementById('userAdminRefresh')?.click();
  }

  if(!install()){
    const timer=setInterval(()=>{if(install())clearInterval(timer);},100);
    setTimeout(()=>clearInterval(timer),15000);
  }
})();
