// Keep real-lead importing completely unavailable unless the authenticated account is an active admin.
(()=>{
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
