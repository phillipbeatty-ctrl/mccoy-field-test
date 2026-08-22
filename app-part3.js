// V9 thin Admin/Manager analytics viewer.
// No scoring, learning, proximity, compensation, or coaching formulas are shipped to the browser.
(function(){
  function fmtMs(ms){if(ms==null)return '—';const s=Math.round(ms/1000),m=Math.floor(s/60);return m?`${m}m ${s%60}s`:`${s}s`;}
  function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  async function loadServerAnalytics(){
    const access=window.MCCOY_ACCESS?.access;if(!access||!['admin','manager','trainer'].includes(access.role))return;
    const host=document.getElementById('efficiencySummary');if(host)host.innerHTML='<p class="muted">Loading secure server analytics…</p>';
    const {data,error}=await sb.functions.invoke('field-analytics',{body:{}});
    if(error||!data?.summary){if(host)host.innerHTML='<p class="muted">Server analytics unavailable for this session.</p>';console.error(error);return;}
    const s=data.summary,m=s.movement||{},c=s.compensation||{};
    if(!host)return;
    host.innerHTML=`<h2>Secure Server Analytics</h2>
      <div class="efficiency-grid">
        <div><span>Doors</span><strong>${s.counts?.doors??0}</strong></div>
        <div><span>Sales</span><strong>${s.counts?.sales??0}</strong></div>
        <div><span>Avg Walking</span><strong>${m.avgWalkingMps==null?'—':(m.avgWalkingMps*2.23694).toFixed(1)+' mph'}</strong></div>
        <div><span>Tracked Distance</span><strong>${m.totalWalkDistanceMeters==null?'—':Math.round(m.totalWalkDistanceMeters)+' m'}</strong></div>
        <div><span>Stops</span><strong>${m.stopCount??0}</strong></div>
        <div><span>Off-Route Idle</span><strong>${fmtMs(m.offRouteIdleMs)}</strong></div>
        <div><span>Long Off-Route Blocks</span><strong>${m.longOffRouteStopCount??0}</strong></div>
        <div><span>Estimated Compensation</span><strong>$${Number(c.estimatedGross||0).toFixed(2)}</strong></div>
      </div>
      <h3>Coaching Review</h3><ul>${(s.coaching||[]).map(x=>`<li>${esc(x)}</li>`).join('')}</ul>
      <p class="muted small">Engine ${esc(s.engineVersion)}. Proprietary formulas execute only in Supabase Edge Functions.</p>`;
  }
  window.loadServerAnalytics=loadServerAnalytics;
  const poll=setInterval(()=>{const access=window.MCCOY_ACCESS?.access;if(access){clearInterval(poll);if(['admin','manager','trainer'].includes(access.role)){const host=document.getElementById('efficiencySummary');if(host){const b=document.createElement('button');b.className='assign-btn';b.textContent='REFRESH SERVER ANALYTICS';b.onclick=loadServerAnalytics;host.after(b);}loadServerAnalytics();}}},500);
})();
