(()=>{
  async function loadAllLeadRows(){
    const PAGE=1000;
    const rows=[];
    for(let from=0;;from+=PAGE){
      const {data,error}=await sb.from('leads')
        .select('id,source_id,address1,address2,city,state,zip,latitude,longitude,current_disposition,assigned_rep_id,assigned_team_id')
        .order('address1',{ascending:true})
        .range(from,from+PAGE-1);
      if(error)throw error;
      const page=data||[];
      rows.push(...page);
      if(page.length<PAGE)break;
    }
    return rows;
  }

  async function loadMcCoyLeads(){
    try{
      const {data:{user}}=await sb.auth.getUser();
      if(!user)return;
      const access=window.MCCOY_ACCESS?.access;
      if(!access?.active)return;
      const data=await loadAllLeadRows();
      const real=data.map((r,i)=>({
        id:100000+i,
        dbId:r.id,
        sourceId:r.source_id,
        address:[r.address1,r.address2].filter(Boolean).join(' '),
        city:r.city||'',stateCode:r.state||'',zip:r.zip||'',
        lat:r.latitude,lng:r.longitude,
        team:r.state==='NC'?'North Carolina':(['OR','WA'].includes(r.state)?'Pacific Northwest':'Unassigned'),
        rep:null,
        disposition:r.current_disposition||'Uncontacted'
      }));
      if(real.length){
        state.leads=real;
        for(const t of state.teams)t.leads=real.filter(l=>l.team===t.name).length;
        const demoBtn=document.getElementById('addDemoLeadsBtn');if(demoBtn&&access.role==='admin')demoBtn.style.display='none';
        renderAll();
        console.log(`McCoy Lead Pool loaded: ${real.length} leads.`);
      }else if(access.role==='admin'){
        state.leads=[];for(const t of state.teams)t.leads=0;renderAll();
      }
    }catch(e){console.error('Real lead load failed',e);}
  }
  window.loadMcCoyLeads=loadMcCoyLeads;
  sb.auth.onAuthStateChange((_event,session)=>{if(session)setTimeout(loadMcCoyLeads,150);});
  setTimeout(loadMcCoyLeads,500);
})();