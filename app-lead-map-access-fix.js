(()=>{
  let checks=0;
  const MAX_CHECKS=60;

  function polishMapAssignment(){
    const select=document.getElementById('mapRepSelect');
    if(select){
      const label=select.previousElementSibling;
      if(label&&label.tagName==='LABEL')label.textContent='REP';
      if(!document.getElementById('mapAssignmentRepWidthFix')){
        const style=document.createElement('style');
        style.id='mapAssignmentRepWidthFix';
        style.textContent=`#mapRepSelect{width:100%!important;max-width:none!important;min-width:0!important;display:block!important}#leadMapPanel>.grid-2>.card:last-child{min-width:205px;max-width:240px}`;
        document.head.appendChild(style);
      }
    }
  }

  function syncGeocodeControl(){
    checks++;
    polishMapAssignment();
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
      if(!window.MCCOY_RESUME_GEOCODING) btn.textContent='GEOCODE REAL LEADS';
      if(progress&&!window.MCCOY_RESUME_GEOCODING)progress.textContent='Waiting for account permissions…';
      if(checks<MAX_CHECKS)setTimeout(syncGeocodeControl,500);
      return;
    }
    if(access.active&&access.role==='admin'){
      btn.style.display='inline-block';
      btn.disabled=false;
      if(!window.MCCOY_RESUME_GEOCODING){
        btn.textContent='GEOCODE REAL LEADS';
        if(progress&&/managed by Admin|Waiting for account permissions/i.test(progress.textContent||''))progress.textContent='Admin geocoding controls ready.';
      }
      return;
    }
    btn.style.display='none';
    if(progress)progress.textContent='Lead coordinates are managed by Admin.';
  }
  document.addEventListener('DOMContentLoaded',()=>setTimeout(syncGeocodeControl,200));
  setTimeout(syncGeocodeControl,500);
  window.addEventListener('mccoy-real-leads-loaded',()=>{checks=0;setTimeout(syncGeocodeControl,100);});
})();