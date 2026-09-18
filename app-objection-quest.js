// Objection Quest: the real, live-wired battle game. Replaces Door Dash.
// Every "monster" is a real objection from the Sales Coaching content bank
// (sales_coaching_objections) -- not a separate, parallel dataset. Every
// "attack" is the framework the content bank already tags as correct
// (feel_felt_found / laer). Victories flow through the existing points
// ledger (rep_points_ledger via the gamification edge function's existing
// award mechanism) -- no second currency, per the approved design. Level
// is derived from a dedicated victory count (game_battle_victories),
// unique per rep+objection so replaying an already-beaten encounter is
// free practice, not a way to farm points.
//
// Monster designs are original -- simple geometric SVG shapes invented for
// this game, deterministically assigned per objection so the same
// objection always shows the same creature, without needing a hand-built
// mapping that would miss any objection added to the content bank later.
(function(){
  const byId=id=>document.getElementById(id);
  let objections=[],encounterIndex=0,enemyHp=0,repHp=5,battling=false,gameStatus=null;

  const style=document.createElement('style');style.textContent=`
    .oq-card{margin-top:14px}
    .oq-stage{background:#1a1533; border:3px solid #453a7a; border-radius:14px; overflow:hidden; box-shadow:0 12px 34px rgba(0,0,0,0.3)}
    .oq-pixel{font-family:"Press Start 2P",monospace}
    .oq-titlecard{padding:36px 24px; text-align:center; color:#f5f3ff}
    .oq-titlecard h2{font-size:14px; line-height:1.7; margin:0 0 14px; color:#fbbf24}
    .oq-titlecard p{font-size:12.5px; color:#b8adde; line-height:1.6; max-width:340px; margin:0 auto 22px}
    .oq-status-line{font-size:11px; color:#b8adde; margin-bottom:18px}
    .oq-start-btn{font-family:inherit; font-size:12px; padding:12px 26px; border-radius:8px; border:2px solid #fbbf24; background:transparent; color:#fbbf24; cursor:pointer}
    .oq-start-btn:hover{background:#fbbf24; color:#1a1533}
    .oq-battle{display:none; flex-direction:column; color:#f5f3ff}
    .oq-battle.show{display:flex}
    .oq-arena{padding:20px 20px 14px; position:relative; min-height:190px}
    .oq-combatant{display:flex; align-items:center; gap:12px; margin-bottom:14px}
    .oq-combatant.enemy{justify-content:flex-start}
    .oq-combatant.rep{justify-content:flex-end; flex-direction:row-reverse}
    .oq-name-block{flex:1}
    .oq-name-block.enemy-align{text-align:left}
    .oq-name-block.rep-align{text-align:right}
    .oq-combatant-name{font-size:11px; margin-bottom:5px}
    .oq-hp-track{height:9px; border-radius:5px; background:rgba(0,0,0,0.35); overflow:hidden}
    .oq-hp-fill{height:100%; transition:width 0.4s ease}
    .oq-hp-fill.enemy{background:#fb7185}
    .oq-hp-fill.rep{background:#2dd4bf}
    .oq-hp-label{font-size:9px; color:#b8adde; margin-top:3px}
    .oq-sprite{width:58px; height:58px; flex-shrink:0}
    .oq-sprite.hit{animation:oqShake 0.4s ease}
    @keyframes oqShake{0%,100%{transform:translateX(0)}25%{transform:translateX(-5px)}75%{transform:translateX(5px)}}
    .oq-quote{margin:4px 20px 14px; padding:12px 14px; background:rgba(0,0,0,0.28); border-left:3px solid #fb7185; border-radius:6px}
    .oq-quote p{margin:0; font-size:13px; font-style:italic; line-height:1.5}
    .oq-actions{display:grid; grid-template-columns:1fr 1fr; gap:9px; padding:0 20px 16px}
    .oq-action-btn{font-family:inherit; text-align:left; padding:11px 12px; border-radius:8px; border:2px solid #453a7a; background:rgba(255,255,255,0.03); color:#f5f3ff; cursor:pointer; font-size:12px; font-weight:600}
    .oq-action-btn small{display:block; font-weight:400; color:#b8adde; font-size:10px; margin-top:3px}
    .oq-action-btn:hover{border-color:#fbbf24}
    .oq-action-btn:disabled{opacity:0.4; pointer-events:none}
    .oq-feedback{padding:0 20px 18px; min-height:50px}
    .oq-verdict{font-size:11.5px; font-weight:800; margin-bottom:4px}
    .oq-verdict.correct{color:#2dd4bf}
    .oq-verdict.incorrect{color:#fb7185}
    .oq-explain{font-size:11.5px; color:#b8adde; line-height:1.5}
    .oq-next-btn{margin-top:10px; font-family:inherit; font-size:11px; padding:8px 16px; border-radius:7px; border:none; background:#fbbf24; color:#1a1533; font-weight:800; cursor:pointer}
    .oq-victory{display:none; text-align:center; padding:36px 24px; color:#f5f3ff}
    .oq-victory.show{display:block}
    .oq-victory h3{font-size:13px; color:#fbbf24; margin:0 0 12px}
    .oq-victory p{font-size:12px; color:#b8adde; line-height:1.6}
    .oq-xp-pill{display:inline-block; margin-top:14px; padding:7px 14px; border-radius:999px; background:rgba(251,191,36,0.15); border:1px solid #fbbf24; color:#fbbf24; font-size:10px}
  `;document.head.appendChild(style);

  function ensure(){
    if(byId('oqCard'))return;
    const anchor=byId('gamifyCard')||document.querySelector('#field .card:last-of-type');if(!anchor)return;
    const card=document.createElement('div');card.id='oqCard';card.className='card oq-card';
    card.innerHTML=`<div class="card-head"><div><h2>OBJECTION QUEST</h2><p class="muted small">Real objections, real techniques, real points.</p></div></div>
      <div class="oq-stage" id="oqStage">
        <div class="oq-titlecard" id="oqTitlecard">
          <h2 class="oq-pixel">READY TO<br>BATTLE?</h2>
          <p>Every monster below is a real objection from Sales Coaching. Pick the right technique, land the hit.</p>
          <div class="oq-status-line" id="oqStatusLine">Loading your progress…</div>
          <button class="oq-start-btn oq-pixel" id="oqStartBtn">START</button>
        </div>
        <div class="oq-battle" id="oqBattle">
          <div class="oq-arena" id="oqArena">
            <div class="oq-combatant enemy">
              <svg class="oq-sprite" id="oqEnemySprite" viewBox="0 0 64 64"></svg>
              <div class="oq-name-block enemy-align">
                <div class="oq-combatant-name oq-pixel" id="oqEnemyName" style="color:#fb7185"></div>
                <div class="oq-hp-track"><div class="oq-hp-fill enemy" id="oqEnemyHpFill" style="width:100%"></div></div>
                <div class="oq-hp-label" id="oqEnemyHpLabel"></div>
              </div>
            </div>
            <div class="oq-combatant rep">
              <svg class="oq-sprite" id="oqRepSprite" viewBox="0 0 64 64"></svg>
              <div class="oq-name-block rep-align">
                <div class="oq-combatant-name oq-pixel" id="oqRepLevel" style="color:#2dd4bf"></div>
                <div class="oq-hp-track"><div class="oq-hp-fill rep" id="oqRepHpFill" style="width:100%"></div></div>
                <div class="oq-hp-label" id="oqRepHpLabel"></div>
              </div>
            </div>
          </div>
          <div class="oq-quote"><p id="oqObjectionText"></p></div>
          <div class="oq-actions" id="oqActions"></div>
          <div class="oq-feedback" id="oqFeedback"></div>
        </div>
        <div class="oq-victory" id="oqVictory">
          <h3 class="oq-pixel" id="oqVictoryTitle"></h3>
          <p id="oqVictoryText"></p>
          <div class="oq-xp-pill oq-pixel" id="oqXpPill"></div>
        </div>
      </div>`;
    anchor.insertAdjacentElement('afterend',card);
    byId('oqStartBtn').onclick=startRun;
    load();
  }

  async function load(){
    try{
      const [objRes,statusRes]=await Promise.all([
        sb.functions.invoke('gamification',{body:{action:'list_battle_objections'}}),
        sb.functions.invoke('gamification',{body:{action:'game_status'}}),
      ]);
      objections=objRes.data?.objections||[];
      gameStatus=statusRes.data||{victories:0,level:1};
      byId('oqStatusLine').textContent=objections.length
        ? `Level ${gameStatus.level} · ${gameStatus.victories} objections defeated so far`
        : 'No battle-ready objections found yet -- add a framework-tagged one in Sales Coaching.';
      byId('oqStartBtn').disabled=!objections.length;
    }catch(error){
      console.error('Objection Quest load failed',error);
      byId('oqStatusLine').textContent='Could not load your progress. Try again shortly.';
    }
  }

  const MONSTERS=[
    {name:'THE SKEPTIC', color:'#8a86c9', draw:skepticSprite},
    {name:'PRICE PHANTOM', color:'#fbbf24', draw:phantomSprite},
    {name:'TIME WRAITH', color:'#7dd3c0', draw:wraithSprite},
    {name:'DOUBT GOLEM', color:'#a78bfa', draw:golemSprite},
    {name:'THE DEFERRER', color:'#94a3b8', draw:defererSprite},
  ];
  function monsterFor(objection){
    let hash=0;
    for(const ch of String(objection.id)) hash=(hash*31+ch.charCodeAt(0))>>>0;
    return MONSTERS[hash%MONSTERS.length];
  }

  function skepticSprite(color){
    return `<ellipse cx="32" cy="38" rx="20" ry="18" fill="${color}" opacity="0.85"/>
      <ellipse cx="32" cy="22" rx="14" ry="13" fill="${color}"/>
      <path d="M20 18 Q26 12 32 17" stroke="#1a1533" stroke-width="2" fill="none" stroke-linecap="round"/>
      <path d="M44 18 Q38 12 32 17" stroke="#1a1533" stroke-width="2" fill="none" stroke-linecap="round"/>
      <circle cx="26" cy="24" r="2.4" fill="#1a1533"/><circle cx="38" cy="24" r="2.4" fill="#1a1533"/>
      <path d="M25 32 Q32 28 39 32" stroke="#1a1533" stroke-width="2" fill="none" stroke-linecap="round"/>
      <ellipse cx="18" cy="44" rx="5" ry="9" fill="${color}" opacity="0.7"/><ellipse cx="46" cy="44" rx="5" ry="9" fill="${color}" opacity="0.7"/>`;
  }
  function phantomSprite(color){
    return `<path d="M32 8 L44 30 L54 24 L48 44 L32 58 L16 44 L10 24 L20 30 Z" fill="${color}"/>
      <circle cx="25" cy="30" r="4" fill="#1a1533"/><circle cx="39" cy="30" r="4" fill="#1a1533"/>
      <circle cx="25" cy="30" r="1.6" fill="${color}"/><circle cx="39" cy="30" r="1.6" fill="${color}"/>
      <path d="M24 42 Q32 48 40 42" stroke="#1a1533" stroke-width="2.5" fill="none" stroke-linecap="round"/>`;
  }
  function wraithSprite(color){
    return `<path d="M32 10 Q50 18 46 40 Q44 54 32 56 Q20 54 18 40 Q14 18 32 10 Z" fill="${color}" opacity="0.75"/>
      <circle cx="26" cy="30" r="3" fill="#1a1533"/><circle cx="38" cy="30" r="3" fill="#1a1533"/>
      <path d="M22 44 L26 50 L30 44 L34 50 L38 44 L42 50" stroke="${color}" stroke-width="2" fill="none" stroke-linecap="round" opacity="0.6"/>
      <circle cx="32" cy="16" r="6" fill="none" stroke="#1a1533" stroke-width="1.5" opacity="0.5"/>`;
  }
  function golemSprite(color){
    return `<rect x="16" y="20" width="32" height="30" rx="4" fill="${color}"/>
      <rect x="20" y="8" width="24" height="16" rx="3" fill="${color}"/>
      <rect x="24" y="30" width="6" height="6" fill="#1a1533"/><rect x="34" y="30" width="6" height="6" fill="#1a1533"/>
      <path d="M24 42 h16" stroke="#1a1533" stroke-width="2.5" stroke-linecap="round"/>
      <rect x="8" y="26" width="8" height="16" rx="3" fill="${color}" opacity="0.85"/><rect x="48" y="26" width="8" height="16" rx="3" fill="${color}" opacity="0.85"/>`;
  }
  function defererSprite(color){
    return `<ellipse cx="32" cy="40" rx="22" ry="16" fill="${color}"/>
      <path d="M12 36 Q32 20 52 36" fill="${color}" opacity="0.6"/>
      <circle cx="24" cy="36" r="2.6" fill="#1a1533"/><circle cx="40" cy="36" r="2.6" fill="#1a1533"/>
      <path d="M26 46 Q32 42 38 46" stroke="#1a1533" stroke-width="2" fill="none" stroke-linecap="round"/>`;
  }
  function repSprite(){
    return `<circle cx="32" cy="20" r="11" fill="#f0d9b5"/>
      <rect x="21" y="30" width="22" height="24" rx="6" fill="#2dd4bf"/>
      <rect x="17" y="32" width="7" height="16" rx="3" fill="#2dd4bf"/><rect x="40" y="32" width="7" height="16" rx="3" fill="#2dd4bf"/>
      <path d="M26 16 Q32 10 38 16" stroke="#3a2b1a" stroke-width="3" fill="none" stroke-linecap="round"/>`;
  }

  function renderHp(){
    const maxHp=3;
    byId('oqEnemyHpFill').style.width=Math.max(0,(enemyHp/maxHp)*100)+'%';
    byId('oqRepHpFill').style.width=Math.max(0,(repHp/5)*100)+'%';
    byId('oqEnemyHpLabel').textContent=`HP ${Math.max(0,enemyHp)}/${maxHp}`;
    byId('oqRepHpLabel').textContent=`HP ${Math.max(0,repHp)}/5`;
  }

  function loadEncounter(){
    const objection=objections[encounterIndex];
    const monster=monsterFor(objection);
    enemyHp=3;repHp=5;battling=true;
    byId('oqEnemyName').textContent=monster.name;
    byId('oqRepLevel').textContent=`YOU — Lv.${gameStatus.level}`;
    byId('oqObjectionText').textContent='Customer says: "'+objection.objection_text+'"';
    byId('oqEnemySprite').innerHTML=monster.draw(monster.color);
    byId('oqRepSprite').innerHTML=repSprite();
    byId('oqFeedback').innerHTML='';
    renderHp();
    renderActions(objection);
  }

  function renderActions(objection){
    const buttons=[
      {id:'feel_felt_found',label:'Feel-Felt-Found',hint:'Acknowledge → they\u2019re not alone → what others found'},
      {id:'laer',label:'LAER',hint:'Listen, Acknowledge, Explore, Respond'},
    ];
    byId('oqActions').innerHTML=buttons.map(b=>`<button class="oq-action-btn" data-choice="${b.id}">${b.label}<small>${b.hint}</small></button>`).join('');
    byId('oqActions').querySelectorAll('[data-choice]').forEach(btn=>btn.onclick=()=>handleChoice(btn.dataset.choice,objection));
  }

  async function handleChoice(choice,objection){
    if(!battling)return;
    byId('oqActions').querySelectorAll('button').forEach(b=>b.disabled=true);
    const correct=choice===objection.framework;
    const enemySprite=byId('oqEnemySprite'),repSpriteEl=byId('oqRepSprite');

    if(correct){enemyHp-=1;enemySprite.classList.add('hit');setTimeout(()=>enemySprite.classList.remove('hit'),400);}
    else{repHp-=1;repSpriteEl.classList.add('hit');setTimeout(()=>repSpriteEl.classList.remove('hit'),400);}
    renderHp();

    byId('oqFeedback').innerHTML=`
      <div class="oq-verdict ${correct?'correct':'incorrect'}">${correct?'Landed.':'Not quite.'}</div>
      <div class="oq-explain">${correct?objection.explanation:'That approach doesn\u2019t fit this objection yet -- try the other technique.'}</div>
      <button class="oq-next-btn" id="oqNextBtn">${enemyHp<=0?'Continue':(repHp<=0?'Try again':'Next')}</button>`;
    byId('oqNextBtn').onclick=async()=>{
      if(enemyHp<=0){battling=false;await finishEncounter(objection);}
      else if(repHp<=0){repHp=5;renderHp();byId('oqFeedback').innerHTML='';renderActions(objection);byId('oqActions').querySelectorAll('button').forEach(b=>b.disabled=false);}
      else{byId('oqFeedback').innerHTML='';renderActions(objection);}
    };
  }

  async function finishEncounter(objection){
    byId('oqBattle').classList.remove('show');
    const monster=monsterFor(objection);
    let result={points_awarded:0,first_victory:false,level:gameStatus.level};
    try{
      const {data}=await sb.functions.invoke('gamification',{body:{action:'record_battle_victory',objection_id:objection.id}});
      if(data?.ok)result=data;
    }catch(error){console.error('Recording battle victory failed',error);}
    gameStatus.level=result.level||gameStatus.level;
    gameStatus.victories=result.victories||gameStatus.victories;

    byId('oqVictoryTitle').textContent='VICTORY';
    byId('oqVictoryText').textContent=`${monster.name} defeated. That objection isn't stopping this sale.`;
    byId('oqXpPill').textContent=result.first_victory?`+${result.points_awarded} points · Level ${gameStatus.level}`:'Practice round -- already defeated before';
    byId('oqVictory').classList.add('show');
    window.MCCOY_GAMIFICATION_FEEDBACK?.celebrate?.('\u2694\ufe0f',14);

    setTimeout(()=>{
      byId('oqVictory').classList.remove('show');
      encounterIndex++;
      if(encounterIndex<objections.length){byId('oqBattle').classList.add('show');loadEncounter();}
      else{
        byId('oqVictoryTitle').textContent='ALL CLEAR';
        byId('oqVictoryText').textContent=`Every objection in the arena, defeated. Level ${gameStatus.level}, ${gameStatus.victories} total victories.`;
        byId('oqXpPill').textContent='Come back after Sales Coaching adds more';
        byId('oqVictory').classList.add('show');
      }
    },2200);
  }

  function startRun(){
    if(!objections.length)return;
    encounterIndex=0;
    byId('oqTitlecard').style.display='none';
    byId('oqBattle').classList.add('show');
    loadEncounter();
  }

  document.addEventListener('DOMContentLoaded',ensure);
  if(document.readyState!=='loading')ensure();
})();
