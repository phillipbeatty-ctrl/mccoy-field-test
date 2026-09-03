// One authenticated Realtime subscription drives rankings, verified-sale Live Feed events, and sale celebrations.
(()=>{
  let channel=null,started=false,running=false;
  const queue=[];
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
  async function drain(){
    if(running)return;running=true;
    while(queue.length){
      const row=queue.shift(),items=messages(row);if(!items.length)continue;
      for(const message of items){
        overlay.querySelector('.live-win-message').textContent=message;spray();overlay.classList.add('show');
        await wait(2600);overlay.classList.remove('show');await wait(260);
      }
    }
    running=false;
  }
  function celebrate(row){
    if(!row?.animation_enabled||!Number(row.celebration_version||0))return;
    const key=seenKey(row);if(wasSeen(key))return;markSeen(key);queue.push(row);drain();
  }
  function changed(payload){
    const row=payload?.new||null;
    window.dispatchEvent(new CustomEvent('mccoy-live-sales-changed',{detail:{eventType:payload?.eventType||null,row}}));
    if(payload?.eventType==='INSERT'||payload?.eventType==='UPDATE')celebrate(row);
  }
  function start(){
    if(started||!window.MCCOY_ACCESS?.access?.active)return;started=true;
    channel=sb.channel('mccoy-live-sales-authority')
      .on('postgres_changes',{event:'*',schema:'public',table:'sales_feed'},changed)
      .subscribe(status=>window.dispatchEvent(new CustomEvent('mccoy-live-sales-status',{detail:{status}})));
  }
  window.addEventListener('mccoy-access-ready',start);
  const poll=setInterval(()=>{if(window.MCCOY_ACCESS?.access){clearInterval(poll);start()}},300);
  window.addEventListener('beforeunload',()=>{if(channel)sb.removeChannel(channel)});
})();

// Preview branch only: load the mixed sale-and-comment Live Feed after the
// verified-sale celebration authority is installed, so sales retain priority.
(()=>{
  if(document.querySelector('script[data-mccoy-live-feed-preview]'))return;
  const script=document.createElement('script');
  script.src='app-live-feed.js?v=2026090302';
  script.dataset.mccoyLiveFeedPreview='1';
  document.head.appendChild(script);
})();
