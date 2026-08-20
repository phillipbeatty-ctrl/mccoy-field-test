(function teamsRegionsApp(){
  const REGIONS=['Pacific Northwest','North Carolina','Texas','Midwest','South East','North East','California'];
  let users=[];
  let regions=REGIONS.map(name=>({name,manager_email:null,manager_name:null,manager_role:null}));
  let loadPromise=null;

  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const isAdmin=()=>window.MCCOY_ACCESS?.access?.role==='admin';

  async function onboarding(action,payload={}){
    const {data,error}=await sb.functions.invoke('rep-onboarding',{body:{action,...payload}});
    if(error)throw error;
    if(!data?.ok)throw new Error(data?.detail||data?.error||'region_request_failed');
    return data;
  }

  function leadCount(regionName){
    return (state.realLeads||[]).filter(lead=>lead.team===regionName).length;
  }

  function syncState(){
    const previous=new Map((state.teams||[]).map(team=>[team.name,team]));
    state.teams=REGIONS.map(name=>{
      const region=regions.find(item=>item.name===name)||{};
      return {
        ...(previous.get(name)||{}),
        name,
        manager:region.manager_name||null,
        managerEmail:region.manager_email||null,
        leads:leadCount(name)
      };
    });
    if(typeof window.renderDashboard==='function')window.renderDashboard();
  }

  function populateSelect(select){
    if(!select||select.dataset.mccoyRegions==='2')return;
    const current=select.value;
    let firstLabel='No team';
    if(select.id==='teamFilter')firstLabel='All Teams';
    else if(select.id==='signupTeam'||select.id==='requestTeam')firstLabel='Select region (optional)';
    select.innerHTML=`<option value="">${firstLabel}</option>`+REGIONS.map(name=>`<option value="${esc(name)}">${esc(name)}</option>`).join('');
    if(REGIONS.includes(current))select.value=current;
    select.dataset.mccoyRegions='2';
  }

  function populateRegionSelects(root=document){
    root.querySelectorAll?.('#teamFilter,#signupTeam,#requestTeam,select[id^="arTeam"],select[id^="uaTeam"]').forEach(populateSelect);
  }

  function renderRegions(){
    const root=document.getElementById('teamsTable');
    if(!root)return;
    if(!isAdmin()){
      root.innerHTML='<div class="muted">Regional manager assignments are available to administrators.</div>';
      return;
    }
    const options=users.map(user=>`<option value="${esc(user.email)}">${esc(user.display_name||user.email)} · ${esc(user.role==='admin'?'Admin':user.role==='manager'?'Manager':'Rep')}</option>`).join('');
    root.innerHTML=`<div id="regionManagerMessage" class="muted small" aria-live="polite" style="margin-bottom:10px">Select any active account to manage a region.</div><table><thead><tr><th>Region</th><th>Manager</th><th>Lead Pool</th><th>Assign Manager</th></tr></thead><tbody>${regions.map((region,index)=>`<tr><td><strong>${esc(region.name)}</strong></td><td>${region.manager_name?`${esc(region.manager_name)}${region.manager_role?` <span class="muted small">(${esc(region.manager_role==='admin'?'Admin':'Manager')})</span>`:''}`:'<span class="status-warn">Manager Needed</span>'}</td><td>${leadCount(region.name).toLocaleString()}</td><td><div style="display:flex;gap:8px;align-items:center;min-width:280px"><select id="regionManager${index}" aria-label="Manager for ${esc(region.name)}" style="min-width:190px;max-width:260px"><option value="">No manager</option>${options}</select><button id="saveRegionManager${index}" class="primary">Assign</button></div></td></tr>`).join('')}</tbody></table>`;
    regions.forEach((region,index)=>{
      const select=document.getElementById('regionManager'+index);
      if(region.manager_email&&users.some(user=>user.email===region.manager_email))select.value=region.manager_email;
      document.getElementById('saveRegionManager'+index).onclick=async()=>{
        const button=document.getElementById('saveRegionManager'+index);
        const message=document.getElementById('regionManagerMessage');
        button.disabled=true;
        button.textContent='Saving…';
        message.textContent=`Updating ${region.name}…`;
        try{
          const result=await onboarding('assign_region_manager',{region_name:region.name,manager_email:select.value});
          message.style.color='#166534';
          message.textContent=result.manager_name?`${result.manager_name} is now the manager of ${region.name}.`:`${region.name} no longer has an assigned manager.`;
          await loadRegions(true);
        }catch(error){
          console.error('Region manager assignment failed',error);
          message.style.color='#991b1b';
          message.textContent=`Unable to update ${region.name}${error?.message?': '+error.message:''}.`;
          button.disabled=false;
          button.textContent='Assign';
        }
      };
    });
  }

  async function loadRegions(force=false){
    if(!isAdmin())return;
    if(loadPromise&&!force)return loadPromise;
    loadPromise=(async()=>{
      const data=await onboarding('list_regions');
      regions=REGIONS.map(name=>data.regions?.find(region=>region.name===name)||{name,manager_email:null,manager_name:null,manager_role:null});
      users=(data.users||[]).filter(user=>user?.email);
      syncState();
      renderRegions();
      populateRegionSelects();
    })();
    try{return await loadPromise;}finally{loadPromise=null;}
  }

  const existing=new Map((state.teams||[]).map(team=>[team.name,team]));
  state.teams=REGIONS.map(name=>({...existing.get(name),name,manager:existing.get(name)?.manager||null,leads:existing.get(name)?.leads||0}));
  window.MCCOY_REGIONS=REGIONS.slice();
  window.renderTeams=renderRegions;

  const observer=new MutationObserver(records=>{
    for(const record of records){
      for(const node of record.addedNodes){
        if(node.nodeType===1)populateRegionSelects(node.matches?.('select')?node.parentElement||document:node);
      }
    }
  });
  observer.observe(document.body,{childList:true,subtree:true});
  populateRegionSelects();
  syncState();
  renderRegions();

  window.addEventListener('mccoy-access-ready',()=>{populateRegionSelects();loadRegions(true).catch(error=>console.error('Region loading failed',error));});
  window.addEventListener('mccoy-real-leads-loaded',()=>{syncState();renderRegions();});
  document.querySelector('.nav-btn[data-view="teams"]')?.addEventListener('click',()=>loadRegions(true).catch(error=>{
    console.error('Region loading failed',error);
    const root=document.getElementById('teamsTable');
    if(root)root.innerHTML='<div class="muted">Unable to load regional manager assignments.</div>';
  }));
  setTimeout(()=>{populateRegionSelects();if(isAdmin())loadRegions(true).catch(error=>console.error('Region loading failed',error));},900);
})();

