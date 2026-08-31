// Keep real-lead importing completely unavailable unless the authenticated account is an active admin.
(()=>{
  if(!document.querySelector('script[src^="app-pending-access-fix.js"]')){
    const pendingAccessPatch=document.createElement('script');
    pendingAccessPatch.src='app-pending-access-fix.js?v=2026083102';
    pendingAccessPatch.async=false;
    document.body.appendChild(pendingAccessPatch);
  }

  const button=document.getElementById('adminLeadImportBtn');
  if(!button)return;

  function isActiveAdmin(){
    const access=window.MCCOY_ACCESS?.access;
    return access?.active===true&&access.role==='admin';
  }

  function syncImportPermission(){
    const allowed=isActiveAdmin();
    button.hidden=!allowed;
    button.disabled=!allowed;
    if(allowed){
      button.removeAttribute('aria-hidden');
      button.removeAttribute('tabindex');
    }else{
      button.setAttribute('aria-hidden','true');
      button.tabIndex=-1;
    }
    return allowed;
  }

  syncImportPermission();
  window.addEventListener('mccoy-access-ready',syncImportPermission);
  button.addEventListener('click',event=>{
    if(!isActiveAdmin()){
      event.preventDefault();
      event.stopImmediatePropagation();
      syncImportPermission();
      return;
    }
    location.href='spotio-import.html';
  });

  let checks=0;
  const pendingAccess=setInterval(()=>{
    syncImportPermission();
    if(window.MCCOY_ACCESS?.access||++checks>=80)clearInterval(pendingAccess);
  },250);
})();
