(()=>{
  if(!state.demoLeads) state.demoLeads=(state.leads||[]).map((l,i)=>({...l,id:200000+i,isDemo:true,sourceSystem:'DEMO'}));
  state.realLeads=state.realLeads||[];
  state.leadMode=state.leadMode||'real';
  state.leadPage=1;
  state.leadPageSize=50;
  state.leadView='list';
  let adminReps=[];
  let selectedMapLeadId=null;

  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const leadSection=document.getElementById('leads');
  const card=leadSection?.querySelector('.card');
  if(!card)return;

  const head=card.querySelector('.card-head');
  if(head){
    head.innerHTML=`<div><h2>Lead Pool</h2><p class="muted">Real SPOTIO leads and isolated demo/test leads are kept separate.</p></div><div style="display:flex;gap:8px;flex-wrap:wrap"><button id="adminLeadImportBtn" class="assign-btn">IMPORT REAL LEADS</button><button id="addDemoLeadsBtn" class="primary">ADD 10 DEMO LEADS</button></div>`;
  }

  const toolbar=card.querySelector('.toolbar');
  if(toolbar){
    toolbar.insertAdjacentHTML('beforebegin',`<div id="leadModeBar" style="display:flex;gap:8px;flex-wrap:wrap;margin:12px 0"><button id="realLeadMode" class="primary">REAL LEADS</button><button id="demoLeadMode" class="assign-btn">DEMO LEADS</button><button id="leadListView" class="primary">LIST</button><button id="leadMapView" class="assign-btn">MAP / ASSIGN</button><span id="leadPoolCount" class="badge badge-demo"></span></div>`);
    toolbar.insertAdjacentHTML('afterend',`<div id="leadPager" style="display:flex;justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap;margin:10px 0"><div><button id="leadPrev" class="assign-btn">Previous</button><button id="leadNext" class="assign-btn" style="margin-left:6px">Next</button></div><div><span id="leadPageLabel" class="muted small"></span><select id="leadPageSize" style="margin-left:8px;padding:7px"><option>50</option><option>100</option><option>250</option></select></div></div>`);
  }

  const tableMount=document.getElementById('leadsTable');
  tableMount.insertAdjacentHTML('afterend',`<div id="leadMapPanel" style="display:none"><div class="grid-2"><div class="card" style="padding:12px"><h3>Real Lead Map</h3><p class="muted small">Select a lead below to view its service address. Assignment changes are saved to the real McCoy lead record.</p><iframe id="leadMapFrame" title="Selected lead map" style="width:100%;height:430px;border:1px solid #e5e7eb;border-radius:12px" loading="lazy"></iframe></div><div class="card" style="padding:12px"><h3>Map Assignment</h3><div id="mapLeadInfo" class="muted">Select a real lead.</div><label class="small">Assign to rep</label><select id="mapRepSelect" style="width:100%;padding:10px;margin:6px 0"></select><button id="mapAssignBtn" class="primary" style="width:100%">ASSIGN SELECTED LEAD</button><div id="mapAssignMsg" class="muted small" style="margin-top:8px"></div><div id="mapLeadList" style="margin-top:12px;max-height:430px;overflow:auto"></div></div></div></div>`);

  const oldDemo=document.getElementById('addDemoLeadsBtn');
  if(oldDemo){const clone=oldDemo.cloneNode(true);oldDemo.replaceWith(clone);clone.addEventListener('click',()=>{const base=state.demoLeads.length+1;for(let i=0;i<10;i++){const team=i%2===0?'Pacific Northwest':'North Carolina';const streets=team==='Pacific Northwest'?pnwStreets:ncStreets;state.demoLeads.push({id:200000+base+i,address:`${2100+(base+i)*3} ${streets[i%streets.length]}`,city:'Demo City',stateCode:team==='North Carolina'?'NC':'OR',zip:'00000',fullAddress:`Demo Lead ${base+i}`,team,rep:null,disposition:'Uncontacted',isDemo:true,sourceSystem:'DEMO'});}switchMode('demo');});}

  function currentRows(){return state.leadMode==='demo'?state.demoLeads:state.realLeads;}
  function filteredRows(){
    const filter=document.getElementById('teamFilter')?.value||'';
    const q=(document.getElementById('leadSearch')?.value||'').toLowerCase();
    return currentRows().filter(l=>(!filter||l.team===filter)&&(!q||`${l.address} ${l.city||''} ${l.stateCode||''} ${l.zip||''} ${l.rep||''}`.toLowerCase().includes(q)));
  }
  function switchMode(mode){state.leadMode=mode;state.leadPage=1;state.leads=mode==='demo'?state.demoLeads:state.realLeads;document.getElementById('realLeadMode').className=mode==='real'?'primary':'assign-btn';document.getElementById('demoLeadMode').className=mode==='demo'?'primary':'assign-btn';document.getElementById('adminLeadImportBtn').style.display=mode==='real'?'inline-block':'none';renderLeads();}
  function switchView(view){state.leadView=view;document.getElementById('leadListView').className=view==='list'?'primary':'assign-btn';document.getElementById('leadMapView').className=view==='map'?'primary':'assign-btn';tableMount.style.display=view==='list'?'block':'none';document.getElementById('leadPager').style.display=view==='list'?'flex':'none';document.getElementById('leadMapPanel').style.display=view==='map'?'block':'none';if(view==='map')renderMapList();}

  async function loadAdminReps(){
    if(window.MCCOY_ACCESS?.access?.role!=='admin')return;
    try{const {data,error}=await sb.functions.invoke('lead-admin',{body:{action:'list_reps'}});if(error)throw error;adminReps=data?.reps||[];renderRepSelect();}catch(e){console.error('Lead rep list failed',e);}
  }
  function renderRepSelect(){const s=document.getElementById('mapRepSelect');if(!s)return;s.innerHTML='<option value="">Unassigned</option>'+adminReps.map(r=>`<option value="${esc(r.email)}">${esc(r.display_name||r.email)}${r.role==='admin'?' (Admin)':''}</option>`).join('');}

  window.renderLeads=function(){
    const rows=filteredRows();
    const total=rows.length,pages=Math.max(1,Math.ceil(total/state.leadPageSize));if(state.leadPage>pages)state.leadPage=pages;
    const start=(state.leadPage-1)*state.leadPageSize,page=rows.slice(start,start+state.leadPageSize);
    document.getElementById('leadPoolCount').textContent=`${state.leadMode==='real'?'REAL':'DEMO'} · ${total.toLocaleString()} leads`;
    document.getElementById('leadPageLabel').textContent=`Page ${state.leadPage} of ${pages} · ${total.toLocaleString()} total`;
    document.getElementById('leadPrev').disabled=state.leadPage<=1;document.getElementById('leadNext').disabled=state.leadPage>=pages;
    tableMount.innerHTML=`<table><thead><tr><th>Type</th><th>Address</th><th>Team</th><th>Assigned Rep</th><th>Disposition</th>${state.leadMode==='real'?'<th>Map</th>':''}</tr></thead><tbody>${page.map(l=>`<tr><td><strong>${l.isDemo?'DEMO':'REAL'}</strong></td><td>${esc([l.address,l.city,l.stateCode,l.zip].filter(Boolean).join(', '))}</td><td>${esc(l.team)}</td><td>${esc(l.rep||'Unassigned')}</td><td>${esc(l.disposition)}</td>${state.leadMode==='real'?`<td><button class="assign-btn map-one" data-id="${l.id}">View / Assign</button></td>`:''}</tr>`).join('')}</tbody></table>`;
    tableMount.querySelectorAll('.map-one').forEach(b=>b.addEventListener('click',()=>{selectedMapLeadId=Number(b.dataset.id);switchView('map');selectMapLead(selectedMapLeadId);}));
    renderFieldLeadSelect();
    if(state.leadView==='map')renderMapList();
  };

  function renderMapList(){
    const root=document.getElementById('mapLeadList');if(!root)return;
    if(state.leadMode!=='real'){root.innerHTML='<div class="muted">Map assignment is for real leads. Switch to REAL LEADS.</div>';return;}
    const rows=filteredRows().slice(0,250);
    root.innerHTML=rows.map(l=>`<button class="assign-btn map-pick" data-id="${l.id}" style="display:block;width:100%;text-align:left;margin:4px 0">${esc([l.address,l.city,l.stateCode,l.zip].filter(Boolean).join(', '))}</button>`).join('')+(filteredRows().length>250?'<div class="muted small">Showing first 250 filtered leads. Use search/team filters to narrow the map assignment list.</div>':'');
    root.querySelectorAll('.map-pick').forEach(b=>b.addEventListener('click',()=>selectMapLead(Number(b.dataset.id))));
  }
  function selectMapLead(id){
    const l=state.realLeads.find(x=>x.id===id);if(!l)return;selectedMapLeadId=id;
    const addr=l.fullAddress||[l.address,l.city,l.stateCode,l.zip].filter(Boolean).join(', ');
    document.getElementById('mapLeadInfo').innerHTML=`<strong>${esc(addr)}</strong><div class="muted small">${esc(l.team)} · ${esc(l.disposition)} · ${esc(l.rep||'Unassigned')}</div>`;
    document.getElementById('leadMapFrame').src='https://maps.google.com/maps?q='+encodeURIComponent(addr)+'&output=embed';
    document.getElementById('mapAssignMsg').textContent='';
  }
  async function assignSelected(){
    const l=state.realLeads.find(x=>x.id===selectedMapLeadId);if(!l)return;
    if(window.MCCOY_ACCESS?.access?.role!=='admin'){document.getElementById('mapAssignMsg').textContent='Only Admin can change real lead assignments.';return;}
    const email=document.getElementById('mapRepSelect').value,msg=document.getElementById('mapAssignMsg');msg.textContent='Saving assignment…';
    try{const {data,error}=await sb.functions.invoke('lead-admin',{body:{action:'assign_lead',lead_id:l.dbId,rep_email:email}});if(error||!data?.ok)throw error||new Error(data?.error||'assignment_failed');const r=adminReps.find(x=>x.email===email);l.assignedRepId=data.assigned_rep_id||null;l.rep=r?.display_name||r?.email||null;msg.textContent=email?'Lead assigned successfully.':'Lead returned to unassigned pool.';renderLeads();selectMapLead(l.id);}catch(e){console.error(e);msg.textContent='Unable to save assignment.';}
  }

  document.getElementById('realLeadMode').onclick=()=>switchMode('real');
  document.getElementById('demoLeadMode').onclick=()=>switchMode('demo');
  document.getElementById('leadListView').onclick=()=>switchView('list');
  document.getElementById('leadMapView').onclick=()=>switchView('map');
  document.getElementById('leadPrev').onclick=()=>{if(state.leadPage>1){state.leadPage--;renderLeads();}};
  document.getElementById('leadNext').onclick=()=>{state.leadPage++;renderLeads();};
  document.getElementById('leadPageSize').onchange=e=>{state.leadPageSize=Number(e.target.value)||50;state.leadPage=1;renderLeads();};
  document.getElementById('teamFilter').addEventListener('change',()=>{state.leadPage=1;renderLeads();});
  document.getElementById('leadSearch').addEventListener('input',()=>{state.leadPage=1;renderLeads();});
  document.getElementById('mapAssignBtn').onclick=assignSelected;
  window.addEventListener('mccoy-real-leads-loaded',()=>{switchMode('real');loadAdminReps();});
  setTimeout(()=>{switchMode(state.realLeads.length?'real':'demo');loadAdminReps();},900);
})();