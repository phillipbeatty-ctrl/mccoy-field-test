// Keep Pending Account Access authoritative without rebuilding the Admin interface in the background.
(()=>{
  if(window.MCCOY_PENDING_ACCESS_FIX?.installed)return;
  const VERSION='20260831.4';
  const DIRECT_VIEW='/pending-access.html?v=20260831.4';
  const state={
    accounts:new Map(),
    observer:null,
    observedRoot:null,
    decorateQueued:false,
    refreshPromise:null,
    inFlightInvocations:new Map()
  };

  function client(){
    if(typeof sb!=='undefined'&&sb?.functions?.invoke)return sb;
    if(window.sb?.functions?.invoke)return window.sb;
    return null;
  }

  function usersViewIsActive(){
    return document.getElementById('teams')?.classList.contains('active')===true;
  }

  function usersRoot(){
    return document.getElementById('userAdminBody');
  }

  function setTextIfChanged(element,value){
    if(element&&element.textContent!==value)element.textContent=value;
  }

  function setAttributeIfChanged(element,name,value){
    if(!element)return;
    if(element.getAttribute(name)!==value)element.setAttribute(name,value);
  }

  function setDisabledIfChanged(element,value){
    if(element&&element.disabled!==value)element.disabled=value;
  }

  function ensureDirectLink(root=usersRoot()){
    const heading=root?.querySelector?.('.pending-account-heading');
    if(!heading)return false;
    let link=heading.querySelector('#pendingAccountDirectLink');
    if(!link){
      link=document.createElement('a');
      link.id='pendingAccountDirectLink';
      link.className='assign-btn';
      link.style.cssText='text-decoration:none;display:inline-flex;align-items:center;justify-content:center;padding:8px 10px;white-space:nowrap';
      heading.appendChild(link);
    }
    setAttributeIfChanged(link,'href',DIRECT_VIEW);
    setTextIfChanged(link,'OPEN DIRECT PENDING ACCESS');
    return true;
  }

  function pendingEmail(row){
    return [...row.querySelectorAll('.muted.small')]
      .map(element=>String(element.textContent||'').trim().toLowerCase())
      .find(text=>text.includes('@'))||'';
  }

  function decoratePendingRows(){
    const root=usersRoot();
    if(!root)return;
    ensureDirectLink(root);
    for(const row of root.querySelectorAll('.pending-account-row')){
      const email=pendingEmail(row);
      const account=state.accounts.get(email);
      if(!account)continue;
      const accessState=account.access_state||'';
      const accessActive=account.access_active?'1':'0';
      if(row.dataset.pendingAccessState!==accessState)row.dataset.pendingAccessState=accessState;
      if(row.dataset.accessActive!==accessActive)row.dataset.accessActive=accessActive;
      if(account.access_active&&account.waiting_for_email_confirmation){
        setTextIfChanged(row.querySelector('.pending-account-state'),'Email not confirmed · access pre-granted');
        const grant=row.querySelector('button[id^="paGrant"]');
        if(grant){
          setDisabledIfChanged(grant,true);
          setTextIfChanged(grant,'ACCESS ALREADY GRANTED');
          setAttributeIfChanged(grant,'title','This account will become usable after the email address is confirmed.');
        }
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

  function queueDecoration(){
    if(state.decorateQueued)return;
    state.decorateQueued=true;
    queueMicrotask(()=>{
      state.decorateQueued=false;
      decoratePendingRows();
    });
  }

  function ensureScopedObserver(){
    const root=usersRoot();
    if(!root)return false;
    if(state.observer&&state.observedRoot===root)return true;
    state.observer?.disconnect();
    state.observer=new MutationObserver(queueDecoration);
    state.observer.observe(root,{childList:true,subtree:true});
    state.observedRoot=root;
    queueDecoration();
    return true;
  }

  function runOnce(key,request){
    const existing=state.inFlightInvocations.get(key);
    if(existing)return existing;
    const promise=Promise.resolve().then(request).finally(()=>{
      if(state.inFlightInvocations.get(key)===promise)state.inFlightInvocations.delete(key);
    });
    state.inFlightInvocations.set(key,promise);
    return promise;
  }

  function wrapRefreshButton(){
    const button=document.getElementById('userAdminRefresh');
    if(!button)return false;
    if(button.dataset.mccoyRefreshGuard===VERSION)return true;
    const original=button.onclick;
    if(typeof original!=='function')return false;
    button.dataset.mccoyRefreshGuard=VERSION;
    button.onclick=function guardedUserRefresh(event){
      if(!usersViewIsActive())return Promise.resolve({ok:false,skipped:'users_view_inactive'});
      if(state.refreshPromise)return state.refreshPromise;
      const wasDisabled=button.disabled;
      setDisabledIfChanged(button,true);
      const promise=Promise.resolve()
        .then(()=>original.call(button,event))
        .finally(()=>{
          if(state.refreshPromise===promise)state.refreshPromise=null;
          if(document.contains(button))setDisabledIfChanged(button,wasDisabled);
          ensureScopedObserver();
          queueDecoration();
        });
      state.refreshPromise=promise;
      return promise;
    };
    return true;
  }

  function installViewControls(){
    const observed=ensureScopedObserver();
    const guarded=wrapRefreshButton();
    queueDecoration();
    return observed&&guarded;
  }

  function refreshVisibleAdminUsers(){
    if(document.hidden||window.MCCOY_ACCESS?.access?.role!=='admin'||!usersViewIsActive()){
      return Promise.resolve({ok:false,skipped:'users_view_inactive'});
    }
    if(!wrapRefreshButton())return Promise.resolve({ok:false,skipped:'refresh_button_unavailable'});
    const button=document.getElementById('userAdminRefresh');
    button.click();
    return state.refreshPromise||Promise.resolve({ok:true});
  }

  function install(){
    const supabaseClient=client();
    if(!supabaseClient)return false;
    const functions=supabaseClient.functions;
    if(functions.invoke?.__mccoyPendingAccessPatched){
      window.MCCOY_PENDING_ACCESS_FIX={installed:true,version:VERSION,refresh:refreshVisibleAdminUsers,directView:DIRECT_VIEW};
      installViewControls();
      return true;
    }
    const originalInvoke=functions.invoke.bind(functions);

    const patchedInvoke=(functionName,options={})=>{
      const body=options?.body||{};
      if(functionName==='rep-onboarding'&&body.action==='list_users'){
        return runOnce('rep-onboarding:list_users',()=>originalInvoke(functionName,options));
      }
      if(functionName==='rep-onboarding'&&body.action==='list_pending_accounts'){
        return runOnce('pending-account-access:list',async()=>{
          const authoritative=await originalInvoke('pending-account-access',{body:{action:'list'}});
          if(!authoritative.error&&authoritative.data?.ok){
            const accounts=authoritative.data.accounts||[];
            state.accounts=new Map(accounts.map(account=>[String(account.email||'').toLowerCase(),account]));
            queueDecoration();
            return authoritative;
          }
          return originalInvoke(functionName,options);
        });
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

    window.addEventListener('mccoy-access-ready',()=>setTimeout(installViewControls,0));
    document.querySelector('.nav-btn[data-view="teams"]')?.addEventListener('click',()=>setTimeout(installViewControls,0));
    window.addEventListener('beforeunload',()=>state.observer?.disconnect());

    let tries=0;
    const bootstrap=()=>{
      tries+=1;
      if(installViewControls()||tries>=150)return;
      setTimeout(bootstrap,100);
    };
    setTimeout(bootstrap,0);

    window.MCCOY_PENDING_ACCESS_FIX={installed:true,version:VERSION,refresh:refreshVisibleAdminUsers,directView:DIRECT_VIEW};
    return true;
  }

  if(!install()){
    let tries=0;
    const waitForClient=()=>{
      tries+=1;
      if(install()||tries>=150)return;
      setTimeout(waitForClient,100);
    };
    setTimeout(waitForClient,100);
  }
})();
