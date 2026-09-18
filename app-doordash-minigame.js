// Standalone mini-game (gamification idea 17): a quick, opt-in, work-themed
// timing game. Uses emojis that mirror the real job (doors, houses, a
// handshake for a "sale") rather than a fully disconnected game, per the
// owner's specific refinement -- keeps it thematically tied to the work
// even though it isn't functional. Entirely separate from the core
// workflow: reps opt in by pressing Play, nothing about this earns real
// points or affects any real record.
(function(){
  const byId=id=>document.getElementById(id);
  let running=false,score=0,timeLeft=30,spawnTimer=null,countdownTimer=null,highScore=Number(localStorage.getItem('mccoyDoorDashHighScore')||0);

  const style=document.createElement('style');style.textContent=`
    .doordash-card{margin-top:14px}
    .doordash-play-area{position:relative;height:220px;background:linear-gradient(#dbeafe,#eff6ff);border-radius:12px;overflow:hidden;border:1px solid #bfdbfe}
    .doordash-target{position:absolute;font-size:32px;cursor:pointer;background:none;border:none;user-select:none;animation:doordashPop 0.2s ease-out}
    @keyframes doordashPop{from{transform:scale(0)}to{transform:scale(1)}}
    .doordash-hud{display:flex;justify-content:space-between;margin-bottom:8px;font-weight:800}
    .doordash-start-btn{background:#7c3aed;color:#fff;border:0;border-radius:8px;padding:10px 20px;font-weight:800;cursor:pointer;margin-top:10px}
    .doordash-result{text-align:center;padding:20px;font-size:18px;font-weight:800}
  `;document.head.appendChild(style);

  function ensure(){
    if(byId('doordashCard'))return;
    const anchor=byId('gamifyCard')||document.querySelector('#field .card:last-of-type');if(!anchor)return;
    const card=document.createElement('div');card.id='doordashCard';card.className='card doordash-card';
    card.innerHTML=`<div class="card-head"><div><h2>DOOR DASH</h2><p class="muted small">A quick break, not part of the job -- tap the open doors, grab the handshake, avoid the closed doors.</p></div></div>
      <div id="doordashBody"><div style="text-align:center"><button class="doordash-start-btn" id="doordashStart">Play (30s)</button><div class="muted small" style="margin-top:8px">High score: <span id="doordashHigh">${highScore}</span></div></div></div>`;
    anchor.insertAdjacentElement('afterend',card);
    byId('doordashStart').onclick=startGame;
  }

  function startGame(){
    if(running)return;running=true;score=0;timeLeft=30;
    const body=byId('doordashBody');
    body.innerHTML=`<div class="doordash-hud"><span>Score: <span id="doordashScore">0</span></span><span>Time: <span id="doordashTime">30</span>s</span></div><div class="doordash-play-area" id="doordashArea"></div>`;
    spawnTimer=setInterval(spawnTarget,700);
    countdownTimer=setInterval(()=>{
      timeLeft--;byId('doordashTime').textContent=timeLeft;
      if(timeLeft<=0)endGame();
    },1000);
  }

  function spawnTarget(){
    const area=byId('doordashArea');if(!area)return;
    const roll=Math.random();
    let emoji='\u{1F6AA}',points=1; // door
    if(roll>0.85){emoji='\u{1F91D}';points=5;} // handshake, rare, bonus
    else if(roll>0.65){emoji='\u{1F6AB}';points=-2;} // closed, avoid
    const btn=document.createElement('button');btn.className='doordash-target';btn.textContent=emoji;
    btn.style.left=(Math.random()*85)+'%';btn.style.top=(Math.random()*75)+'%';
    btn.onclick=()=>{score=Math.max(0,score+points);byId('doordashScore').textContent=score;window.MCCOY_GAMIFICATION_FEEDBACK?.popScore(points>0?`+${points}`:String(points));btn.remove();};
    area.appendChild(btn);
    setTimeout(()=>btn.remove(),1400);
  }

  function endGame(){
    running=false;clearInterval(spawnTimer);clearInterval(countdownTimer);
    if(score>highScore){highScore=score;localStorage.setItem('mccoyDoorDashHighScore',String(highScore));}
    const body=byId('doordashBody');
    body.innerHTML=`<div class="doordash-result">Round over -- ${score} points!<br><span class="muted small" style="font-weight:400">High score: ${highScore}</span></div><div style="text-align:center"><button class="doordash-start-btn" id="doordashStart">Play Again</button></div>`;
    byId('doordashStart').onclick=startGame;
  }

  document.addEventListener('DOMContentLoaded',ensure);
  if(document.readyState!=='loading')ensure();
})();
