// One authenticated Realtime subscription drives rankings, Live Wins, and sale celebrations.
// Celebration DISPLAY timing is deferred: see app-deferred-message-queue.js.
// Realtime delivery still arrives instantly in the background; only the
// on-screen full-bleed overlay is held until the page is actually visible,
// so a backgrounded tab or a closed-then-reopened app never pops a
// celebration nobody was there to see, and nothing is lost catching up.
(()=>{
  let channel=null;
  const style=document.createElement('style');
  style.textContent=`
    #liveWinCelebration{position:fixed;inset:0;z-index:190000;display:none;pointer-events:none;align-items:center;justify-content:center;padding:22px;background:rgba(15,23,42,.2)}
    #liveWinCelebration.show{display:flex}.live-win-banner{position:relative;width:min(720px,92vw);padding:26px 30px;border:2px solid rgba(255,255,255,.8);border-radius:22px;background:linear-gradient(135deg,#111827,#1d4ed8 58%,#7c3aed);box-shadow:0 24px 70px rgba(15,23,42,.38);color:#fff;text-align:center;animation:liveWinPop .45s cubic-bezier(.2,.9,.25,1.25)}
    .live-win-kicker{font-size:12px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#fde68a}.live-win-message{display:block;margin-top:10px;font-size:clamp(20px,4vw,34px);line-height:1.18}
    .live-win-confetti{position:absolute;inset:0;overflow:hidden}.live-win-confetti span{position:absolute;left:50%;top:50%;font-size:var(--size);animation:liveWinSpray var(--duration) cubic-bezier(.12,.72,.25,1) forwards;animation-delay:var(--delay)}
    @keyframes liveWinPop{from{opacity:0;transform:scale(.78) translateY(18px)}to{opacity:1;transform:scale(1) translateY(0)}}
    @keyframes liveWinSpray{0%{opacity:0;transform:translate(-50%,-50%) scale(.35) rotate(0)}12%{opacity:1}100%{opacity:0;transform:translate(calc(-50% + var(--x)),calc(-50% + var(--y))) scale(1.15) rotate(var(--spin))}}
    @media(prefers-reduced-motion:reduce){.live-win-banner{animation:none}.live-win-confetti{display:none}}
  `;
  document.head.appendChild(style);

  const overlay=document.createElement('div');overlay.id='liveWinCelebration';overlay.setAttribute('role','status');overlay.setAttribute('aria-live','assertive');
  overlay.innerHTML='<div class="live-win-banner"><div class="live-win-confetti" aria-hidden="true"></div><div class="live-win-kicker">McCoy Live Win</div><strong class="live-win-message"></strong></div>';
  document.body.appendChild(overlay);

  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  function seenKey(row){return `mccoy-live-win:${row.id}:${Number(row.celebration_version||0)}`}
  function wasSeen(key){try{return sessionStorage.getItem(key)==='1'}catch{return false}}
  function markSeen(key){try{sessionStorage.setItem(key,'1')}catch{}}
  function messages(row){return Array.isArray(row?.celebration_messages)&&row.celebration_messages.length?row.celebration_messages.filter(x=>typeof x==='string'&&x.trim()):row?.message?[row.message]:[]}
  function spray(){
    const root=overlay.querySelector('.live-win-confetti');root.replaceChildren();
    const emoji=['🎉','✨','🏆','🔥','🚀','💰','⭐','🥳'];
    for(let index=0;index<58;index++){
      const particle=document.createElement('span');particle.textContent=emoji[index%emoji.length];
      const angle=Math.random()*Math.PI*2,distance=130+Math.random()*390;
      particle.style.setProperty('--x',Math.cos(angle)*distance+'px');
      particle.style.setProperty('--y',Math.sin(angle)*distance+'px');
      particle.style.setProperty('--spin',(Math.random()*900-450)+'deg');
      particle.style.setProperty('--size',(13+Math.random()*18)+'px');
      particle.style.setProperty('--duration',(1.1+Math.random()*.9)+'s');
      particle.style.setProperty('--delay',(Math.random()*.18)+'s');root.appendChild(particle);
    }
  }
  async function playOne(row){
    const key=seenKey(row);if(wasSeen(key))return;markSeen(key);
    for(const message of messages(row)){
      overlay.querySelector('.live-win-message').textContent=message;spray();overlay.classList.add('show');
      await wait(2600);overlay.classList.remove('show');await wait(260);
    }
  }
  function eligible(row){return !!row?.animation_enabled&&!!Number(row.celebration_version||0);}
  function celebrate(row){
    if(!eligible(row))return;
    window.MCCOY_DEFERRED_QUEUE?.enqueue('live_wins',row);
  }
  async function checkMissedSalesFeed(since){
    try{
      let query=sb.from('sales_feed').select('id,message,celebration_messages,celebration_version,animation_enabled,created_at').eq('animation_enabled',true).gt('celebration_version',0).order('created_at',{ascending:true}).limit(25);
      // No prior watermark on this device (first-ever launch here): only catch
      // up on the last hour, not this org's entire celebration history.
      query=query.gt('created_at',since||new Date(Date.now()-60*60*1000).toISOString());
      const {data,error}=await query;
      if(error)throw error;
      return data||[];
    }catch(error){console.error('Live Wins catch-up query failed',error);return [];}
  }
  function changed(payload){
    const row=payload?.new||null;
    window.dispatchEvent(new CustomEvent('mccoy-live-sales-changed',{detail:{eventType:payload?.eventType||null,row}}));
    if(payload?.eventType==='INSERT'||payload?.eventType==='UPDATE')celebrate(row);
  }
  let started=false;
  function start(){
    if(started||!window.MCCOY_ACCESS?.access?.active)return;started=true;
    window.MCCOY_DEFERRED_QUEUE?.registerSource('live_wins',{
      getTimestamp:row=>row.created_at,
      deliver:playOne,
      checkMissed:checkMissedSalesFeed,
      throttleMs:0, // playOne already awaits its own full display duration
    });
    channel=sb.channel('mccoy-live-sales-authority')
      .on('postgres_changes',{event:'*',schema:'public',table:'sales_feed'},changed)
      .subscribe(status=>window.dispatchEvent(new CustomEvent('mccoy-live-sales-status',{detail:{status}})));
  }
  window.addEventListener('mccoy-access-ready',start);
  const poll=setInterval(()=>{if(window.MCCOY_ACCESS?.access){clearInterval(poll);start()}},300);
  window.addEventListener('beforeunload',()=>{if(channel)sb.removeChannel(channel)});
})();
