(()=>{
  let checks=0;
  const MAX_CHECKS=60;

  function polishMapAssignment(){
    const select=document.getElementById('mapRepSelect');
    if(select){
      const label=select.previousElementSibling;
      if(label&&label.tagName==='LABEL'){
        label.textContent=window.MCCOY_ACCESS?.access?.role==='admin'?'Assign to manager or rep':'Assign to rep';
        label.style.display='block';
        label.style.margin='0 0 2px 0';
      }
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
      btn.textContent='VERIFY NEXT 25 WITH GOOGLE';
      if(progress)progress.textContent='Waiting for account permissions…';
      if(checks<MAX_CHECKS)setTimeout(syncGeocodeControl,500);
      return;
    }
    if(access.active&&access.role==='admin'){
      btn.style.display='inline-block';
      btn.disabled=btn.dataset.googleConfigured==='0';
      btn.textContent='VERIFY NEXT 25 WITH GOOGLE';
      if(progress&&/managed by Admin|Waiting for account permissions/i.test(progress.textContent||''))progress.textContent='Admin Google verification controls ready.';
      return;
    }
    btn.style.display='none';
    if(progress)progress.textContent='Lead coordinates are managed by Admin.';
  }
  document.addEventListener('DOMContentLoaded',()=>setTimeout(syncGeocodeControl,200));
  setTimeout(syncGeocodeControl,500);
  window.addEventListener('mccoy-real-leads-loaded',()=>{checks=0;setTimeout(syncGeocodeControl,100);});
})();
