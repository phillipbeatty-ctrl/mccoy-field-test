(()=>{
  function polish(){
    const row=document.querySelector('#leadGeoControls > div');
    if(!row)return;
    const geo=document.getElementById('geocodeRealLeadsBtn');
    const lasso=document.getElementById('lassoSelectBtn');
    const fit=document.getElementById('fitAllPinsBtn');
    const clear=document.getElementById('clearMapSelectionBtn');
    const visible=document.getElementById('selectVisiblePinsBtn');
    const refresh=document.getElementById('refreshLeadPoolBtn');

    if(geo && !geo.disabled && (geo.textContent==='GEOCODE REAL LEADS' || geo.textContent==='GEOCODING COMPLETE')){
      const progress=(document.getElementById('geocodeProgress')?.textContent||'').toLowerCase();
      if(progress.includes('remaining 0') || progress.includes('not processed. 0') || progress.includes('100%') || progress.includes('complete')) geo.textContent='GEOCODING COMPLETE';
    }
    if(lasso && lasso.textContent.trim()==='DRAW LASSO…'){
      lasso.textContent='🪢';
      lasso.title='Draw lasso around leads';
      lasso.setAttribute('aria-label','Draw lasso around leads');
    }

    [geo,lasso,fit,clear,visible,refresh].filter(Boolean).forEach(btn=>row.appendChild(btn));
  }

  window.addEventListener('mccoy-real-leads-loaded',()=>setTimeout(polish,80));
  document.addEventListener('click',()=>setTimeout(polish,20),true);
  setInterval(polish,250);
  setTimeout(polish,250);
})();
