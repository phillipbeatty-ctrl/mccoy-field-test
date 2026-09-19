(function(){
  const style=document.createElement('style');
  style.textContent=`
    #metricsVisibilityBtn{border:0;border-radius:999px;padding:9px 13px;background:#111827;color:#fff;font-size:12px;cursor:pointer;display:none}
    #metricsVisibilityPanel{position:fixed;inset:0;z-index:130000;background:rgba(17,24,39,.78);display:none;align-items:center;justify-content:center;padding:16px}
    #metricsVisibilityPanel.show{display:flex}.metrics-card{width:min(760px,100%);max-height:92vh;overflow:auto;background:#fff;border-radius:16px;padding:20px}.metrics-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid #eef0f2}.metrics-muted{font-size:12px;color:#6b7280}.metrics-actions{display:flex;justify-content:flex-end;margin-top:14px}
  `;
  document.head.appendChild(style);

  const visibilityBtn=document.createElement('button');visibilityBtn.id='metricsVisibilityBtn';visibilityBtn.textContent='Metric Visibility';
  const teamsCardHead=document.querySelector('#teams .card-head');
  if(teamsCardHead)teamsCardHead.appendChild(visibilityBtn);else document.body.appendChild(visibilityBtn);
  const visibilityPanel=document.createElement('div');visibilityPanel.id='metricsVisibilityPanel';visibilityPanel.innerHTML='<div class="metrics-card"><h2>Metric Visibility</h2><div class="metrics-muted">Admin controls who can see coaching metrics. Admin always retains access.</div><div id="metricsVisibilityContent" style="margin-top:12px">Loading…</div><div class="metrics-actions"><button id="metricsVisibilityClose" class="assign-btn">Close</button></div></div>';document.body.appendChild(visibilityPanel);
  document.getElementById('metricsVisibilityClose').onclick=()=>visibilityPanel.classList.remove('show');

  async function authFetch(method='GET',body=null){
    const {data:{session}}=await sb.auth.getSession();if(!session)throw new Error('not_signed_in');
    const r=await fetch(SUPABASE_URL+'/functions/v1/metrics-visibility',{method,headers:{Authorization:'Bearer '+session.access_token,apikey:SUPABASE_PUBLISHABLE_KEY,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
    const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'request_failed');return d;
  }

  async function loadVisibilityPanel(){
    const root=document.getElementById('metricsVisibilityContent');root.textContent='Loading…';
    try{
      const d=await authFetch();const g=d.global||{};
      root.innerHTML=`
        <div class="metrics-row"><div><strong>All reps can view their own metrics</strong><div class="metrics-muted">Individual rep switch must also be enabled.</div></div><input id="globalRepMetrics" type="checkbox" ${g.global_rep_metrics_enabled?'checked':''}></div>
        <div class="metrics-row"><div><strong>Managers and Trainers can view assigned reps</strong><div class="metrics-muted">Only reps actually assigned to that Manager or Trainer are accessible.</div></div><input id="globalManagerMetrics" type="checkbox" ${g.global_manager_metrics_enabled?'checked':''}></div>
        <div style="margin-top:14px"><strong>Per Rep</strong><div id="repMetricRows"></div></div>`;
      const rows=document.getElementById('repMetricRows');
      rows.innerHTML=(d.reps||[]).map((r,i)=>`<div class="metrics-row"><div><strong>${r.display_name||r.email}</strong><div class="metrics-muted">${r.email}${r.assigned_manager_name||r.assigned_manager_email?' · Manager: '+(r.assigned_manager_name||r.assigned_manager_email):' · No manager assigned'}</div></div><div><label class="metrics-muted">Rep <input id="repSelf${i}" type="checkbox" ${r.visibility?.rep_metrics_enabled?'checked':''}></label> &nbsp; <label class="metrics-muted">Manager <input id="repMgr${i}" type="checkbox" ${r.visibility?.manager_metrics_enabled!==false?'checked':''}></label></div></div>`).join('')||'<div class="metrics-muted">No non-admin users configured yet.</div>';
      document.getElementById('globalRepMetrics').onchange=async()=>{await saveGlobal();};
      document.getElementById('globalManagerMetrics').onchange=async()=>{await saveGlobal();};
      async function saveGlobal(){await authFetch('POST',{action:'set_global',rep_enabled:document.getElementById('globalRepMetrics').checked,manager_enabled:document.getElementById('globalManagerMetrics').checked});}
      (d.reps||[]).forEach((r,i)=>{
        const save=async()=>{await authFetch('POST',{action:'set_rep',rep_email:r.email,rep_metrics_enabled:document.getElementById('repSelf'+i).checked,manager_metrics_enabled:document.getElementById('repMgr'+i).checked});};
        document.getElementById('repSelf'+i).onchange=save;document.getElementById('repMgr'+i).onchange=save;
      });
    }catch(e){console.error(e);root.textContent='Unable to load metric visibility controls.';}
  }

  visibilityBtn.onclick=async()=>{visibilityPanel.classList.add('show');await loadVisibilityPanel();};

  async function load(){
    const card=document.getElementById('coachMetrics'),b=document.getElementById('coachMetricsBody');if(!card||!b)return;
    try{
      b.textContent='Loading latest field data…';
      const body={};
      const {data,error}=await sb.functions.invoke('rep-coach-summary',{body});
      if(error)throw error;
      card.style.display='block';
      if(!data?.ok||!data.summary){b.textContent='No completed field session yet.';return;}
      const m=data.summary;
      const rows=[['Rep',m.tester_name||m.tester_email||'—'],['Doors',m.doors??'—'],['Contacts',m.contacts??'—'],['Sales',m.sales??'—'],['Not Home avg',m.dwell?.not_home_ms!=null?(m.dwell.not_home_ms/1000).toFixed(1)+' sec':'—'],['Sale avg',m.dwell?.sale_ms!=null?(m.dwell.sale_ms/1000).toFixed(1)+' sec':'—'],['Average transition',m.transition?.average_ms!=null?(m.transition.average_ms/1000).toFixed(1)+' sec':'—'],['GPS accuracy',m.gps?.average_accuracy_m!=null?'±'+m.gps.average_accuracy_m.toFixed(1)+' m':'—'],['Tracked distance',m.movement?.distance_m!=null?m.movement.distance_m.toFixed(1)+' m':'—'],['Moving time',m.movement?.moving_ms!=null?Math.round(m.movement.moving_ms/1000)+' sec':'—'],['Auto-stop',m.auto_stop?.reason||'None'],['Session',m.session_id||'Latest']];
      b.innerHTML='<div class="mini-stats" style="grid-template-columns:repeat(3,1fr)">'+rows.map(r=>'<div><span>'+r[0]+'</span><strong>'+r[1]+'</strong></div>').join('')+'</div>';
    }catch(e){
      const msg=String(e?.message||e||'');
      if(msg.includes('metrics_hidden')||msg.includes('403')){card.style.display='none';b.replaceChildren();}
      else {console.error(e);card.style.display='none';}
    }
  }

  document.getElementById('coachRefreshBtn')?.addEventListener('click',load);
  const t=setInterval(()=>{
    const access=window.MCCOY_ACCESS?.access;if(!access)return;
    clearInterval(t);
    if(access.role==='admin')visibilityBtn.style.display='block';
    load();
  },400);
})();
