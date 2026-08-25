(()=>{
  function polish(){
    const row=document.querySelector('#leadGeoControls > div');
    if(!row)return false;
    const geo=document.getElementById('geocodeRealLeadsBtn');
    const lasso=document.getElementById('lassoSelectBtn');
    const fit=document.getElementById('fitAllPinsBtn');
    const clear=document.getElementById('clearMapSelectionBtn');
    const visible=document.getElementById('selectVisiblePinsBtn');
    const refresh=document.getElementById('refreshLeadPoolBtn');

    if(geo&&geo.textContent==='GEOCODING COMPLETE')geo.textContent='VERIFY NEXT 25 WITH GOOGLE';
    if(lasso && lasso.textContent.trim()==='DRAW LASSO…'){
      lasso.textContent='🪢';
      lasso.title='Draw lasso around leads';
      lasso.setAttribute('aria-label','Draw lasso around leads');
    }
    [geo,lasso,fit,clear,visible,refresh].filter(Boolean).forEach(btn=>row.appendChild(btn));
    return !!(geo&&lasso&&fit&&clear&&visible&&refresh);
  }

  function bindSpecificControls(){
    const lasso=document.getElementById('lassoSelectBtn');
    if(lasso&&!lasso.dataset.mccoyOrderBound){lasso.dataset.mccoyOrderBound='1';lasso.addEventListener('click',()=>setTimeout(polish,0));}
    const geo=document.getElementById('geocodeRealLeadsBtn');
    if(geo&&!geo.dataset.mccoyOrderBound){geo.dataset.mccoyOrderBound='1';geo.addEventListener('click',()=>setTimeout(polish,40));}
    const refresh=document.getElementById('refreshLeadPoolBtn');
    if(refresh&&!refresh.dataset.mccoyOrderBound){refresh.dataset.mccoyOrderBound='1';refresh.addEventListener('click',()=>setTimeout(polish,40));}
  }

  function sync(){polish();bindSpecificControls();}
  window.addEventListener('mccoy-real-leads-loaded',()=>setTimeout(sync,60));
  document.querySelector('.nav-btn[data-view="leads"]')?.addEventListener('click',()=>setTimeout(sync,30));

  let tries=0;
  const startup=setInterval(()=>{tries++;sync();if(polish()||tries>=25)clearInterval(startup);},100);
  setTimeout(sync,0);
})();
