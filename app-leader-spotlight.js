// Daily/weekly leader spotlight: top 2 reps only (crown + closest
// competitor), reusing the same authoritative sale-eligibility and Pacific
// day/week boundaries as the main rankings, via a dedicated RPC
// (my_daily_weekly_leader_spotlight) with its own "reached it first, sticky
// until strictly overtaken" tie-break rule for the crown specifically.
(()=>{
  if(window.MCCOY_LEADER_SPOTLIGHT)return;
  window.MCCOY_LEADER_SPOTLIGHT=true;

  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

  function emojiForCount(count){
    let n=Math.max(0,Math.floor(Number(count)||0));
    const banks=Math.floor(n/20);n-=banks*20;
    const bags=Math.floor(n/5);n-=bags*5;
    return '🏦'.repeat(banks)+'💰'.repeat(bags)+'<span class="leader-spotlight-dollar">$</span>'.repeat(n);
  }

  function periodMarkup(label,period){
    const total=Number(period?.total||0);
    if(!total)return `<div class="leader-spotlight-period"><strong>${label} total:</strong> NO SALES YET</div>`;
    const lines=[];
    if(period.leader)lines.push(`<div>👑${esc(period.leader.name)}: ${emojiForCount(period.leader.count)}</div>`);
    if(period.runner_up)lines.push(`<div>${esc(period.runner_up.name)}: ${emojiForCount(period.runner_up.count)}</div>`);
    return `<div class="leader-spotlight-period"><strong>${label} total: ${emojiForCount(total)}(${total})</strong>${lines.join('')}</div>`;
  }

  function render(container,data){
    if(!container)return;
    if(!data?.ok){container.innerHTML='<div class="leader-spotlight-period muted">Leaderboard unavailable</div>';return;}
    container.innerHTML=periodMarkup('Weekly',data.week)+periodMarkup('Daily',data.today)+
      '<div class="leader-spotlight-key">Key: Top rep 👑 · 20 🏦 · 5 💰 · 1 <span class="leader-spotlight-dollar">$</span></div>';
  }

  const style=document.createElement('style');
  style.textContent=`
    #leaderSpotlightDashboard{position:absolute;top:14px;right:14px;z-index:40;width:min(260px,40vw);padding:14px 16px;border-radius:14px;background:#ffffff;border:1px solid #e5e7eb;box-shadow:0 6px 20px rgba(15,23,42,.1);font-size:15px}
    #leaderSpotlightDashboard .leader-spotlight-period{margin-bottom:10px}
    #leaderSpotlightDashboard .leader-spotlight-period:last-of-type{margin-bottom:6px}
    #leaderSpotlightDashboard .leader-spotlight-period strong{display:block;margin-bottom:3px;font-size:15px}
    #leaderSpotlightDashboard .leader-spotlight-key{font-size:11px;color:#6b7280;border-top:1px solid #f1f5f9;padding-top:6px}
    .leader-spotlight-dollar{color:#15803d;font-weight:800}
    #dashboard{position:relative}
    #leaderSpotlightField{position:sticky;top:8px;z-index:900;margin:0 0 10px;padding:9px 12px;border-radius:12px;background:#ffffff;border:1px solid #e5e7eb;box-shadow:0 4px 14px rgba(15,23,42,.12);font-size:12px;max-width:min(220px,60vw);pointer-events:none}
    #leaderSpotlightField *{pointer-events:none}
    #leaderSpotlightField .leader-spotlight-period{margin-bottom:5px}
    #leaderSpotlightField .leader-spotlight-period:last-of-type{margin-bottom:3px}
    #leaderSpotlightField .leader-spotlight-period strong{display:block;font-size:12px}
    #leaderSpotlightField .leader-spotlight-key{font-size:9px;color:#6b7280}
    @media(max-width:640px){#leaderSpotlightDashboard{position:static;width:auto;margin-bottom:12px}}
  `;
  document.head.appendChild(style);

  function ensureContainers(){
    const dashboard=document.getElementById('dashboard');
    if(dashboard&&!document.getElementById('leaderSpotlightDashboard')){
      const box=document.createElement('div');box.id='leaderSpotlightDashboard';
      dashboard.insertBefore(box,dashboard.firstChild);
    }
    const field=document.getElementById('field');
    if(field&&!document.getElementById('leaderSpotlightField')){
      const box=document.createElement('div');box.id='leaderSpotlightField';
      field.insertBefore(box,field.firstChild);
    }
  }

  let lastData=null;
  async function load(){
    try{
      const {data,error}=await sb.rpc('my_daily_weekly_leader_spotlight');
      if(error)throw error;
      lastData=data;
    }catch(error){
      console.error('Leader spotlight load failed',error);
      lastData=null;
    }
    ensureContainers();
    render(document.getElementById('leaderSpotlightDashboard'),lastData);
    render(document.getElementById('leaderSpotlightField'),lastData);
  }

  window.MCCOY_REFRESH_LEADER_SPOTLIGHT=load;
  window.addEventListener('mccoy-access-ready',()=>{ensureContainers();load();});
  window.addEventListener('mccoy-sale-saved',()=>load());
  window.addEventListener('mccoy-real-leads-loaded',()=>{ensureContainers();if(!lastData)load();});
  setInterval(load,60000);
})();
