// Gamification: points, badges, personalization store, personal goals,
// competitions (personal bests + today's leaderboard), and streak display.
// Hooks into the real mccoy-door-visit-completed and mccoy-sale-saved
// events already fired elsewhere in the app -- points are earned from real
// work, never from time spent in the app itself.
(function(){
  const byId=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let status=null,storeItems=[],goals=[],personalBests=null,leaderboard=[],activeTab='overview';

  const style=document.createElement('style');style.textContent=`
    .gamify-card{margin-top:14px}
    .gamify-tabs{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px}
    .gamify-tab{padding:8px 14px;border-radius:999px;border:1px solid #d1d5db;background:#fff;font-weight:700;font-size:13px;cursor:pointer}
    .gamify-tab.active{background:#7c3aed;color:#fff;border-color:#7c3aed}
    .gamify-points{font-size:28px;font-weight:900;color:#7c3aed}
    .gamify-badges{display:flex;flex-wrap:wrap;gap:10px;margin-top:10px}
    .gamify-badge{text-align:center;padding:10px;border-radius:10px;background:#faf5ff;border:1px solid #e9d5ff;min-width:80px}
    .gamify-badge-emoji{font-size:28px}
    .gamify-badge-label{font-size:11px;font-weight:700;margin-top:4px}
    .gamify-streak{padding:12px;border-radius:10px;background:#fff7ed;border:1px solid #fed7aa;margin-top:10px}
    .gamify-streak-days{font-size:22px;font-weight:900;color:#c2410c}
    .gamify-store-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;margin-top:10px}
    .gamify-store-item{padding:12px;border-radius:10px;border:1px solid #e5e7eb;background:#fff;text-align:center}
    .gamify-store-item.owned{border-color:#16a34a;background:#f0fdf4}
    .gamify-store-buy{margin-top:8px;background:#7c3aed;color:#fff;border:0;border-radius:6px;padding:6px 12px;font-weight:700;cursor:pointer;font-size:12px}
    .gamify-store-buy:disabled{background:#d1d5db;cursor:not-allowed}
    .gamify-goal-row{display:flex;justify-content:space-between;align-items:center;padding:10px;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:8px}
    .gamify-goal-bar{background:#e5e7eb;border-radius:999px;height:8px;width:120px;overflow:hidden}
    .gamify-goal-fill{background:#7c3aed;height:100%}
    .gamify-goal-form{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
    .gamify-goal-form select,.gamify-goal-form input{padding:7px;border:1px solid #d1d5db;border-radius:6px}
    .gamify-goal-add{background:#7c3aed;color:#fff;border:0;border-radius:6px;padding:7px 14px;font-weight:700;cursor:pointer}
    .gamify-best-row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f3f4f6}
    .gamify-leader-row{display:flex;justify-content:space-between;padding:6px 0}
    .gamify-leader-rank{font-weight:800;color:#7c3aed;width:24px}
    body[data-gamify-theme="theme_sunset"] .card-head h2{color:#c2410c}
    body[data-gamify-theme="theme_sunset"] .gamify-points{color:#ea580c}
    body[data-gamify-theme="theme_forest"] .card-head h2{color:#166534}
    body[data-gamify-theme="theme_forest"] .gamify-points{color:#16a34a}
    body[data-gamify-theme="theme_midnight"] .card-head h2{color:#1e1b4b}
    body[data-gamify-theme="theme_midnight"] .gamify-points{color:#4338ca}
    body[data-gamify-theme="theme_gold"] .card-head h2{color:#854d0e}
    body[data-gamify-theme="theme_gold"] .gamify-points{color:#ca8a04}
  `;document.head.appendChild(style);

  function ensure(){
    if(byId('gamifyCard'))return;
    const anchor=byId('salesCoachingCard')||document.querySelector('#field .card:last-of-type');if(!anchor)return;
    const card=document.createElement('div');card.id='gamifyCard';card.className='card gamify-card';
    card.innerHTML=`<div class="card-head"><div><h2>MY PROGRESS</h2><p class="muted small">Points, badges, goals, and how you stack up.</p></div></div>
      <div class="gamify-tabs">
        <button class="gamify-tab active" data-gamify-tab="overview">Overview</button>
        <button class="gamify-tab" data-gamify-tab="store">Store</button>
        <button class="gamify-tab" data-gamify-tab="goals">Goals</button>
        <button class="gamify-tab" data-gamify-tab="compete">Compete</button>
      </div>
      <div id="gamifyBody"></div>`;
    anchor.insertAdjacentElement('afterend',card);
    card.querySelectorAll('[data-gamify-tab]').forEach(btn=>btn.onclick=()=>{
      card.querySelectorAll('.gamify-tab').forEach(t=>t.classList.remove('active'));btn.classList.add('active');
      activeTab=btn.dataset.gamifyTab;render();
    });
    load();
  }

  async function load(){
    const priorBadgeKeys=new Set((status?.badges||[]).map(b=>b.badge_key));
    try{
      const {data}=await sb.functions.invoke('gamification',{body:{action:'get_status'}});
      status=data?.ok?data:null;
      applyTheme();
      if(status){
        for(const badge of status.badges||[]){
          if(!priorBadgeKeys.has(badge.badge_key))window.MCCOY_GAMIFICATION_FEEDBACK?.badgeToast(badge.badge_emoji,badge.badge_label);
        }
      }
    }catch(error){console.error('Gamification load failed',error);}
    render();
  }

  function applyTheme(){
    if(!status?.active_theme)return;
    document.body.setAttribute('data-gamify-theme',status.active_theme);
  }

  function render(){
    const body=byId('gamifyBody');if(!body)return;
    if(activeTab==='overview')renderOverview(body);
    else if(activeTab==='store')renderStore(body);
    else if(activeTab==='goals')renderGoals(body);
    else if(activeTab==='compete')renderCompete(body);
  }

  function renderOverview(body){
    if(!status){body.innerHTML='<p class="muted small">Loading…</p>';return;}
    const streak=status.streak||{};
    body.innerHTML=`
      <div class="gamify-points">${status.points_balance} points</div>
      <div class="muted small">${status.points_earned_lifetime} earned lifetime</div>
      <div class="gamify-streak">
        <div class="gamify-streak-days">${streak.current_streak_days||0} day streak</div>
        <div class="muted small">Longest: ${streak.longest_streak_days||0} days · Grace days banked: ${streak.grace_days_banked||0} of 3</div>
      </div>
      <h3 style="margin-top:16px">Badges</h3>
      <div class="gamify-badges">${(status.badges||[]).length?status.badges.map(b=>`<div class="gamify-badge"><div class="gamify-badge-emoji">${esc(b.badge_emoji)}</div><div class="gamify-badge-label">${esc(b.badge_label)}</div></div>`).join(''):'<p class="muted small">No badges yet -- knock a door or make a sale to start earning.</p>'}</div>
    `;
  }

  async function renderStore(body){
    body.innerHTML='<p class="muted small">Loading…</p>';
    if(!storeItems.length){const {data}=await sb.functions.invoke('gamification',{body:{action:'list_store_items'}});storeItems=data?.items||[];}
    const owned=status?.owned_items||['theme_default'];
    body.innerHTML=`<div class="muted small">You have ${status?.points_balance||0} points to spend.</div><div class="gamify-store-grid">
      ${storeItems.map(item=>{
        const isOwned=owned.includes(item.item_key),isActive=status?.active_theme===item.item_key,canAfford=(status?.points_balance||0)>=item.point_cost;
        return `<div class="gamify-store-item ${isOwned?'owned':''}"><div style="font-weight:800">${esc(item.label)}</div><div class="muted small">${item.point_cost} pts</div>
          ${isActive?'<div class="muted small" style="color:#16a34a;font-weight:700">Active</div>':isOwned?`<button class="gamify-store-buy" data-activate="${esc(item.item_key)}">Use</button>`:`<button class="gamify-store-buy" data-buy="${esc(item.item_key)}" ${canAfford?'':'disabled'}>${canAfford?'Buy':'Not enough'}</button>`}
        </div>`;
      }).join('')}
    </div>`;
    body.querySelectorAll('[data-buy]').forEach(btn=>btn.onclick=async()=>{
      btn.disabled=true;
      const {data,error}=await sb.functions.invoke('gamification',{body:{action:'purchase_item',item_key:btn.dataset.buy}});
      if(error||!data?.ok){alert('Could not complete purchase.');btn.disabled=false;return;}
      await load();renderStore(body);
    });
    body.querySelectorAll('[data-activate]').forEach(btn=>btn.onclick=async()=>{
      await sb.functions.invoke('gamification',{body:{action:'set_active_theme',item_key:btn.dataset.activate}});
      await load();renderStore(body);
    });
  }

  async function renderGoals(body){
    body.innerHTML='<p class="muted small">Loading…</p>';
    const {data}=await sb.functions.invoke('gamification',{body:{action:'list_goals'}});
    goals=data?.goals||[];
    body.innerHTML=`${goals.length?goals.map(g=>{
      const pct=Math.min(100,Math.round((g.progress/g.target_count)*100));
      return `<div class="gamify-goal-row"><div>${esc(g.period==='today'?'Today':'This week')}: ${esc(g.goal_type)} — ${g.progress}/${g.target_count}</div><div class="gamify-goal-bar"><div class="gamify-goal-fill" style="width:${pct}%"></div></div><button class="sc-admin-delete" data-del-goal="${esc(g.id)}" style="padding:4px 8px;font-size:11px">×</button></div>`;
    }).join(''):'<p class="muted small">No goals set yet.</p>'}
    <div class="gamify-goal-form">
      <select id="gamifyGoalType"><option value="doors">Doors knocked</option><option value="sales">Sales</option></select>
      <select id="gamifyGoalPeriod"><option value="today">Today</option><option value="this_week">This week</option></select>
      <input id="gamifyGoalTarget" type="number" min="1" placeholder="Target #" style="width:90px">
      <button class="gamify-goal-add" id="gamifyGoalAdd">Set Goal</button>
    </div>`;
    byId('gamifyGoalAdd').onclick=async()=>{
      const target=Number(byId('gamifyGoalTarget').value);
      if(!target||target<1){alert('Enter a target number greater than 0.');return;}
      const {data,error}=await sb.functions.invoke('gamification',{body:{action:'create_goal',goal_type:byId('gamifyGoalType').value,period:byId('gamifyGoalPeriod').value,target_count:target}});
      if(error||!data?.ok){alert('Could not set goal.');return;}
      renderGoals(body);
    };
    body.querySelectorAll('[data-del-goal]').forEach(btn=>btn.onclick=async()=>{
      await sb.functions.invoke('gamification',{body:{action:'delete_goal',id:btn.dataset.delGoal}});
      renderGoals(body);
    });
  }

  async function renderCompete(body){
    body.innerHTML='<p class="muted small">Loading…</p>';
    const [bestsRes,leaderRes]=await Promise.all([
      sb.functions.invoke('gamification',{body:{action:'personal_bests'}}),
      sb.functions.invoke('gamification',{body:{action:'leaderboard_today'}}),
    ]);
    personalBests=bestsRes.data;leaderboard=leaderRes.data?.leaderboard||[];
    body.innerHTML=`<h3>Your Personal Bests</h3>
      <div class="gamify-best-row"><span>Best day, doors knocked</span><strong>${personalBests?.best_day_doors||0}</strong></div>
      <div class="gamify-best-row"><span>Best day, sales</span><strong>${personalBests?.best_day_sales||0}</strong></div>
      <h3 style="margin-top:16px">Today's Leaderboard (doors knocked)</h3>
      ${leaderboard.length?leaderboard.map((r,i)=>`<div class="gamify-leader-row"><span><span class="gamify-leader-rank">${i+1}.</span>${esc(r.rep_name)}</span><strong>${r.door_count}</strong></div>`).join(''):'<p class="muted small">No activity yet today.</p>'}
    `;
  }

  // Award points from real work only -- never from time in the app.
  window.addEventListener('mccoy-door-visit-completed',()=>{
    sb.functions.invoke('gamification',{body:{action:'record_door_knock'}}).then(()=>{if(status)load();}).catch(()=>{});
  });
  window.addEventListener('mccoy-sale-saved',()=>{
    sb.functions.invoke('gamification',{body:{action:'record_sale'}}).then(()=>{if(status)load();}).catch(()=>{});
  });

  document.addEventListener('DOMContentLoaded',ensure);
  if(document.readyState!=='loading')ensure();
})();
