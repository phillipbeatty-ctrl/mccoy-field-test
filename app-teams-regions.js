(function teamsRegionsApp(){
  const REGIONS=['Pacific Northwest','North Carolina','Texas','Midwest','South East','North East','California'];
  let users=[];
  let regions=REGIONS.map(name=>({name,manager_email:null,manager_name:null,manager_role:null}));
  let rosters=[],unassignedReps=[];

  const css=document.createElement('style');css.textContent=`.team-roster-card{margin-top:10px}.team-roster-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:8px;margin-top:8px}.manager-team{border:1px solid #e5e7eb;border-radius:12px;background:#fff;overflow:hidden}.manager-team-head{padding:10px 12px;background:#f8fafc;border-bottom:1px solid #e5e7eb}.manager-team-head h3{margin:0;font-size:15px}.manager-team-regions{display:flex;gap:5px;flex-wrap:wrap;margin-top:6px}.manager-team-region{display:inline-block;padding:3px 7px;border-radius:999px;background:#dbeafe;color:#1d4ed8;font-size:10px;font-weight:700}.manager-team-reps{list-style:none;margin:0;padding:5px 12px 9px}.manager-team-reps li{display:flex;justify-content:space-between;gap:10px;padding:7px 0;border-bottom:1px solid #f0f2f4;font-size:13px}.manager-team-reps li:last-child{border-bottom:0}.manager-team-empty{padding:11px 12px;color:#6b7280;font-size:12px}.manager-team.unassigned{border-color:#f3d28b}.manager-team.unassigned .manager-team-head{background:#fffbeb}`;document.head.appendChild(css);

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

  function updateRegionSelect(select,region,options){
    const editing=document.activeElement===select||select.dataset.dirty==='1';
    if(select.dataset.options!==options){
      if(editing){select._pendingRegion={region,options};return;}
      select.innerHTML=options;select.dataset.options=options;
    }
    if(!editing)select.value=region.manager_email||'';
    select._pendingRegion=editing?{region,options}:null;
  }

  function renderRegions(){
    const root=document.getElementById('teamsTable');if(!root)return;
    if(!isAdmin()){window.MCCOY_UI.html(root,'<div class="muted">Regional manager assignments are available to administrators.</div>');return;}
    const roleLabel=role=>role==='admin'?'Admin':role==='trainer'?'Trainer':role==='manager'?'Manager':'Rep';
    const options='<option value="">No team lead</option>'+users.map(user=>`<option value="${esc(user.email)}">${esc(user.display_name||user.email)} · ${esc(roleLabel(user.role))}</option>`).join('');
    if(!root.querySelector('#regionManager0')){
      root.innerHTML=`<div id="regionManagerMessage" class="muted small" aria-live="polite" style="margin-bottom:10px">Select an active account to manage a region. Existing Trainers remain Trainers.</div><table><thead><tr><th>Region</th><th>Manager / Trainer</th><th>Lead Pool</th><th>Assign Team Lead</th></tr></thead><tbody>${regions.map((region,index)=>`<tr><td><strong>${esc(region.name)}</strong></td><td id="regionManagerName${index}"></td><td id="regionLeadCount${index}"></td><td><div style="display:flex;gap:8px;align-items:center;min-width:280px"><select id="regionManager${index}" aria-label="Manager or Trainer for ${esc(region.name)}" style="min-width:190px;max-width:260px"></select><button id="saveRegionManager${index}" class="primary">Assign</button></div></td></tr>`).join('')}</tbody></table>`;
      regions.forEach((region,index)=>{
        const select=document.getElementById('regionManager'+index),button=document.getElementById('saveRegionManager'+index);
        select.addEventListener('change',()=>{select.dataset.dirty='1';});
        select.addEventListener('blur',()=>{const pending=select._pendingRegion;if(pending)updateRegionSelect(select,pending.region,pending.options);});
        button.onclick=async()=>{
          const message=document.getElementById('regionManagerMessage'),submitted=select.value;
          button.disabled=true;button.textContent='Saving…';message.textContent=`Updating ${region.name}…`;
          try{
            const result=await onboarding('assign_region_manager',{region_name:region.name,manager_email:submitted});
            if(select.value===submitted)delete select.dataset.dirty;
            message.style.color='#166534';message.textContent=result.manager_name?`${result.manager_name} is now the manager of ${region.name}.`:`${region.name} no longer has an assigned manager.`;
            await loadRegions(true);
          }catch(error){console.error('Region manager assignment failed',error);message.style.color='#991b1b';message.textContent=`Unable to update ${region.name}${error?.message?': '+error.message:''}.`;}
          finally{button.disabled=false;button.textContent='Assign';}
        };
      });
    }
    regions.forEach((region,index)=>{
      window.MCCOY_UI.text(document.getElementById('regionManagerName'+index),region.manager_name?`${region.manager_name}${region.manager_role?' ('+roleLabel(region.manager_role)+')':''}`:'Team Lead Needed');
      window.MCCOY_UI.text(document.getElementById('regionLeadCount'+index),leadCount(region.name).toLocaleString());
      updateRegionSelect(document.getElementById('regionManager'+index),region,options);
    });
  }

  function ensureRosterBox(){
    const teams=document.getElementById('teams');if(!teams)return null;
    let card=document.getElementById('teamRosterCard');if(card)return card;
    card=document.createElement('div');card.id='teamRosterCard';card.className='card team-roster-card';card.innerHTML='<div class="card-head"><div><h2>Manager & Trainer Teams</h2><p class="muted">Each Manager or Trainer is shown above their assigned reps. Trainees are identified in the roster.</p></div><button id="teamRosterRefresh" class="assign-btn">Refresh</button></div><div id="teamRosterMessage" class="muted small" role="status" aria-live="polite"></div><div id="teamRosterGrid" class="team-roster-grid"></div>';teams.appendChild(card);document.getElementById('teamRosterRefresh').onclick=()=>loadRegions(true).catch(error=>console.error('Team roster refresh failed',error));return card;
  }

  function repList(reps){return reps.length?`<ul class="manager-team-reps">${reps.map(rep=>`<li><strong>${esc(rep.display_name||'Rep')}${rep.sales_classification==='trainee'?' · Trainee':''}</strong><span class="muted small">${esc(rep.region||'No team')}</span></li>`).join('')}</ul>`:'<div class="manager-team-empty">No reps are currently assigned to this team lead.</div>';}

  function renderRosters(){
    ensureRosterBox();const grid=document.getElementById('teamRosterGrid'),message=document.getElementById('teamRosterMessage');if(!grid||!message)return;
    const leaderLabel=role=>role==='admin'?'Admin supervisor':role==='trainer'?'Trainer':'Manager';
    const groups=rosters.map(roster=>`<section class="manager-team"><div class="manager-team-head"><h3>${esc(roster.manager_name||'Team lead')}</h3><div class="muted small">${esc(leaderLabel(roster.manager_role))} · ${(roster.reps||[]).length} rep${(roster.reps||[]).length===1?'':'s'}</div><div class="manager-team-regions">${(roster.regions||[]).length?(roster.regions||[]).map(region=>`<span class="manager-team-region">${esc(region)}</span>`).join(''):'<span class="muted small">No managed region</span>'}</div></div>${repList(roster.reps||[])}</section>`);
    if(unassignedReps.length)groups.push(`<section class="manager-team unassigned"><div class="manager-team-head"><h3>Unassigned Reps</h3><div class="muted small">Assign these reps—including trainees—to a team and Manager or Trainer in Users & Access below.</div></div>${repList(unassignedReps)}</section>`);
    grid.innerHTML=groups.join('')||'<div class="muted">No Manager or Trainer teams are available yet.</div>';message.textContent=`${rosters.length} team lead${rosters.length===1?'':'s'} · ${rosters.reduce((sum,roster)=>sum+(roster.reps||[]).length,0)} assigned rep${rosters.reduce((sum,roster)=>sum+(roster.reps||[]).length,0)===1?'':'s'}`;
  }

  async function loadRegions(){
    const [rosterData,data]=await Promise.all([onboarding('team_rosters'),isAdmin()?onboarding('list_regions'):Promise.resolve(null)]);
    rosters=Array.isArray(rosterData.rosters)?rosterData.rosters:[];unassignedReps=Array.isArray(rosterData.unassigned_reps)?rosterData.unassigned_reps:[];
    if(data){regions=REGIONS.map(name=>data.regions?.find(region=>region.name===name)||{name,manager_email:null,manager_name:null,manager_role:null});users=(data.users||[]).filter(user=>user?.email);syncState();}
    renderRegions();renderRosters();populateRegionSelects();
  }
  loadRegions=window.MCCOY_UI.coalesceRefresh(loadRegions);

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
  ensureRosterBox();
  renderRosters();

  window.addEventListener('mccoy-access-ready',()=>{populateRegionSelects();loadRegions(true).catch(error=>console.error('Region loading failed',error));});
  window.addEventListener('mccoy-real-leads-loaded',()=>{syncState();renderRegions();});
  document.querySelector('.nav-btn[data-view="teams"]')?.addEventListener('click',()=>loadRegions(true).catch(error=>{
    console.error('Region loading failed',error);
    const root=document.getElementById('teamsTable');
    if(root)root.innerHTML='<div class="muted">Unable to load regional manager assignments.</div>';
  }));
  setTimeout(()=>{populateRegionSelects();if(window.MCCOY_ACCESS?.access?.active)loadRegions(true).catch(error=>console.error('Team loading failed',error));},900);
})();
