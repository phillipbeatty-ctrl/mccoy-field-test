(()=>{
  const style=document.createElement('style');
  style.textContent=`
    #adminBottomDock{position:static;width:100%;z-index:auto;display:none;flex-direction:column;align-items:stretch;gap:7px;padding:0;margin-top:auto!important;margin-bottom:8px!important;pointer-events:none}
    .sidebar:has(#adminBottomDock) .sidebar-footer{margin-top:0!important}
    #adminBottomDock>*{position:static!important;right:auto!important;bottom:auto!important;left:auto!important;top:auto!important;pointer-events:auto!important;margin:0!important;width:100%!important;max-width:none!important;box-sizing:border-box!important}
    #adminBottomDock #spotioConnectBtn,#adminBottomDock #userAdminBtn,#adminBottomDock #accessAdminBtn,#adminBottomDock #metricsVisibilityBtn{display:block!important;border-radius:8px!important;padding:8px 10px!important;font-size:10px!important;line-height:1.1!important;white-space:nowrap!important;text-align:center!important}
    #adminBottomDock #userStrip{display:flex!important;border-radius:8px!important;padding:6px 8px!important;font-size:9px!important;gap:6px!important;align-items:center!important;justify-content:space-between!important;min-width:0!important}
    #adminBottomDock #userStrip>*{min-width:0}
    #adminBottomDock #userStrip button{padding:4px 6px!important;font-size:9px!important;white-space:nowrap!important}
    #leadGeoControls{width:100%}
    #geocodeProgressWrap{width:100%!important}
    #geocodeProgressMeta{display:flex;align-items:center;gap:14px;flex-wrap:wrap;width:100%;margin-top:4px;min-height:14px}
    #geocodeProgressMeta #geocodeProgressPct,#geocodeProgressMeta #geocodeProgress,#geocodeProgressMeta #mapSelectionStatus{margin:0!important;white-space:nowrap;line-height:1.15}
    #geocodeProgressMeta #mapSelectionStatus{flex:1 1 auto;min-width:220px}
    @media(max-width:900px){#adminBottomDock{position:fixed;left:10px;right:10px;bottom:8px;width:auto;margin:0!important;flex-direction:row;flex-wrap:wrap;z-index:2700}#adminBottomDock>*{width:auto!important;flex:1 1 auto}.sidebar:has(#adminBottomDock) .sidebar-footer{margin-top:auto!important}#geocodeProgressMeta{gap:6px 10px}#geocodeProgressMeta #geocodeProgressPct,#geocodeProgressMeta #geocodeProgress,#geocodeProgressMeta #mapSelectionStatus{white-space:normal}}
  `;
  document.head.appendChild(style);

  function ensureDock(){
    let dock=document.getElementById('adminBottomDock');
    const sidebar=document.querySelector('.sidebar');
    const footer=sidebar?.querySelector('.sidebar-footer');
    if(!dock){dock=document.createElement('div');dock.id='adminBottomDock';}
    if(sidebar&&dock.parentElement!==sidebar)sidebar.insertBefore(dock,footer||null);
    else if(sidebar&&footer&&dock.nextElementSibling!==footer)sidebar.insertBefore(dock,footer);
    return dock;
  }

  function arrangeAdminControls(){
    if(window.MCCOY_ACCESS?.access?.role!=='admin')return;
    const dock=ensureDock();
    const ids=['userAdminBtn','accessAdminBtn','metricsVisibilityBtn','spotioConnectBtn','userStrip'];
    const els=ids.map(id=>document.getElementById(id)).filter(Boolean);
    els.forEach((el,i)=>{
      if(dock.children[i]!==el)dock.insertBefore(el,dock.children[i]||null);
    });
    dock.style.display=els.length?'flex':'none';
  }

  function compactMapStatus(){
    const wrap=document.getElementById('geocodeProgressWrap');
    const pct=document.getElementById('geocodeProgressPct');
    const geo=document.getElementById('geocodeProgress');
    const sel=document.getElementById('mapSelectionStatus');
    if(!wrap||!pct||!geo||!sel)return;
    let meta=document.getElementById('geocodeProgressMeta');
    if(!meta){meta=document.createElement('div');meta.id='geocodeProgressMeta';wrap.appendChild(meta);}
    [pct,geo,sel].forEach(el=>{if(el.parentElement!==meta)meta.appendChild(el);});
  }

  function sync(){arrangeAdminControls();compactMapStatus();}
  window.addEventListener('mccoy-real-leads-loaded',()=>setTimeout(sync,50));
  setInterval(sync,750);
  setTimeout(sync,200);
})();