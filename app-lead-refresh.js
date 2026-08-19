(()=>{
  let refreshing=false;

  function ensureRefreshButton(){
    const row=document.querySelector('#leadGeoControls > div');
    if(!row)return false;
    let btn=document.getElementById('refreshLeadPoolBtn');
    if(!btn){
      btn=document.createElement('button');
      btn.id='refreshLeadPoolBtn';
      btn.type='button';
      btn.className='assign-btn';
      btn.textContent='REFRESH';
      btn.title='Reload the latest Lead Pool from Supabase';
      btn.addEventListener('click',refreshLeadPool);
    }
    if(btn.parentElement!==row||row.lastElementChild!==btn)row.appendChild(btn);
    return true;
  }

  function setStatus(text){const geo=document.getElementById('geocodeProgress');if(geo)geo.textContent=text;}

  async function refreshLeadPool(){
    if(refreshing)return;
    const btn=document.getElementById('refreshLeadPoolBtn');
    refreshing=true;if(btn){btn.disabled=true;btn.textContent='REFRESHING…';}
    setStatus('Refreshing Lead Pool from server…');
    try{
      if(typeof window.loadMcCoyLeads!=='function')throw new Error('Lead loader is not ready yet.');
      const leads=await window.loadMcCoyLeads();
      const count=Array.isArray(leads)?leads.length:(state.realLeads||[]).length;
      window.MCCOY_RENDER_LEAD_MAP?.(false);
      if(typeof window.renderLeads==='function')window.renderLeads();
      setStatus(`Lead Pool refreshed · ${count.toLocaleString()} real leads loaded.`);
      const missing=(state.realLeads||[]).filter(l=>!Number.isFinite(Number(l.lat))||!Number.isFinite(Number(l.lng))).length;
      if(missing&&typeof window.MCCOY_RESOLVE_MISSING_LEAD_LOCATIONS==='function'){
        setStatus(`Lead Pool refreshed · ${count.toLocaleString()} leads · locating ${missing.toLocaleString()} new/missing addresses…`);
        Promise.resolve(window.MCCOY_RESOLVE_MISSING_LEAD_LOCATIONS()).catch(e=>console.warn('Refresh location resolution paused',e));
      }
    }catch(e){console.error('Lead Pool refresh failed',e);setStatus(`Refresh failed: ${e?.message||String(e)}`);}
    finally{refreshing=false;if(btn){btn.disabled=false;btn.textContent='REFRESH';}}
  }

  window.MCCOY_REFRESH_LEAD_POOL=refreshLeadPool;
  window.addEventListener('mccoy-real-leads-loaded',()=>setTimeout(ensureRefreshButton,30));
  const leadsNav=document.querySelector('.nav-btn[data-view="leads"]');
  leadsNav?.addEventListener('click',()=>setTimeout(ensureRefreshButton,30));

  let tries=0;
  const startup=setInterval(()=>{tries++;if(ensureRefreshButton()||tries>=20)clearInterval(startup);},100);
  setTimeout(ensureRefreshButton,0);
})();
