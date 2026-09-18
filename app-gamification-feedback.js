// Visual feedback layer covering two related gamification ideas at once:
// subtle ambient polish (animation gamification) and more overt score-pop/
// win-sequence feedback (arcade-style mini-games). Both are cosmetic only --
// no game logic, no separate reward loop, just feedback on real actions
// that already happened.
(function(){
  const style=document.createElement('style');style.textContent=`
    .mccoy-feedback-pop{position:fixed;pointer-events:none;z-index:9999;font-weight:900;font-size:20px;color:#7c3aed;animation:mccoyPopFloat 1.1s ease-out forwards}
    @keyframes mccoyPopFloat{0%{opacity:0;transform:translateY(0) scale(0.8)}15%{opacity:1;transform:translateY(-10px) scale(1.1)}100%{opacity:0;transform:translateY(-60px) scale(1)}}
    .mccoy-celebration{position:fixed;inset:0;pointer-events:none;z-index:9998;display:flex;align-items:center;justify-content:center}
    .mccoy-celebration-burst{font-size:64px;animation:mccoyBurst 1.4s ease-out forwards}
    @keyframes mccoyBurst{0%{opacity:0;transform:scale(0.3) rotate(-15deg)}30%{opacity:1;transform:scale(1.3) rotate(5deg)}60%{transform:scale(1) rotate(0)}100%{opacity:0;transform:scale(1.1)}}
    .mccoy-confetti-piece{position:fixed;top:-20px;pointer-events:none;z-index:9997;font-size:18px;animation:mccoyConfettiFall linear forwards}
    @keyframes mccoyConfettiFall{to{transform:translateY(110vh) rotate(360deg);opacity:0.2}}
    .mccoy-badge-toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1f2937;color:#fff;padding:12px 20px;border-radius:12px;z-index:9999;display:flex;align-items:center;gap:10px;font-weight:700;animation:mccoyToastIn 0.3s ease-out, mccoyToastOut 0.4s ease-in 3.2s forwards}
    @keyframes mccoyToastIn{from{opacity:0;transform:translateX(-50%) translateY(20px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
    @keyframes mccoyToastOut{to{opacity:0;transform:translateX(-50%) translateY(20px)}}
  `;document.head.appendChild(style);

  function popScore(text){
    const el=document.createElement('div');el.className='mccoy-feedback-pop';el.textContent=text;
    el.style.left=(40+Math.random()*20)+'%';el.style.top='60%';
    document.body.appendChild(el);setTimeout(()=>el.remove(),1200);
  }

  function celebrate(emoji,confettiCount){
    const wrap=document.createElement('div');wrap.className='mccoy-celebration';
    wrap.innerHTML=`<div class="mccoy-celebration-burst">${emoji}</div>`;
    document.body.appendChild(wrap);setTimeout(()=>wrap.remove(),1500);
    const pieces=['\u{1F389}','\u2728','\u{1F38A}','\u{1F31F}'];
    for(let i=0;i<confettiCount;i++){
      const piece=document.createElement('div');piece.className='mccoy-confetti-piece';
      piece.textContent=pieces[Math.floor(Math.random()*pieces.length)];
      piece.style.left=Math.random()*100+'%';
      piece.style.animationDuration=(1.5+Math.random()*1)+'s';
      document.body.appendChild(piece);setTimeout(()=>piece.remove(),3000);
    }
  }

  function badgeToast(emoji,label){
    const toast=document.createElement('div');toast.className='mccoy-badge-toast';
    toast.innerHTML=`<span style="font-size:24px">${emoji}</span><span>Badge earned: ${label}</span>`;
    document.body.appendChild(toast);setTimeout(()=>toast.remove(),3700);
  }

  // Animation gamification: subtle pop on every door knock.
  window.addEventListener('mccoy-door-visit-completed',()=>popScore('+1'));
  // Arcade-style: bigger win sequence on a completed sale.
  window.addEventListener('mccoy-sale-saved',()=>celebrate('\u{1F3C6}',18));

  window.MCCOY_GAMIFICATION_FEEDBACK={popScore,celebrate,badgeToast};
})();
