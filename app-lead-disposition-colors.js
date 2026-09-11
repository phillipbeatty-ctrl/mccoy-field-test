(()=>{
  const palette={
    'uncontacted':'#fbbf24',
    'new':'#fbbf24',
    'open':'#fbbf24',
    'prospecting':'#3b82f6',
    'not home':'#3b82f6',
    'contacted':'#06b6d4',
    'interested':'#8b5cf6',
    'follow up':'#f59e0b',
    'follow-up':'#f59e0b',
    'appointment':'#14b8a6',
    'appointment set':'#14b8a6',
    'qualified':'#6366f1',
    'proposal sent':'#a855f7',
    'sale':'#65a30d',
    'sold':'#65a30d',
    'signed':'#65a30d',
    'won':'#65a30d',
    'customer':'#65a30d',
    'not interested':'#ef4444',
    'lost':'#ef4444',
    'do not knock':'#991b1b',
    'dnk':'#991b1b',
    'bad address':'#6b7280',
    'invalid address':'#6b7280'
  };

  const css=document.createElement('style');
  css.textContent=`
    .lead-house-icon .lead-house{background:var(--mccoy-lead-color,#fbbf24)!important}
    .lead-house-icon .lead-house:after{border-bottom-color:var(--mccoy-lead-color,#fbbf24)!important}
    .lead-house-icon.selected .lead-house{background:var(--mccoy-lead-color,#fbbf24)!important;border-width:3px!important;box-shadow:0 0 0 4px rgba(17,24,39,.24)!important}
    .lead-house-icon.selected .lead-house:after{border-bottom-color:var(--mccoy-lead-color,#fbbf24)!important}
    .lead-house-icon.correction .lead-house{background:var(--mccoy-lead-color,#fbbf24)!important;border-width:3px!important;box-shadow:0 0 0 5px rgba(17,24,39,.22)!important}
    .lead-house-icon.correction .lead-house:after{border-bottom-color:var(--mccoy-lead-color,#fbbf24)!important}
    #leadDispositionLegend{display:flex;gap:5px 10px;flex-wrap:wrap;align-items:center;margin-top:4px;font-size:9px;line-height:1.15}
    #leadDispositionLegend .disp-key{display:inline-flex;align-items:center;gap:4px;white-space:nowrap}
    #leadDispositionLegend .disp-dot{width:9px;height:9px;border-radius:50%;border:1px solid rgba(17,24,39,.4);display:inline-block}
  `;
  document.head.appendChild(css);

  function norm(v){return String(v||'').trim().toLowerCase();}
  function colorFor(disposition){return palette[norm(disposition)]||'#fbbf24';}
  function colorForLead(lead){
    if(/^#[0-9a-f]{6}$/i.test(String(lead?.pinColor||'')))return lead.pinColor;
    const core=window.MCCOY_DOOR_WORKFLOW_CORE;
    if(lead?.pinColorSource==='stage')return core?.pinState({stage:lead.stage})?.color||colorFor(lead.disposition);
    if(lead?.pinColorSource==='visit_result')return core?.pinState({visitResult:lead.visitResult})?.color||colorFor(lead.disposition);
    if(lead?.stage||lead?.visitResult)return core?.pinState({stage:lead.stage,visitResult:lead.visitResult,previousColor:colorFor(lead.disposition)})?.color||colorFor(lead.disposition);
    return colorFor(lead?.disposition);
  }

  let indexedRows=null,indexedLength=0,byId=new Map(),pending=false,dirty=true;
  function mapVisible(){
    const map=document.getElementById('leadMapFrame');
    return !document.hidden&&!!map?.getClientRects().length;
  }
  function indexLeads(){
    const rows=state.realLeads||[];
    if(indexedRows===rows&&indexedLength===rows.length)return;
    indexedRows=rows;indexedLength=rows.length;byId=new Map();
    for(const lead of rows)byId.set(String(lead.dbId||lead.id),lead);
  }
  function paint(el,lead){
    if(!lead)return;
    const color=colorForLead(lead),disposition=lead.pinDisposition||lead.disposition||'';
    if(el.style.getPropertyValue('--mccoy-lead-color')!==color)el.style.setProperty('--mccoy-lead-color',color);
    if(el.dataset.disposition!==disposition)el.dataset.disposition=disposition;
  }
  function colorMarker(el,lead){
    if(!mapVisible()){dirty=true;return;}
    paint(el,lead);
  }
  function applyColors(){
    dirty=true;
    if(pending||!mapVisible())return;
    pending=true;setTimeout(()=>{
      pending=false;if(!dirty||!mapVisible())return;
      dirty=false;indexLeads();ensureLegend();
      document.querySelectorAll('#leadMapFrame .lead-house-icon').forEach(el=>paint(el,byId.get(el.dataset.mccoyLeadId)));
    },0);
  }

  function ensureLegend(){
    const controls=document.getElementById('leadGeoControls');
    if(!controls||document.getElementById('leadDispositionLegend'))return;
    const legend=document.createElement('div');
    legend.id='leadDispositionLegend';
    const resultItems=(window.MCCOY_DOOR_WORKFLOW_CORE?.VISIT_RESULTS||[]).map(item=>[item.label,item.color]);
    const stageItems=(window.MCCOY_DOOR_WORKFLOW_CORE?.STAGES||[]).map(item=>[item.label,item.color]);
    legend.innerHTML=`<strong>Visit Result</strong>${resultItems.map(([name,color])=>`<span class="disp-key"><span class="disp-dot" style="background:${color}"></span>${name}</span>`).join('')}<strong>Stage</strong>${stageItems.map(([name,color])=>`<span class="disp-key"><span class="disp-dot" style="background:${color}"></span>${name}</span>`).join('')}`;
    controls.appendChild(legend);
  }

  const observer=new MutationObserver(applyColors);
  const visibilityObserver=new MutationObserver(()=>{if(dirty)applyColors();});
  function start(){
    const map=document.getElementById('leadMapFrame');
    if(map)observer.observe(map,{childList:true,subtree:true});
    for(const node of [document.getElementById('leadMapPanel'),document.getElementById('leads')])if(node)visibilityObserver.observe(node,{attributes:true,attributeFilter:['class','style','hidden']});
    ensureLegend();
    applyColors();
  }

  window.MCCOY_COLOR_LEAD_MARKER=colorMarker;
  window.MCCOY_APPLY_DISPOSITION_COLORS=applyColors;
  for(const name of ['mccoy-real-leads-loaded','mccoy-lead-address-corrected','mccoy-door-visit-completed','mccoy-lead-pool-disposition-saved','mccoy-map-move-pin-ended'])window.addEventListener(name,applyColors);
  for(const name of ['mccoy-lead-map-window-mode-changed','mccoy-lead-pool-position-changed'])window.addEventListener(name,()=>{if(dirty)applyColors();});
  document.addEventListener('visibilitychange',()=>{if(dirty)applyColors();});
  window.addEventListener('beforeunload',()=>{observer.disconnect();visibilityObserver.disconnect();});
  start();
})();
