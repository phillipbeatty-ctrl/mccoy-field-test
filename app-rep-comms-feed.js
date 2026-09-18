// Rep comms falling-message overlay: GroupMe-style free text, broadcast in
// real time to every active user, on every page, via a physically-consistent
// falling/fading animation -- not persisted on screen, deliberately separate
// from Live Wins (which continues to own the sales_feed celebration popup
// alone; no user message is ever mixed into it).
//
// DISPLAY timing is deferred (see app-deferred-message-queue.js): a message
// that arrives while the tab is backgrounded, or while the app is fully
// closed, is held and delivered once the rep actually returns, throttled
// (see BACKLOG_THROTTLE_MS below) so each one still gets its own falling
// animation on catch-up rather than all landing on the overflow banner at
// once. Realtime delivery itself is unaffected -- only on-screen display.
//
// Physics: falls exactly 2 real inches using the CSS `in` unit (so the
// duration is the same on a 13" tablet and a phone turned sideways -- a
// fixed pixel distance would cover very different fractions of each), with
// opacity 100% at 0", 50% at 1", 0% at 2" -- a linear fade tied to distance
// fallen, which a linear timing function makes equivalent to a linear fade
// over time since speed is constant throughout the fall.
//
// Rate limiting is display-side, not send-side (the database function
// separately rate-limits sending): at most 3 messages fall at once, in 3
// fixed lanes so they never visually overlap. A 4th+ incoming message while
// all 3 lanes are occupied does not queue for later display -- it is
// absorbed into a persistent "Multiple Messages Incoming" banner instead,
// since queuing an unbounded backlog would eventually flood the screen
// during a burst of activity. Nothing is lost from this -- every message
// still lands in the database for the COMMS page to browse regardless of
// whether it got a falling animation.
(()=>{
  if(window.MCCOY_REP_COMMS_FEED)return;
  window.MCCOY_REP_COMMS_FEED=true;

  const FALL_DURATION_MS=5000;
  const LANES=3;
  const BACKLOG_THROTTLE_MS=1800; // Roughly how often a lane frees up at 3 lanes / 5s fall -- keeps catch-up from dumping everything into the overflow banner.

  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

  const style=document.createElement('style');
  style.textContent=`
    #repCommsFallLayer{position:fixed;inset:0;z-index:200000;pointer-events:none;overflow:hidden}
    .rep-comms-falling{position:absolute;top:0;width:min(30vw,260px);padding:9px 12px;border-radius:12px;background:#111827;color:#fff;font-size:13px;line-height:1.35;box-shadow:0 6px 18px rgba(0,0,0,.28);animation:repCommsFall ${FALL_DURATION_MS}ms linear forwards}
    .rep-comms-falling strong{display:block;font-size:10px;font-weight:800;color:#93c5fd;margin-bottom:2px;text-transform:uppercase;letter-spacing:.02em}
    .rep-comms-falling[data-lane="0"]{left:4vw}
    .rep-comms-falling[data-lane="1"]{left:calc(50% - min(15vw,130px))}
    .rep-comms-falling[data-lane="2"]{right:4vw}
    @keyframes repCommsFall{0%{top:0in;opacity:1}50%{top:1in;opacity:.5}100%{top:2in;opacity:0}}
    #repCommsOverflowBanner{position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:200001;background:#92400e;color:#fff;font-size:12px;font-weight:800;padding:8px 16px;border-radius:999px;box-shadow:0 4px 14px rgba(0,0,0,.25);display:none}
    #repCommsOverflowBanner.show{display:block}
    @media(prefers-reduced-motion:reduce){.rep-comms-falling{animation-name:repCommsFallReducedMotion}}
    @keyframes repCommsFallReducedMotion{0%{top:0in;opacity:1}70%{top:0in;opacity:1}100%{top:0in;opacity:0}}
  `;
  document.head.appendChild(style);

  const layer=document.createElement('div');layer.id='repCommsFallLayer';document.body.appendChild(layer);
  const banner=document.createElement('div');banner.id='repCommsOverflowBanner';banner.textContent='Multiple Messages Incoming';document.body.appendChild(banner);

  const occupiedLanes=new Set();
  const deliveredIds=new Set(); // guards against catch-up and realtime racing on the same message at startup
  let overflowHideTimer=null;

  function freeLane(){
    for(let lane=0;lane<LANES;lane++)if(!occupiedLanes.has(lane))return lane;
    return null;
  }

  function showOverflowBanner(){
    banner.classList.add('show');
    clearTimeout(overflowHideTimer);
    overflowHideTimer=setTimeout(()=>banner.classList.remove('show'),4000);
  }

  function dropMessage(row){
    if(row?.id!=null){
      if(deliveredIds.has(row.id))return;
      deliveredIds.add(row.id);
    }
    const lane=freeLane();
    if(lane===null){showOverflowBanner();return;}
    occupiedLanes.add(lane);
    const el=document.createElement('div');
    el.className='rep-comms-falling';
    el.dataset.lane=String(lane);
    el.innerHTML=`<strong>${esc(row.sender_name||'Rep')}</strong>${esc(row.message||'')}`;
    layer.appendChild(el);
    setTimeout(()=>{el.remove();occupiedLanes.delete(lane);},FALL_DURATION_MS+150);
  }

  async function checkMissedComms(since){
    try{
      const {data,error}=await sb.rpc('list_recent_rep_comms_messages',{p_limit:50});
      if(error)throw error;
      const rows=(data||[]).filter(row=>!since||new Date(row.created_at)>new Date(since));
      rows.sort((a,b)=>new Date(a.created_at)-new Date(b.created_at)); // RPC returns newest-first; play oldest-first on catch-up.
      return rows;
    }catch(error){console.error('Rep comms catch-up query failed',error);return [];}
  }

  let channel=null,statusChecked=false;
  async function start(){
    if(channel||statusChecked||!window.MCCOY_ACCESS?.access?.active)return;
    statusChecked=true;
    try{
      const {data,error}=await sb.rpc('get_rep_comms_status');
      if(error)throw error;
      if(!data?.enabled)return;
    }catch(error){
      console.error('Rep comms status check failed',error);
      return;
    }
    window.MCCOY_DEFERRED_QUEUE?.registerSource('rep_comms',{
      getTimestamp:row=>row.created_at,
      deliver:async row=>{dropMessage(row);},
      checkMissed:checkMissedComms,
      throttleMs:BACKLOG_THROTTLE_MS,
    });
    channel=sb.channel('mccoy-rep-comms')
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'rep_comms_messages'},payload=>{
        if(payload?.new)window.MCCOY_DEFERRED_QUEUE?.enqueue('rep_comms',payload.new);
      })
      .subscribe();
  }
  window.addEventListener('beforeunload',()=>{if(channel)sb.removeChannel(channel);});
  window.addEventListener('mccoy-access-ready',start);
  const poll=setInterval(()=>{if(window.MCCOY_ACCESS?.access){clearInterval(poll);start();}},300);
  start();
})();
