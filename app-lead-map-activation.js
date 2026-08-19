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
      if((!Array.isArray(state.realLeads)||state.realLeads.length===0)&&!state.leadAccessScope?.assignmentRequired){
        await window.loadMcCoyLeads?.();
      }

      // Managers and reps with no assigned pool should not wait for leads that cannot arrive.
      for(let i=0;i<4&&!state.leadAccessScope?.assignmentRequired&&(!Array.isArray(state.realLeads)||state.realLeads.length===0);i++)await sleep(120);
      // Marker rendering is cached and batched, so one visible redraw is sufficient.
      window.MCCOY_RENDER_LEAD_MAP?.(true);
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