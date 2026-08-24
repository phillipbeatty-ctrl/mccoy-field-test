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

  function leadForMarker(el){
    const title=(el.getAttribute('title')||'').trim();
    const leads=state?.realLeads||[];
    if(title&&title!=='Drag to correct lead location'){
      const exact=leads.find(l=>String(l.address||'').trim()===title);
      if(exact)return exact;
    }
    if(el.classList.contains('correction')||title==='Drag to correct lead location'){
      const a1=document.getElementById('editLeadAddress1')?.value?.trim()||'';
      const a2=document.getElementById('editLeadAddress2')?.value?.trim()||'';
      const city=document.getElementById('editLeadCity')?.value?.trim()||'';
      const st=document.getElementById('editLeadState')?.value?.trim()||'';
      const zip=document.getElementById('editLeadZip')?.value?.trim()||'';
      return leads.find(l=>(l.address1||l.address||'').trim()===a1&&(l.address2||'').trim()===a2&&(l.city||'').trim()===city&&(l.stateCode||'').trim()===st&&(l.zip||'').trim()===zip)
        ||leads.find(l=>(l.address1||l.address||'').trim()===a1);
    }
    return null;
  }

  function applyColors(){
    document.querySelectorAll('.lead-house-icon').forEach(el=>{
      const lead=leadForMarker(el);
      const color=colorForLead(lead);
      el.style.setProperty('--mccoy-lead-color',color);
      if(lead?.pinDisposition||lead?.disposition)el.dataset.disposition=lead.pinDisposition||lead.disposition;
    });
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

  const observer=new MutationObserver(()=>{applyColors();ensureLegend();});
  function start(){
    const map=document.getElementById('leadMapFrame');
    if(map)observer.observe(map,{childList:true,subtree:true,attributes:true,attributeFilter:['class','title']});
    ensureLegend();
    applyColors();
  }

  window.MCCOY_APPLY_DISPOSITION_COLORS=applyColors;
  window.addEventListener('mccoy-real-leads-loaded',()=>setTimeout(start,250));
  window.addEventListener('mccoy-lead-address-corrected',()=>setTimeout(applyColors,100));
  document.addEventListener('click',()=>setTimeout(applyColors,40),true);
  setInterval(applyColors,1200);
  setTimeout(start,1000);
})();
