(()=>{
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  let running=false;

  async function waitForAdmin(timeoutMs=15000){
    const start=Date.now();
    while(Date.now()-start<timeoutMs){
      const access=window.MCCOY_ACCESS?.access;
      if(access?.active&&access?.role==='admin')return true;
      await sleep(250);
    }
    return false;
  }

  function ensureProgressUi(){
    const box=document.getElementById('geocodeProgress');
    if(!box)return null;
    if(!document.getElementById('geocodeProgressBar')){
      box.insertAdjacentHTML('beforebegin',`<div id="geocodeProgressWrap" style="margin:8px 0"><div style="height:10px;background:#e5e7eb;border-radius:999px;overflow:hidden"><div id="geocodeProgressBar" style="height:100%;width:0%;background:#111827;transition:width .2s ease"></div></div><div id="geocodeProgressPct" class="muted small" style="margin-top:4px">0%</div></div>`);
    }
    return box;
  }

  function showProgress(data,prefix=''){
    const box=ensureProgressUi();if(!box)return;
    const total=Number(data?.total||0),attempted=Number(data?.attempted||0),mapped=Number(data?.geocoded||0),unmatched=Number(data?.unmatched||0),remaining=Number(data?.remaining||0);
    const pct=total?Math.min(100,(attempted/total)*100):0;
    const bar=document.getElementById('geocodeProgressBar'),pctEl=document.getElementById('geocodeProgressPct');
    if(bar)bar.style.width=pct.toFixed(1)+'%';
    if(pctEl)pctEl.textContent=`${attempted.toLocaleString()} / ${total.toLocaleString()} processed (${pct.toFixed(1)}%)`;
    box.textContent=`${prefix}${prefix?' ':''}Mapped ${mapped.toLocaleString()} · unmatched ${unmatched.toLocaleString()} · ${remaining.toLocaleString()} remaining.`;
  }

  async function getStatus(){
    const {data,error}=await sb.functions.invoke('lead-geocode',{body:{action:'status'}});
    if(error||!data?.ok)throw error||new Error(data?.error||'geocode_status_failed');
    showProgress(data);
    return data;
  }

  async function invokeBatch(limit=500){
    let lastErr=null;
    for(let attempt=1;attempt<=4;attempt++){
      try{
        const {data,error}=await sb.functions.invoke('lead-geocode',{body:{action:'geocode_next',limit}});
        if(error||!data?.ok)throw error||new Error(data?.error||'geocode_failed');
        return data;
      }catch(e){
        lastErr=e;
        if(attempt<4)await sleep(1500*attempt);
      }
    }
    throw lastErr||new Error('geocode_failed');
  }

  async function resumeGeocoding(){
    if(running)return;
    const admin=await waitForAdmin();
    const btn=document.getElementById('geocodeRealLeadsBtn');
    if(!admin){if(btn)btn.disabled=true;return;}
    running=true;
    if(btn){btn.disabled=true;btn.style.display='';btn.textContent='RESUMING GEOCODING…';}
    try{
      let status=await getStatus();
      if(Number(status.remaining||0)<=0){showProgress(status,'Complete.');return;}
      showProgress(status,'Resuming from saved progress.');

      let guard=0;
      while(Number(status.remaining||0)>0&&guard++<30){
        const before=Number(status.remaining||0);
        const limit=Math.min(500,before);
        const batch=await invokeBatch(limit);
        showProgress(batch,'Geocoding…');
        status=await getStatus();
        const after=Number(status.remaining||0);
        if(after>=before){
          await sleep(2000);
          const check=await getStatus();
          if(Number(check.remaining||0)>=before)throw new Error('No geocoding progress detected; stopped safely so it can be resumed.');
          status=check;
        }
        await sleep(350);
      }

      status=await getStatus();
      if(Number(status.remaining||0)===0){
        showProgress(status,'Geocoding complete.');
        await window.loadMcCoyLeads?.();
        setTimeout(()=>window.MCCOY_RENDER_LEAD_MAP?.(true),300);
      }else{
        showProgress(status,'Paused safely; press Resume to continue.');
      }
    }catch(e){
      console.error('Geocode resume failed',e);
      const box=ensureProgressUi();
      if(box)box.textContent=`Geocoding paused: ${e?.message||String(e)} Press RESUME GEOCODING to continue from saved progress.`;
    }finally{
      running=false;
      if(btn){btn.disabled=false;btn.textContent='RESUME GEOCODING';}
    }
  }

  async function wire(){
    for(let i=0;i<60;i++){
      const btn=document.getElementById('geocodeRealLeadsBtn');
      if(btn){
        const admin=await waitForAdmin();
        if(admin){btn.style.display='';btn.disabled=false;btn.textContent='RESUME GEOCODING';btn.onclick=resumeGeocoding;try{const s=await getStatus();if(Number(s.remaining||0)===0)btn.textContent='GEOCODING COMPLETE';}catch{}}
        return;
      }
      await sleep(250);
    }
  }

  window.MCCOY_RESUME_GEOCODING=resumeGeocoding;
  window.addEventListener('mccoy-real-leads-loaded',()=>setTimeout(wire,100));
  setTimeout(wire,800);
})();