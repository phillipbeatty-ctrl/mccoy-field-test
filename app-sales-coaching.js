// Sales Coaching: an admin-editable bank of door-to-door tips, plus the
// "best answer" objection-handling mini-game. Both feed reps content built
// on public, non-proprietary frameworks (Feel-Felt-Found, LAER) rather than
// any licensed material.
(function(){
  const byId=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let tips=[],objections=[],quizIndex=0,quizScore=0,quizAnswered=false,isAdmin=false,adminMode=false,adminTips=[],adminObjections=[];

  const style=document.createElement('style');style.textContent=`
    .sales-coaching{margin-top:14px}
    .sc-tabs{display:flex;gap:8px;margin-bottom:10px}
    .sc-tab{padding:8px 14px;border-radius:999px;border:1px solid #d1d5db;background:#fff;font-weight:700;font-size:13px;cursor:pointer}
    .sc-tab.active{background:#2563eb;color:#fff;border-color:#2563eb}
    .sc-tip-row{padding:10px 12px;border:1px solid #e5e7eb;border-radius:10px;margin-bottom:8px;background:#fff}
    .sc-tip-category{display:inline-block;font-size:11px;font-weight:800;color:#2563eb;text-transform:uppercase;margin-bottom:4px}
    .sc-quiz-card{border:1px solid #bfdbfe;border-radius:12px;padding:16px;background:#eff6ff}
    .sc-quiz-objection{font-size:16px;font-weight:800;margin-bottom:12px}
    .sc-quiz-option{display:block;width:100%;text-align:left;padding:10px 12px;border-radius:8px;border:1px solid #d1d5db;background:#fff;margin-bottom:8px;cursor:pointer;font:inherit}
    .sc-quiz-option:hover{border-color:#2563eb}
    .sc-quiz-option.correct{background:#dcfce7;border-color:#16a34a}
    .sc-quiz-option.incorrect{background:#fee2e2;border-color:#dc2626}
    .sc-quiz-explanation{margin-top:12px;padding:10px;background:#fff;border-radius:8px;font-size:13px}
    .sc-quiz-score{font-size:12px;color:#374151;margin-bottom:10px}
    .sc-next-btn{margin-top:12px;background:#2563eb;color:#fff;border:0;border-radius:8px;padding:9px 16px;font-weight:800;cursor:pointer}
    .sc-admin-toggle{background:none;border:1px solid #d1d5db;border-radius:8px;padding:6px 10px;font-size:12px;font-weight:700;cursor:pointer}
    .sc-admin-row{display:grid;gap:6px;padding:10px;border:1px solid #e5e7eb;border-radius:10px;margin-bottom:8px;background:#fafafa}
    .sc-admin-row input,.sc-admin-row textarea,.sc-admin-row select{padding:7px;border:1px solid #d1d5db;border-radius:6px;font:inherit}
    .sc-admin-actions{display:flex;gap:8px;justify-content:flex-end}
    .sc-admin-save{background:#16a34a;color:#fff;border:0;border-radius:6px;padding:6px 12px;font-weight:700;cursor:pointer}
    .sc-admin-delete{background:#dc2626;color:#fff;border:0;border-radius:6px;padding:6px 12px;font-weight:700;cursor:pointer}
    .sc-admin-add{background:#2563eb;color:#fff;border:0;border-radius:8px;padding:8px 14px;font-weight:800;cursor:pointer;margin-top:8px}
  `;document.head.appendChild(style);

  function ensure(){
    if(byId('salesCoachingCard'))return;
    const anchor=byId('salesToCompleteCard')||byId('saleHubActivity')||document.querySelector('#field .card:last-of-type');if(!anchor)return;
    const card=document.createElement('div');card.id='salesCoachingCard';card.className='card sales-coaching';
    card.innerHTML=`<div class="card-head"><div><h2>SALES COACHING</h2><p class="muted small">Door-to-door tips and objection-handling practice.</p></div><button id="scAdminToggle" class="sc-admin-toggle" style="display:none">Manage Content</button></div>
      <div class="sc-tabs"><button class="sc-tab active" data-sc-tab="tips">Tips</button><button class="sc-tab" data-sc-tab="quiz">Best Answer Practice</button></div>
      <div id="scBody"></div>`;
    anchor.insertAdjacentElement('afterend',card);
    byId('scAdminToggle').onclick=()=>{adminMode=!adminMode;renderAdmin();};
    card.querySelectorAll('[data-sc-tab]').forEach(btn=>btn.onclick=()=>{
      card.querySelectorAll('.sc-tab').forEach(t=>t.classList.remove('active'));btn.classList.add('active');
      renderTab(btn.dataset.scTab);
    });
    load();
  }

  async function load(){
    try{
      const [tipsRes,objRes]=await Promise.all([
        sb.functions.invoke('sales-coaching',{body:{action:'list_tips'}}),
        sb.functions.invoke('sales-coaching',{body:{action:'list_objections'}}),
      ]);
      tips=tipsRes.data?.tips||[];objections=objRes.data?.objections||[];
      const {data:access}=await sb.functions.invoke('sales-coaching',{body:{action:'admin_list_all_tips'}});
      isAdmin=!access?.error;
      if(isAdmin)byId('scAdminToggle').style.display='';
      renderTab('tips');
    }catch(error){console.error('Sales Coaching load failed',error);}
  }

  function renderTab(tab){
    const body=byId('scBody');if(!body)return;
    if(adminMode){renderAdmin();return;}
    if(tab==='tips'){
      body.innerHTML=tips.length?tips.map(t=>`<div class="sc-tip-row">${t.category?`<div class="sc-tip-category">${esc(t.category)}</div>`:''}<div>${esc(t.tip_text)}</div></div>`).join(''):'<p class="muted small">No tips added yet.</p>';
    }else{
      quizIndex=0;quizScore=0;quizAnswered=false;renderQuiz();
    }
  }

  function renderQuiz(){
    const body=byId('scBody');if(!body)return;
    if(!objections.length){body.innerHTML='<p class="muted small">No practice questions added yet.</p>';return;}
    if(quizIndex>=objections.length){
      body.innerHTML=`<div class="sc-quiz-card"><div class="sc-quiz-score">Round complete: ${quizScore} of ${objections.length} correct.</div><button class="sc-next-btn" id="scRestart">Practice Again</button></div>`;
      byId('scRestart').onclick=()=>{quizIndex=0;quizScore=0;quizAnswered=false;renderQuiz();};
      return;
    }
    const q=objections[quizIndex];
    body.innerHTML=`<div class="sc-quiz-card">
      <div class="sc-quiz-score">Question ${quizIndex+1} of ${objections.length} · Score: ${quizScore}</div>
      <div class="sc-quiz-objection">Customer says: "${esc(q.objection_text)}"</div>
      ${q.options.map(o=>`<button class="sc-quiz-option" data-opt="${esc(o.id)}">${esc(o.text)}</button>`).join('')}
      <div id="scQuizFeedback"></div>
    </div>`;
    body.querySelectorAll('.sc-quiz-option').forEach(btn=>btn.onclick=()=>{
      if(quizAnswered)return;quizAnswered=true;
      const chosen=btn.dataset.opt,correct=q.correct_option_id;
      body.querySelectorAll('.sc-quiz-option').forEach(b=>{
        if(b.dataset.opt===correct)b.classList.add('correct');
        else if(b.dataset.opt===chosen)b.classList.add('incorrect');
      });
      if(chosen===correct)quizScore++;
      byId('scQuizFeedback').innerHTML=`<div class="sc-quiz-explanation"><strong>${chosen===correct?'Correct.':'Not quite.'}</strong> ${esc(q.explanation)}</div><button class="sc-next-btn" id="scNextQ">Next</button>`;
      byId('scNextQ').onclick=()=>{quizIndex++;quizAnswered=false;renderQuiz();};
    });
  }

  async function renderAdmin(){
    const body=byId('scBody');if(!body)return;
    if(!adminMode){renderTab(document.querySelector('.sc-tab.active')?.dataset.scTab||'tips');return;}
    const [tipsRes,objRes]=await Promise.all([
      sb.functions.invoke('sales-coaching',{body:{action:'admin_list_all_tips'}}),
      sb.functions.invoke('sales-coaching',{body:{action:'admin_list_all_objections'}}),
    ]);
    adminTips=tipsRes.data?.tips||[];adminObjections=objRes.data?.objections||[];
    body.innerHTML=`<h3>Manage Tips</h3><div id="scAdminTips"></div><button class="sc-admin-add" id="scAddTip">+ Add Tip</button>
      <h3 style="margin-top:20px">Manage Practice Questions</h3><div id="scAdminObjections"></div><button class="sc-admin-add" id="scAddObjection">+ Add Question</button>`;
    renderAdminTips();renderAdminObjections();
    byId('scAddTip').onclick=()=>{adminTips.push({id:null,tip_text:'',category:'',active:true});renderAdminTips();};
    byId('scAddObjection').onclick=()=>{adminObjections.push({id:null,objection_text:'',options:[{id:'a',text:''},{id:'b',text:''}],correct_option_id:'a',explanation:'',framework:'',active:true});renderAdminObjections();};
  }

  function renderAdminTips(){
    const root=byId('scAdminTips');if(!root)return;
    root.innerHTML=adminTips.map((t,i)=>`<div class="sc-admin-row">
      <input data-tip-field="tip_text" data-idx="${i}" value="${esc(t.tip_text)}" placeholder="Tip text">
      <input data-tip-field="category" data-idx="${i}" value="${esc(t.category||'')}" placeholder="Category (optional)">
      <div class="sc-admin-actions"><button class="sc-admin-save" data-save-tip="${i}">Save</button>${t.id?`<button class="sc-admin-delete" data-delete-tip="${esc(t.id)}">Delete</button>`:''}</div>
    </div>`).join('');
    root.querySelectorAll('[data-tip-field]').forEach(input=>input.oninput=()=>{adminTips[Number(input.dataset.idx)][input.dataset.tipField]=input.value;});
    root.querySelectorAll('[data-save-tip]').forEach(btn=>btn.onclick=async()=>{
      const t=adminTips[Number(btn.dataset.saveTip)];
      const {data,error}=await sb.functions.invoke('sales-coaching',{body:{action:'admin_upsert_tip',id:t.id,tip_text:t.tip_text,category:t.category}});
      if(error||!data?.ok){alert('Could not save tip.');return;}
      await renderAdmin();
    });
    root.querySelectorAll('[data-delete-tip]').forEach(btn=>btn.onclick=async()=>{
      if(!confirm('Delete this tip?'))return;
      await sb.functions.invoke('sales-coaching',{body:{action:'admin_delete_tip',id:btn.dataset.deleteTip}});
      await renderAdmin();
    });
  }

  function renderAdminObjections(){
    const root=byId('scAdminObjections');if(!root)return;
    root.innerHTML=adminObjections.map((o,i)=>`<div class="sc-admin-row">
      <textarea data-obj-field="objection_text" data-idx="${i}" rows="2" placeholder="Customer objection">${esc(o.objection_text)}</textarea>
      ${o.options.map((opt,oi)=>`<input data-opt-field="text" data-idx="${i}" data-oi="${oi}" value="${esc(opt.text)}" placeholder="Option ${esc(opt.id)}">`).join('')}
      <select data-obj-field="correct_option_id" data-idx="${i}">${o.options.map(opt=>`<option value="${esc(opt.id)}" ${opt.id===o.correct_option_id?'selected':''}>${esc(opt.id)} is correct</option>`).join('')}</select>
      <textarea data-obj-field="explanation" data-idx="${i}" rows="2" placeholder="Why this is the best answer">${esc(o.explanation)}</textarea>
      <div class="sc-admin-actions"><button class="sc-admin-save" data-save-obj="${i}">Save</button>${o.id?`<button class="sc-admin-delete" data-delete-obj="${esc(o.id)}">Delete</button>`:''}</div>
    </div>`).join('');
    root.querySelectorAll('[data-obj-field]').forEach(el=>el.oninput=el.onchange=()=>{adminObjections[Number(el.dataset.idx)][el.dataset.objField]=el.value;});
    root.querySelectorAll('[data-opt-field]').forEach(el=>el.oninput=()=>{adminObjections[Number(el.dataset.idx)].options[Number(el.dataset.oi)].text=el.value;});
    root.querySelectorAll('[data-save-obj]').forEach(btn=>btn.onclick=async()=>{
      const o=adminObjections[Number(btn.dataset.saveObj)];
      const {data,error}=await sb.functions.invoke('sales-coaching',{body:{action:'admin_upsert_objection',id:o.id,objection_text:o.objection_text,options:o.options,correct_option_id:o.correct_option_id,explanation:o.explanation,framework:o.framework}});
      if(error||!data?.ok){alert('Could not save question. Check that all options have text and a correct answer is chosen.');return;}
      await renderAdmin();
    });
    root.querySelectorAll('[data-delete-obj]').forEach(btn=>btn.onclick=async()=>{
      if(!confirm('Delete this question?'))return;
      await sb.functions.invoke('sales-coaching',{body:{action:'admin_delete_objection',id:btn.dataset.deleteObj}});
      await renderAdmin();
    });
  }

  document.addEventListener('DOMContentLoaded',ensure);
  if(document.readyState!=='loading')ensure();
})();
