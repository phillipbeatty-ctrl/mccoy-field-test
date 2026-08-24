(()=>{
  if(!state.demoLeads) state.demoLeads=(state.leads||[]).map((l,i)=>({...l,id:200000+i,isDemo:true,sourceSystem:'DEMO'}));
  state.realLeads=state.realLeads||[];
  state.leadMode=state.leadMode||'real';
  state.leadPage=1;
  state.leadPageSize=50;
  state.leadView='map';
  let adminReps=[];
  let managerAdministratorAssigned=true;
  let selectedMapLeadId=null;
  const selectedListLeadIds=new Set();

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
    toolbar.insertAdjacentHTML('beforebegin',`<div id="leadModeBar" style="display:flex;gap:8px;flex-wrap:wrap;margin:12px 0"><button id="realLeadMode" class="primary">REAL LEADS</button><button id="leadMapView" class="primary">MAP / ASSIGN</button><button id="demoLeadMode" class="assign-btn">DEMO LEADS</button><button id="leadListView" class="assign-btn">LIST</button><span id="leadPoolCount" class="badge badge-demo"></span></div>`);
    toolbar.insertAdjacentHTML('afterend',`<div id="leadPager" style="display:none;justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap;margin:10px 0"><div><button id="leadPrev" class="assign-btn">Previous</button><button id="leadNext" class="assign-btn" style="margin-left:6px">Next</button></div><div><span id="leadPageLabel" class="muted small"></span><select id="leadPageSize" style="margin-left:8px;padding:7px"><option>50</option><option>100</option><option>250</option></select></div></div>`);
  }

  const tableMount=document.getElementById('leadsTable');
  tableMount.insertAdjacentHTML('beforebegin',`<div id="leadListAssignmentBar" hidden style="display:none;gap:8px;align-items:center;flex-wrap:wrap;margin:10px 0"><label for="listRepSelect" class="small">Assign selected leads to</label><select id="listRepSelect" style="min-width:190px;padding:9px"></select><button id="listSelectPageBtn" class="assign-btn">SELECT THIS PAGE</button><button id="listClearSelectionBtn" class="assign-btn">CLEAR</button><button id="listAssignBtn" class="primary">ASSIGN SELECTED LEADS</button><span id="listAssignMsg" class="muted small" aria-live="polite">0 leads selected.</span></div>`);
  tableMount.insertAdjacentHTML('afterend',`<div id="leadMapPanel" style="display:block"><div class="grid-2"><div class="card" style="padding:12px"><div id="realLeadMapHeader" style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:4px"><h3 style="margin:0;font-size:14px;white-space:nowrap">Real Lead Map</h3><span class="muted small" style="margin:0;flex:1 1 auto">Select a lead below to view its service address. Assignment changes are saved to the real McCoy lead record.</span></div><iframe id="leadMapFrame" title="Selected lead map" style="width:100%;height:430px;border:1px solid #e5e7eb;border-radius:12px" loading="lazy"></iframe></div><div class="card" style="padding:12px"><h3>Map Assignment</h3><div id="mapLeadInfo" class="muted">Select a real lead.</div><label id="mapAssignLabel" class="small">Assign to rep</label><select id="mapRepSelect" style="width:100%;padding:10px;margin:6px 0"></select><button id="mapAssignBtn" class="primary" style="width:100%">ASSIGN SELECTED LEAD</button><div id="mapAssignMsg" class="muted small" style="margin-top:8px"></div><div id="mapLeadList" style="margin-top:12px;max-height:430px;overflow:auto"></div></div></div></div>`);
  tableMount.style.display='none';

  const isAdmin=()=>window.MCCOY_ACCESS?.access?.role==='admin';
  const isManager=()=>['manager','trainer'].includes(window.MCCOY_ACCESS?.access?.role);
  const canAssignLeads=()=>isAdmin()||isManager();
  const managerStyle=document.createElement('style');managerStyle.textContent='body.blind-tester.lead-pool-manager #leadMapPanel .grid-2>.card:nth-child(2){display:block!important}';document.head.appendChild(managerStyle);
  function applyLeadAccessControls(){
    const admin=isAdmin(),manager=isManager(),assigner=canAssignLeads();document.body.classList.toggle('lead-pool-manager',manager);const label=document.getElementById('mapAssignLabel');if(label)label.textContent=admin?'Assign to manager or rep':'Assign Admin-provided lead to rep';
    for(const id of ['demoLeadMode','addDemoLeadsBtn','adminLeadImportBtn']){const el=document.getElementById(id);if(el){el.hidden=!admin;el.disabled=!admin;}}
    for(const id of ['mapRepSelect','mapAssignBtn','bulkAssignMapBtn','lassoSelectBtn','selectVisiblePinsBtn','listRepSelect','listSelectPageBtn','listClearSelectionBtn','listAssignBtn']){const el=document.getElementById(id);if(el){el.hidden=!assigner;el.disabled=!assigner;}}
    const listBar=document.getElementById('leadListAssignmentBar');if(listBar){const visible=assigner&&state.leadView==='list'&&state.leadMode==='real';listBar.hidden=!visible;listBar.style.display=visible?'flex':'none';}
    if(!admin&&state.leadMode==='demo')state.leadMode='real';
  }

  const oldDemo=document.getElementById('addDemoLeadsBtn');
  if(oldDemo){const clone=oldDemo.cloneNode(true);oldDemo.replaceWith(clone);clone.addEventListener('click',()=>{if(!isAdmin())return;const base=state.demoLeads.length+1;for(let i=0;i<10;i++){const team=i%2===0?'Pacific Northwest':'North Carolina';const streets=team==='Pacific Northwest'?pnwStreets:ncStreets;state.demoLeads.push({id:200000+base+i,address:`${2100+(base+i)*3} ${streets[i%streets.length]}`,city:'Demo City',stateCode:team==='North Carolina'?'NC':'OR',zip:'00000',fullAddress:`Demo Lead ${base+i}`,team,rep:null,disposition:'Uncontacted',isDemo:true,sourceSystem:'DEMO'});}switchMode('demo');});}

  function currentRows(){return state.leadMode==='demo'&&isAdmin()?state.demoLeads:state.realLeads;}
  function ownerRoleLabel(role){return role==='admin'?'Admin':role==='manager'?'Manager':role==='trainer'?'Trainer':role==='tester'?'Rep':'Rep';}
  function syncLeadOwnerFilter(){
    const select=document.getElementById('leadOwnerFilter');if(!select)return;
    const previous=select.value,directory=(state.leadOwnershipDirectory||[]).slice().sort((a,b)=>{const rank={admin:0,manager:1,trainer:1,rep:2,tester:2};return (rank[a.role]??3)-(rank[b.role]??3)||String(a.display_name||a.email).localeCompare(String(b.display_name||b.email));});
    select.innerHTML='<option value="">All owners</option>'+(isAdmin()?'<option value="__unassigned__">Unassigned leads</option>':'')+directory.map(account=>`<option value="${esc(account.user_id)}">${esc(account.display_name||account.email)} (${ownerRoleLabel(account.role)})</option>`).join('');
    if(previous==='__unassigned__'&&isAdmin())select.value=previous;else if(directory.some(account=>String(account.user_id)===String(previous)))select.value=previous;
    select.title='Filter leads by administrator, manager, or representative';
  }
  function leadMatchesFilters(lead){
    const team=document.getElementById('teamFilter')?.value||'',selectedOwner=document.getElementById('leadOwnerFilter')?.value||'',search=(document.getElementById('leadSearch')?.value||'').trim().toLowerCase();
    if(team&&lead.team!==team)return false;
    if(selectedOwner==='__unassigned__'){if(lead.assignedRepId||lead.assignedManagerId||lead.assignedAdminEmail)return false;}
    else if(selectedOwner){
      const account=(state.leadOwnershipDirectory||[]).find(candidate=>String(candidate.user_id)===String(selectedOwner));
      if(!account)return false;
      if(account.role==='admin'){if(String(lead.assignedRepId||'')!==String(account.user_id)&&String(lead.assignedAdminEmail||'').toLowerCase()!==String(account.email||'').toLowerCase())return false;}
      else if(['manager','trainer'].includes(account.role)){if(String(lead.assignedManagerId||'')!==String(account.user_id)&&String(lead.assignedRepId||'')!==String(account.user_id))return false;}
      else if(String(lead.assignedRepId||'')!==String(account.user_id))return false;
    }
    if(!search)return true;
    return `${lead.address||''} ${lead.city||''} ${lead.stateCode||''} ${lead.zip||''} ${lead.rep||''} ${lead.ownerName||''} ${lead.ownerEmail||''} ${lead.assignedManagerName||''} ${lead.assignedAdminName||''}`.toLowerCase().includes(search);
  }
  window.MCCOY_LEAD_MATCHES_FILTER=leadMatchesFilters;
  function filteredRows(){return currentRows().filter(leadMatchesFilters);}
  function switchMode(mode){if(mode==='demo'&&!isAdmin())mode='real';applyLeadAccessControls();state.leadMode=mode;state.leadPage=1;state.leads=mode==='demo'?state.demoLeads:state.realLeads;document.getElementById('realLeadMode').className=mode==='real'?'primary':'assign-btn';document.getElementById('demoLeadMode').className=mode==='demo'?'primary':'assign-btn';document.getElementById('adminLeadImportBtn').style.display=mode==='real'&&isAdmin()?'inline-block':'none';renderLeads();}
  function switchView(view){state.leadView=view;document.getElementById('leadListView').className=view==='list'?'primary':'assign-btn';document.getElementById('leadMapView').className=view==='map'?'primary':'assign-btn';tableMount.style.display=view==='list'?'block':'none';document.getElementById('leadPager').style.display=view==='list'?'flex':'none';document.getElementById('leadMapPanel').style.display=view==='map'?'block':'none';applyLeadAccessControls();if(view==='map')renderMapList();else renderLeads();}

  async function loadAdminReps(){
    if(!canAssignLeads())return;
    try{const {data,error}=await sb.functions.invoke('lead-admin',{body:{action:'list_reps'}});if(error)throw error;adminReps=data?.reps||[];managerAdministratorAssigned=!isManager()||data?.administrator_assigned===true;renderRepSelect();}catch(e){console.error('Lead rep list failed',e);}
  }
  function renderRepSelect(){const options=`<option value="">${isManager()?'Return to My Admin-assigned Pool':'Unassigned'}</option>`+adminReps.map(r=>`<option value="${esc(r.email)}">${esc(r.display_name||r.email)}${r.role==='admin'?' (Admin)':r.role==='manager'?' (Manager)':r.role==='trainer'?' (Trainer)':''}</option>`).join('');for(const id of ['mapRepSelect','listRepSelect']){const select=document.getElementById(id);if(!select)continue;const current=select.value;select.innerHTML=options;select.disabled=isManager()&&!managerAdministratorAssigned;if(current&&adminReps.some(rep=>rep.email===current))select.value=current;}if(isManager()&&(!managerAdministratorAssigned||!adminReps.length)){for(const id of ['mapAssignMsg','listAssignMsg']){const msg=document.getElementById(id);if(msg)msg.textContent=managerAdministratorAssigned?'No representatives have been assigned to you yet.':'An Admin must be assigned as your supervisor before you can receive or assign leads.';}}}

  window.renderLeads=function(){
    const rows=filteredRows();
    const total=rows.length,pages=Math.max(1,Math.ceil(total/state.leadPageSize));if(state.leadPage>pages)state.leadPage=pages;
    const start=(state.leadPage-1)*state.leadPageSize,page=rows.slice(start,start+state.leadPageSize);
    const fullCount=currentRows().length,scope='ALL LEADS';document.getElementById('leadPoolCount').textContent=`${state.leadMode==='real'?scope:'DEMO'} · ${total.toLocaleString()}${total!==fullCount?' of '+fullCount.toLocaleString():''} leads`;
    document.getElementById('leadPageLabel').textContent=`Page ${state.leadPage} of ${pages} · ${total.toLocaleString()} total`;
    document.getElementById('leadPrev').disabled=state.leadPage<=1;document.getElementById('leadNext').disabled=state.leadPage>=pages;
    const selectable=canAssignLeads()&&state.leadMode==='real';
    tableMount.innerHTML=`<table><thead><tr>${selectable?'<th><input id="leadSelectPageCheckbox" type="checkbox" aria-label="Select all leads on this page"></th>':''}<th>Type</th><th>Address</th><th>Team</th><th>Owner</th><th>Assigned Rep</th><th>Disposition</th>${state.leadMode==='real'?'<th>Map</th>':''}</tr></thead><tbody>${page.map(l=>`<tr>${selectable?`<td><input class="lead-list-checkbox" type="checkbox" data-lead-id="${esc(l.dbId)}" ${selectedListLeadIds.has(l.dbId)?'checked':''} aria-label="Select ${esc(l.address)}"></td>`:''}<td><strong>${l.isDemo?'DEMO':'REAL'}</strong></td><td>${esc([l.address,l.city,l.stateCode,l.zip].filter(Boolean).join(', '))}</td><td>${esc(l.team)}</td><td>${esc(l.ownerName||'Unassigned')}${l.ownerRole&&l.ownerRole!=='unassigned'?` <span class="muted small">(${esc(ownerRoleLabel(l.ownerRole))})</span>`:''}</td><td>${esc(l.assignedRepName||l.rep||'Unassigned')}</td><td>${esc(l.disposition)}</td>${state.leadMode==='real'?`<td><button class="assign-btn map-one" data-id="${l.id}">View / Assign</button></td>`:''}</tr>`).join('')}</tbody></table>`;
    tableMount.querySelectorAll('.map-one').forEach(b=>b.addEventListener('click',()=>{selectedMapLeadId=Number(b.dataset.id);switchView('map');selectMapLead(selectedMapLeadId);}));
    if(selectable){tableMount.querySelectorAll('.lead-list-checkbox').forEach(box=>box.addEventListener('change',()=>{if(box.checked)selectedListLeadIds.add(box.dataset.leadId);else selectedListLeadIds.delete(box.dataset.leadId);updateListSelectionStatus();}));const all=document.getElementById('leadSelectPageCheckbox');if(all){all.checked=page.length>0&&page.every(lead=>selectedListLeadIds.has(lead.dbId));all.onchange=()=>{for(const lead of page){if(all.checked)selectedListLeadIds.add(lead.dbId);else selectedListLeadIds.delete(lead.dbId);}renderLeads();updateListSelectionStatus();}}}
    renderFieldLeadSelect();
    if(state.leadView==='map')renderMapList();
  };

  function renderMapList(){
    const root=document.getElementById('mapLeadList');if(!root)return;
    if(state.leadMode!=='real'){root.innerHTML='<div class="muted">Map assignment is for real leads. Switch to REAL LEADS.</div>';return;}
    const filtered=filteredRows(),rows=filtered.slice(0,250);
    root.innerHTML=rows.map(l=>`<button class="assign-btn map-pick" data-id="${l.id}" style="display:block;width:100%;text-align:left;margin:4px 0">${esc([l.address,l.city,l.stateCode,l.zip].filter(Boolean).join(', '))}</button>`).join('')+(filtered.length>250?'<div class="muted small">Showing first 250 filtered leads. Use search/team filters to narrow the map assignment list.</div>':'');
    root.querySelectorAll('.map-pick').forEach(b=>b.addEventListener('click',()=>selectMapLead(Number(b.dataset.id))));
  }
  function selectMapLead(id){
    const l=state.realLeads.find(x=>x.id===id);if(!l)return;selectedMapLeadId=id;
    const addr=l.fullAddress||[l.address,l.city,l.stateCode,l.zip].filter(Boolean).join(', ');
    document.getElementById('mapLeadInfo').innerHTML=`<strong>${esc(addr)}</strong><div class="muted small">${esc(l.team)} · ${esc(l.disposition)}</div><div class="muted small"><strong>Owner:</strong> ${esc(l.ownerName||'Unassigned')}${l.ownerRole&&l.ownerRole!=='unassigned'?` (${esc(ownerRoleLabel(l.ownerRole))})`:''}</div>`;
    document.getElementById('leadMapFrame').src='https://maps.google.com/maps?q='+encodeURIComponent(addr)+'&output=embed';
    document.getElementById('mapAssignMsg').textContent='';
  }
  function updateListSelectionStatus(message=''){const status=document.getElementById('listAssignMsg');if(status)status.textContent=message||`${selectedListLeadIds.size.toLocaleString()} lead${selectedListLeadIds.size===1?'':'s'} selected.`;}
  async function assignListSelection(){
    if(!canAssignLeads()){updateListSelectionStatus('Only Managers, Trainers, and Administrators can assign leads.');return;}
    const ids=[...selectedListLeadIds];if(!ids.length){updateListSelectionStatus('Select at least one lead from the list.');return;}
    const email=document.getElementById('listRepSelect')?.value||'',button=document.getElementById('listAssignBtn');if(button)button.disabled=true;updateListSelectionStatus(`Assigning ${ids.length.toLocaleString()} selected leads…`);
    try{for(let index=0;index<ids.length;index+=500){const {data,error}=await sb.functions.invoke('lead-admin',{body:{action:'assign_leads',lead_ids:ids.slice(index,index+500),rep_email:email}});if(error||!data?.ok)throw error||new Error(data?.error||'list_assignment_failed');}selectedListLeadIds.clear();await window.loadMcCoyLeads?.();switchView('list');updateListSelectionStatus(`${ids.length.toLocaleString()} lead${ids.length===1?'':'s'} assigned successfully.`);}catch(error){console.error('List assignment failed',error);updateListSelectionStatus(`Assignment failed${error?.message?': '+error.message:''}.`);}finally{if(button)button.disabled=false;}
  }
  async function assignSelected(){
    const l=state.realLeads.find(x=>x.id===selectedMapLeadId);if(!l)return;
    if(!canAssignLeads()){document.getElementById('mapAssignMsg').textContent='Only Managers, Trainers, and Administrators can change real lead assignments.';return;}
    const email=document.getElementById('mapRepSelect').value,msg=document.getElementById('mapAssignMsg');msg.textContent='Saving assignment…';
    try{const {data,error}=await sb.functions.invoke('lead-admin',{body:{action:'assign_lead',lead_id:l.dbId,rep_email:email}});if(error||!data?.ok)throw error||new Error(data?.error||'assignment_failed');const r=adminReps.find(x=>x.email===email);l.assignedRepId=data.assigned_rep_id||null;l.assignedManagerId=data.assigned_manager_id||null;l.assignedAdminEmail=data.assigned_admin_email||null;if(window.MCCOY_APPLY_LEAD_OWNERSHIP)window.MCCOY_APPLY_LEAD_OWNERSHIP(l);else l.rep=r?.display_name||r?.email||null;msg.textContent=['manager','trainer'].includes(data.destination_role)?`Lead assigned to ${data.destination_role} pool.`:email?'Lead assigned successfully.':isManager()?'Lead returned to your Admin-assigned pool.':'Lead returned to unassigned pool.';renderLeads();selectMapLead(l.id);}catch(e){console.error(e);msg.textContent='Unable to save assignment.';}
  }

  document.getElementById('realLeadMode').onclick=()=>switchMode('real');
  document.getElementById('demoLeadMode').onclick=()=>{if(isAdmin())switchMode('demo');};
  document.getElementById('leadListView').onclick=()=>switchView('list');
  document.getElementById('leadMapView').onclick=()=>switchView('map');
  document.getElementById('leadPrev').onclick=()=>{if(state.leadPage>1){state.leadPage--;renderLeads();}};
  document.getElementById('leadNext').onclick=()=>{state.leadPage++;renderLeads();};
  document.getElementById('leadPageSize').onchange=e=>{state.leadPageSize=Number(e.target.value)||50;state.leadPage=1;renderLeads();};
  document.getElementById('teamFilter').addEventListener('change',()=>{state.leadPage=1;renderLeads();});
  document.getElementById('leadOwnerFilter')?.addEventListener('change',()=>{state.leadPage=1;renderLeads();});
  document.getElementById('leadSearch').addEventListener('input',()=>{state.leadPage=1;renderLeads();});
  document.getElementById('mapAssignBtn').onclick=assignSelected;
  document.getElementById('listAssignBtn').onclick=assignListSelection;
  document.getElementById('listClearSelectionBtn').onclick=()=>{selectedListLeadIds.clear();renderLeads();updateListSelectionStatus();};
  document.getElementById('listSelectPageBtn').onclick=()=>{const start=(state.leadPage-1)*state.leadPageSize;for(const lead of filteredRows().slice(start,start+state.leadPageSize))if(lead.dbId)selectedListLeadIds.add(lead.dbId);renderLeads();updateListSelectionStatus();};
  window.addEventListener('mccoy-access-ready',()=>{applyLeadAccessControls();syncLeadOwnerFilter();loadAdminReps();});
  window.addEventListener('mccoy-lead-owners-updated',()=>syncLeadOwnerFilter());
  window.addEventListener('mccoy-real-leads-loaded',()=>{const view=state.leadView;applyLeadAccessControls();syncLeadOwnerFilter();switchMode('real');switchView(view==='list'?'list':'map');loadAdminReps();});
  setTimeout(()=>{applyLeadAccessControls();syncLeadOwnerFilter();switchMode(state.realLeads.length?'real':(isAdmin()?'demo':'real'));switchView(state.realLeads.length?'map':'list');loadAdminReps();},900);
})();
