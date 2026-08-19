(()=>{
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  let activating=false;

  async function activateLeadMap(){
    if(activating)return;
    activating=true;
    try{
      // Let the Lead Pool switch the panel from hidden to visible first.
      await sleep(40);

      // Always recover the real lead pool when MAP / ASSIGN is opened directly.
      if(!Array.isArray(state.realLeads)||state.realLeads.length===0){
        await window.loadMcCoyLeads?.();
      }

      // The protected loader can finish just after the panel becomes visible.
      for(let i=0;i<8&&(!Array.isArray(state.realLeads)||state.realLeads.length===0);i++){
        await sleep(250);
      }

      // Redraw more than once to cover Leaflet's hidden-to-visible resize timing.
      window.MCCOY_RENDER_LEAD_MAP?.(true);
      await sleep(120);
      window.MCCOY_RENDER_LEAD_MAP?.(true);
      await sleep(350);
      window.MCCOY_RENDER_LEAD_MAP?.(false);
    }catch(e){
      console.error('Lead map activation failed',e);
    }finally{
      activating=false;
    }
  }

  window.MCCOY_ACTIVATE_LEAD_MAP=activateLeadMap;

  document.addEventListener('click',e=>{
    const btn=e.target?.closest?.('#leadMapView');
    if(btn)setTimeout(activateLeadMap,0);
  });

  // If real leads arrive while the map is already open, populate it immediately.
  window.addEventListener('mccoy-real-leads-loaded',()=>{
    const panel=document.getElementById('leadMapPanel');
    if(panel&&panel.style.display!=='none')setTimeout(activateLeadMap,30);
  });
})();