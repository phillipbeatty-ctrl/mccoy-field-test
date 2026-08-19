(()=>{
  const style=document.createElement('style');
  style.textContent=`
    #adminBottomDock{position:fixed;left:242px;right:12px;bottom:10px;z-index:2700;display:none;align-items:center;gap:8px;flex-wrap:wrap;padding:0;pointer-events:none}
    #adminBottomDock>*{position:static!important;right:auto!important;bottom:auto!important;left:auto!important;top:auto!important;pointer-events:auto!important;margin:0!important}
    #adminBottomDock #spotioConnectBtn,#adminBottomDock #userAdminBtn,#adminBottomDock #accessAdminBtn{display:block!important;border-radius:999px;padding:8px 12px;font-size:11px;line-height:1.1;white-space:nowrap}
    #adminBottomDock #userStrip{display:flex!important;border-radius:999px;padding:6px 9px;font-size:10px;gap:7px;align-items:center}
    #adminBottomDock #userStrip button{padding:4px 7px}
    #leadGeoControls{width:100%}
    #geocodeProgressWrap{width:100%!important}
    #geocodeProgressMeta{display:flex;align-items:center;gap:14px;flex-wrap:wrap;width:100%;margin-top:4px;min-height:14px}
    #geocodeProgressMeta #geocodeProgressPct,#geocodeProgressMeta #geocodeProgress,#geocodeProgressMeta #mapSelectionStatus{margin:0!important;white-space:nowrap;line-height:1.15}
    #geocodeProgressMeta #mapSelectionStatus{flex:1 1 auto;min-width:220px}
    @media(max-width:900px){#adminBottomDock{left:10px;right:10px;bottom:8px}#geocodeProgressMeta{gap:6px 10px}#geocodeProgressMeta #geocodeProgressPct,#geocodeProgressMeta #geocodeProgress,#geocodeProgressMeta #mapSelectionStatus{white-space:normal}}
  `;
  document.head.appendChild(style);

  function ensureDock(){
    let dock=document.getElementById('adminBottomDock');
    if(!dock){dock=document.createElement('div');dock.id='adminBottomDock';document.body.appendChild(dock);}
    return dock;
  }

  function arrangeAdminControls(){
    if(window.MCCOY_ACCESS?.access?.role!=='admin')return;
    const dock=ensureDock();
    ['spotioConnectBtn','userAdminBtn','accessAdminBtn','userStrip'].forEach(id=>{
      const el=document.getElementById(id);
      if(el&&el.parentElement!==dock)dock.appendChild(el);
    });
    dock.style.display=dock.children.length?'flex':'none';
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
  const obs=new MutationObserver(sync);
  obs.observe(document.body,{childList:true,subtree:true});
  window.addEventListener('mccoy-real-leads-loaded',()=>setTimeout(sync,50));
  setInterval(sync,500);
  setTimeout(sync,200);
})();