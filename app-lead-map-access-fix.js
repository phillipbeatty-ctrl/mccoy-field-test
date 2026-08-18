(()=>{
  let checks=0;
  const MAX_CHECKS=60;
  function syncGeocodeControl(){
    checks++;
    const btn=document.getElementById('geocodeRealLeadsBtn');
    const progress=document.getElementById('geocodeProgress');
    if(!btn){
      if(checks<MAX_CHECKS)setTimeout(syncGeocodeControl,500);
      return;
    }
    const access=window.MCCOY_ACCESS?.access;
    if(!access){
      btn.style.display='inline-block';
      btn.disabled=true;
      btn.textContent='GEOCODE REAL LEADS';
      if(progress)progress.textContent='Waiting for account permissions…';
      if(checks<MAX_CHECKS)setTimeout(syncGeocodeControl,500);
      return;
    }
    if(access.active&&access.role==='admin'){
      btn.style.display='inline-block';
      btn.disabled=false;
      btn.textContent='GEOCODE REAL LEADS';
      if(progress&&/managed by Admin|Waiting for account permissions/i.test(progress.textContent||''))progress.textContent='Admin geocoding controls ready.';
      return;
    }
    btn.style.display='none';
    if(progress)progress.textContent='Lead coordinates are managed by Admin.';
  }
  document.addEventListener('DOMContentLoaded',()=>setTimeout(syncGeocodeControl,200));
  setTimeout(syncGeocodeControl,500);
  window.addEventListener('mccoy-real-leads-loaded',()=>{checks=0;setTimeout(syncGeocodeControl,100);});
})();