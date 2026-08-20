(()=>{
  const MODE_KEY='mccoy.managerLeadPoolPosition';
  const ASSIGN_MODE='assign';
  const KNOCK_MODE='knock';
  let managerMode=readMode();

  function readMode(){
    try{return sessionStorage.getItem(MODE_KEY)===KNOCK_MODE?KNOCK_MODE:ASSIGN_MODE;}
    catch(_error){return ASSIGN_MODE;}
  }

  function saveMode(mode){
    try{sessionStorage.setItem(MODE_KEY,mode);}catch(_error){}
  }

  function currentRole(){
    const access=window.MCCOY_ACCESS?.access;
    if(!access||access.active===false)return null;
    return String(access.role||'').toLowerCase();
  }

  function isRepRole(role){
    return Boolean(role)&&role!=='admin'&&role!=='manager';
  }

  function ensureStyles(){
    if(document.getElementById('leadPoolRoleLayoutStyles'))return;
    const style=document.createElement('style');
    style.id='leadPoolRoleLayoutStyles';
    style.textContent=`
      #leadManagerPositionToggle{display:none;align-items:center;gap:5px;flex-wrap:wrap;margin-left:auto;padding-left:8px;border-left:1px solid #dbe3f2}
      #leadManagerPositionToggle .lead-position-label{font-size:10px;font-weight:800;color:#4b5563;text-transform:uppercase;letter-spacing:.035em}
      #leadManagerPositionToggle button[aria-pressed="true"]{background:#1455d9;color:#fff;border-color:#1455d9}
      #leadManagerPositionToggle button:focus-visible{outline:3px solid rgba(20,85,217,.3);outline-offset:2px}
      body.lead-pool-manager-position #leadManagerPositionToggle{display:flex}
      #leadMapPanel.lead-map-expanded>.grid-2{grid-template-columns:minmax(0,1fr)!important}
      #leadMapPanel.lead-map-expanded>.grid-2>.card:first-child{grid-column:1/-1!important;width:100%!important;max-width:none!important}
      #leadMapPanel.lead-map-expanded>.grid-2>.card:nth-child(2){display:none!important}
      @media(max-width:720px){
        #leadManagerPositionToggle{width:100%;margin-left:0;padding:6px 0 0;border-left:0;border-top:1px solid #dbe3f2}
        #leadManagerPositionToggle button{flex:1 1 135px}
      }
    `;
    document.head.appendChild(style);
  }

  function ensureManagerToggle(){
    const bar=document.getElementById('leadModeBar');
    if(!bar)return null;
    let toggle=document.getElementById('leadManagerPositionToggle');
    if(toggle)return toggle;
    toggle=document.createElement('div');
    toggle.id='leadManagerPositionToggle';
    toggle.setAttribute('role','group');
    toggle.setAttribute('aria-label','Manager Lead Pool position');
    toggle.innerHTML=`<span class="lead-position-label">Manager position</span><button id="leadAssignPositionBtn" type="button" class="assign-btn">ASSIGN LEADS</button><button id="leadKnockPositionBtn" type="button" class="assign-btn">KNOCK DOORS</button>`;
    bar.appendChild(toggle);
    document.getElementById('leadAssignPositionBtn').addEventListener('click',()=>setManagerMode(ASSIGN_MODE));
    document.getElementById('leadKnockPositionBtn').addEventListener('click',()=>setManagerMode(KNOCK_MODE));
    return toggle;
  }

  function setManagerMode(mode){
    managerMode=mode===KNOCK_MODE?KNOCK_MODE:ASSIGN_MODE;
    saveMode(managerMode);
    applyLayout();
  }

  function setSidePanelAvailable(sideCard,available){
    if(!sideCard)return;
    sideCard.classList.add('lead-pool-side-panel');
    sideCard.toggleAttribute('inert',!available);
    sideCard.setAttribute('aria-hidden',available?'false':'true');
  }

  function refreshMapLayout(){
    requestAnimationFrame(()=>{
      window.dispatchEvent(new Event('resize'));
      window.MCCOY_INVALIDATE_LEAD_MAP?.();
    });
  }

  function applyLayout(){
    ensureStyles();
    const role=currentRole();
    const panel=document.getElementById('leadMapPanel');
    const map=document.getElementById('leadMapFrame');
    const mapCard=map?.closest('.card');
    const sideCard=document.getElementById('mapLeadList')?.closest('.card')||document.getElementById('bulkAssignMapBtn')?.closest('.card');
    const toggle=ensureManagerToggle();
    if(!role){
      document.body.classList.remove('lead-pool-manager-position','lead-pool-knock-position','lead-pool-rep-layout');
      panel?.classList.remove('lead-map-expanded');
      if(toggle)toggle.hidden=true;
      setSidePanelAvailable(sideCard,false);
      refreshMapLayout();
      return;
    }
    const manager=role==='manager';
    const rep=isRepRole(role);
    const expanded=rep||(manager&&managerMode===KNOCK_MODE);

    document.body.classList.toggle('lead-pool-manager-position',manager);
    document.body.classList.toggle('lead-pool-knock-position',manager&&managerMode===KNOCK_MODE);
    document.body.classList.toggle('lead-pool-rep-layout',rep);
    panel?.classList.toggle('lead-map-expanded',expanded);
    mapCard?.classList.add('lead-pool-map-card');
    setSidePanelAvailable(sideCard,!expanded);

    if(toggle){
      toggle.hidden=!manager;
      const assign=document.getElementById('leadAssignPositionBtn');
      const knock=document.getElementById('leadKnockPositionBtn');
      const assigning=managerMode===ASSIGN_MODE;
      assign?.setAttribute('aria-pressed',String(assigning));
      knock?.setAttribute('aria-pressed',String(!assigning));
      if(assign)assign.className=assigning?'primary':'assign-btn';
      if(knock)knock.className=assigning?'assign-btn':'primary';
    }

    const viewButton=document.getElementById('leadMapView');
    if(viewButton)viewButton.textContent=role==='admin'||(manager&&managerMode===ASSIGN_MODE)?'MAP / ASSIGN':'KNOCK DOORS';
    const help=document.querySelector('#realLeadMapHeader .muted');
    if(help){
      help.textContent=role==='admin'||(manager&&managerMode===ASSIGN_MODE)
        ?'Select leads on the map, then assign the selection from the panel on the right.'
        :'Select a map marker to work a door. The map fills the Lead Pool workspace.';
    }

    refreshMapLayout();
    window.dispatchEvent(new CustomEvent('mccoy-lead-pool-position-changed',{detail:{role,mode:manager?managerMode:'knock',expanded}}));
  }

  window.MCCOY_SET_MANAGER_LEAD_POSITION=mode=>{
    if(currentRole()!=='manager')return false;
    setManagerMode(mode);
    return true;
  };

  document.addEventListener('DOMContentLoaded',()=>setTimeout(applyLayout,0));
  window.addEventListener('mccoy-access-ready',applyLayout);
  window.addEventListener('mccoy-real-leads-loaded',()=>setTimeout(applyLayout,0));
  document.addEventListener('click',event=>{
    if(event.target?.closest?.('[data-view="leads"],#leadMapView'))setTimeout(applyLayout,0);
  });
  setTimeout(applyLayout,1000);
})();
