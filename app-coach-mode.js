(function(){
  function applyVisibility(){
    const card=document.getElementById('coachMetrics');
    if(!card)return false;
    const access=window.MCCOY_ACCESS?.access;
    if(!access)return false;
    const isAdmin=access.role==='admin';
    card.style.display=isAdmin?'block':'none';
    if(!isAdmin){
      document.getElementById('coachMetricsBody')?.replaceChildren();
    }
    return isAdmin;
  }

  async function load(){
    if(!applyVisibility()) return;
    const b=document.getElementById('coachMetricsBody');if(!b)return;
    try{
      b.textContent='Loading latest field data…';
      const {data,error}=await sb.functions.invoke('rep-coach-summary');
      if(error)throw error;
      if(!data?.ok||!data.summary){b.textContent='No completed field session yet.';return;}
      const m=data.summary;
      const rows=[
        ['Rep',m.tester_name||m.tester_email||'—'],
        ['Doors',m.doors??'—'],
        ['Contacts',m.contacts??'—'],
        ['Sales',m.sales??'—'],
        ['Not Home avg',m.dwell?.not_home_ms!=null?(m.dwell.not_home_ms/1000).toFixed(1)+' sec':'—'],
        ['Sale avg',m.dwell?.sale_ms!=null?(m.dwell.sale_ms/1000).toFixed(1)+' sec':'—'],
        ['Average transition',m.transition?.average_ms!=null?(m.transition.average_ms/1000).toFixed(1)+' sec':'—'],
        ['GPS accuracy',m.gps?.average_accuracy_m!=null?'±'+m.gps.average_accuracy_m.toFixed(1)+' m':'—'],
        ['Tracked distance',m.movement?.distance_m!=null?m.movement.distance_m.toFixed(1)+' m':'—'],
        ['Moving time',m.movement?.moving_ms!=null?Math.round(m.movement.moving_ms/1000)+' sec':'—'],
        ['Auto-stop',m.auto_stop?.reason||'None'],
        ['Session',m.session_id||'Latest']
      ];
      b.innerHTML='<div class="mini-stats" style="grid-template-columns:repeat(3,1fr)">'+rows.map(r=>'<div><span>'+r[0]+'</span><strong>'+r[1]+'</strong></div>').join('')+'</div>';
    }catch(e){console.error(e);b.textContent='Admin coaching summary unavailable right now.';}
  }

  document.getElementById('coachRefreshBtn')?.addEventListener('click',load);
  const t=setInterval(()=>{
    if(!window.MCCOY_ACCESS?.user)return;
    clearInterval(t);
    if(applyVisibility()) load();
  },400);
})();
