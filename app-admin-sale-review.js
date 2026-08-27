// Single Admin SALE REVIEW surface: customer corrections + credited user + provider evidence + approval.
(function(){
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const state={records:[],users:[],bank:[],selected:null};
  const css=document.createElement('style');
  css.textContent=`
    #saleReviewPanel{position:fixed;inset:0;z-index:150100;display:none;background:#f3f4f6;overflow:auto}
    #saleReviewPanel.show{display:block}.sale-review-shell{max-width:1280px;margin:0 auto;padding:18px}
    .sale-review-toolbar{display:grid;grid-template-columns:180px minmax(240px,1fr) minmax(240px,1fr) auto;gap:8px;margin:12px 0}
    .sale-review-toolbar select,.sale-review-toolbar input,.sale-review-form input,.sale-review-form select,.sale-review-form textarea{padding:10px;border:1px solid #d1d5db;border-radius:8px;background:#fff;font:inherit;min-width:0}
    .sale-review-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.sale-review-form label{display:grid;gap:4px;font-size:12px;font-weight:700}.sale-review-wide{grid-column:1/-1}
    .sale-review-summary{padding:12px;border:1px solid #dbe4f0;border-radius:12px;background:#f8fafc;margin-bottom:12px;line-height:1.55}.sale-review-status{display:flex;gap:10px;flex-wrap:wrap;margin-top:6px;font-size:12px}
    #asrSave{min-width:190px;background:#15803d!important;color:#fff!important;border:1px solid #15803d!important;font-weight:800}.sale-review-empty{padding:20px;border:1px dashed #cbd5e1;border-radius:12px;background:#fff;color:#64748b}
    @media(max-width:820px){.sale-review-toolbar,.sale-review-form{grid-template-columns:1fr}.sale-review-wide{grid-column:auto}}
  `;document.head.appendChild(css);

  function placeButton(btn){
    const old=document.getElementById('saleCreditBtn');if(old)old.remove();
    const metrics=document.getElementById('metricsPageButton');
    if(metrics?.parentElement){btn.className='nav-btn';metrics.insertAdjacentElement('afterend',btn);return true;}
    const nav=document.querySelector('.sidebar nav');if(nav){btn.className='nav-btn';nav.appendChild(btn);return true;}
    return false;
  }

  function ensure(){
    if(document.getElementById('saleReviewBtn'))return;
    const btn=document.createElement('button');btn.id='saleReviewBtn';btn.textContent='SALE REVIEW';
    placeButton(btn);const move=setInterval(()=>{if(placeButton(btn))clearInterval(move);},400);setTimeout(()=>clearInterval(move),8000);
    const panel=document.createElement('div');panel.id='saleReviewPanel';
    panel.innerHTML=`<div class="sale-review-shell"><div class="card">
      <div class="card-head"><div><h2>SALE REVIEW</h2><p class="muted">One Admin page for every sale: review the record, correct customer/order information, assign the credited user, match provider evidence, and approve.</p></div><button id="saleReviewCloseTop" class="assign-btn">Close</button></div>
      <div id="adminSaleReviewNotice" class="muted small"></div>
      <div class="sale-review-toolbar"><select id="saleReviewFilter"><option value="needs_review">Needs Review</option><option value="approved">Approved</option><option value="not_a_sale">Not A Sale</option><option value="all">All Sales</option></select><input id="adminSaleReviewSearch" placeholder="Search customer, address, order, provider or rep"><select id="adminSaleReviewSale"></select><button id="adminSaleReviewRefresh" class="assign-btn">Refresh</button></div>
      <div id="adminSaleReviewBody" class="sale-review-empty">Choose a sale to review.</div>
      <div style="text-align:right;margin-top:14px"><button id="saleReviewClose" class="assign-btn">Close</button></div>
    </div></div>`;document.body.appendChild(panel);
    const close=()=>panel.classList.remove('show');document.getElementById('saleReviewClose').onclick=close;document.getElementById('saleReviewCloseTop').onclick=close;
    btn.onclick=async e=>{e.preventDefault();panel.classList.add('show');await load();};
    document.getElementById('adminSaleReviewRefresh').onclick=()=>load(true);
    document.getElementById('adminSaleReviewSearch').oninput=renderSaleOptions;
    document.getElementById('saleReviewFilter').onchange=renderSaleOptions;
    document.getElementById('adminSaleReviewSale').onchange=()=>{state.selected=state.records.find(r=>r.sale?.id===document.getElementById('adminSaleReviewSale').value)||null;renderForm();};
  }

  function statusMatch(s,filter){
    if(filter==='all')return true;if(filter==='not_a_sale')return s.sale_status==='not_a_sale'||s.admin_review_disposition==='not_a_sale';
    const approved=s.verification_status==='verified_processed'&&s.ranking_eligible===true;
    return filter==='approved'?approved:!approved&&s.sale_status!=='not_a_sale';
  }
  async function load(force=false){
    const notice=document.getElementById('adminSaleReviewNotice');if(!force&&state.records.length){renderSaleOptions();renderForm();return;}
    notice.textContent='Loading sales…';
    try{
      const records=[];let offset=0,total=0;do{const {data,error}=await sb.rpc('admin_sale_credit_dashboard_page',{p_limit:250,p_offset:offset});if(error)throw error;const page=Array.isArray(data?.rows)?data.rows:[];records.push(...page);total=Number(data?.total_count||0);offset+=page.length;if(!page.length)break;}while(offset<total);
      const [usersRes,bankRes]=await Promise.all([sb.from('app_user_access').select('email,display_name,role,active').eq('active',true).order('display_name'),sb.rpc('admin_unassigned_sales_bank')]);
      if(usersRes.error)throw usersRes.error;if(bankRes.error)throw bankRes.error;state.records=records;state.users=usersRes.data||[];state.bank=Array.isArray(bankRes.data?.rows)?bankRes.data.rows:[];
      if(state.selected)state.selected=records.find(r=>r.sale?.id===state.selected.sale?.id)||null;
      notice.textContent=`${records.length} sales loaded. All Admin customer review and assignment is handled on this page.`;renderSaleOptions();renderForm();
    }catch(error){notice.textContent=error?.message||'Unable to load SALE REVIEW.';}
  }
  function renderSaleOptions(){
    const select=document.getElementById('adminSaleReviewSale');if(!select)return;const q=(document.getElementById('adminSaleReviewSearch')?.value||'').trim().toLowerCase();const filter=document.getElementById('saleReviewFilter')?.value||'needs_review';const current=state.selected?.sale?.id||select.value;
    const rows=state.records.filter(r=>statusMatch(r.sale||{},filter)&&(!q||JSON.stringify(r).toLowerCase().includes(q))).slice(0,750);
    select.innerHTML='<option value="">Choose sale…</option>'+rows.map(r=>{const s=r.sale||{};return `<option value="${esc(s.id)}" ${s.id===current?'selected':''}>${esc(s.customer_first_name||'No customer')} ${esc(s.customer_last_name||'')} · ${esc(s.isp||'ISP')} · ${esc(s.provider_order_number||'No order')} · ${esc(s.rep_name||s.rep_email||'Unassigned')}</option>`;}).join('');
    if(current&&!rows.some(r=>r.sale?.id===current)){state.selected=null;select.value='';renderForm();}
  }
  function input(id,label,value,type='text'){return `<label>${label}<input id="${id}" type="${type}" value="${esc(value||'')}"></label>`;}
  function renderForm(){
    const root=document.getElementById('adminSaleReviewBody'),record=state.selected;if(!root)return;if(!record){root.className='sale-review-empty';root.innerHTML='Choose a sale to review.';return;}const s=record.sale||{};root.className='';
    const users=state.users.map(u=>`<option value="${esc(u.email)}" ${String(u.email).toLowerCase()===String(s.rep_email).toLowerCase()?'selected':''}>${esc(u.display_name||u.email)} · ${esc(u.email)} (${esc(u.role)})</option>`).join('');
    const providerRows=[];if(record.provider_account?.id)providerRows.push({...record.provider_account,current:true});for(const p of state.bank){if(!providerRows.some(x=>x.id===p.id)&&String(p.provider||'').toLowerCase()===String(s.isp||'').toLowerCase())providerRows.push(p);}const providers='<option value="">No provider evidence change</option>'+providerRows.slice(0,300).map(p=>`<option value="${esc(p.id)}" ${p.id===s.provider_sale_row_id?'selected':''}>${p.current?'CURRENT · ':''}${esc(p.provider||'ISP')} · ${esc(p.order_number||p.account_number||'No order')} · ${esc(p.customer_name||'Unknown')} · ${esc(p.service_address||'No address')}</option>`).join('');
    const missing=Array.isArray(s.required_metrics_missing)?s.required_metrics_missing.join(', '):'';
    root.innerHTML=`<div class="sale-review-summary"><strong>Customer:</strong> ${esc(s.customer_first_name||'')} ${esc(s.customer_last_name||'')} &nbsp; <strong>Current credited user:</strong> ${esc(s.rep_name||s.rep_email||'Unassigned')} &nbsp; <strong>Provider seller:</strong> ${esc(s.provider_reported_rep_name||s.provider_reported_rep_email||record.provider_account?.seller_name||'Not reported')}<br><strong>Region:</strong> ${esc(record.region||'Unassigned')} &nbsp; <strong>Sale status:</strong> ${esc(s.sale_status||'Unknown')} &nbsp; <strong>Verification:</strong> ${esc(s.verification_status||'Unknown')}<div class="sale-review-status"><span>${s.ranking_eligible===true?'✓ In rankings':'• Out of rankings'}</span><span>${s.competition_eligible===true?'✓ Pay eligible':'• Not pay eligible'}</span><span>${s.required_metrics_complete===true?'✓ Required data complete':'Missing: '+esc(missing||'required sale data')}</span></div></div>
      <div class="sale-review-form"><label>Credited user<select id="asrRep"><option value="">Choose active user…</option>${users}</select></label><label>Provider evidence<select id="asrProvider">${providers}</select></label>
      ${input('asrFirst','Customer first name',s.customer_first_name)}${input('asrLast','Customer last name',s.customer_last_name)}${input('asrPhone','Customer phone',s.customer_phone)}${input('asrEmail','Customer email',s.customer_email,'email')}${input('asrAddress','Service address',s.service_address)}${input('asrOrder','Provider order number',s.provider_order_number)}${input('asrAccount','Provider account number',s.provider_account_number)}${input('asrInstall','Install date',s.install_date,'date')}${input('asrOrderDate','Order date',s.order_date,'date')}${input('asrIsp','Internet provider',s.isp)}${input('asrProduct','Internet product',s.internet_product)}${input('asrSpeed','Internet speed Mbps',s.internet_speed_mbps,'number')}
      <label class="sale-review-wide">Notes<textarea id="asrNotes" rows="3">${esc(s.notes||'')}</textarea></label></div>
      <div style="display:flex;justify-content:flex-end;margin-top:14px"><button id="asrSave">APPROVED</button></div><div class="muted small" style="margin-top:8px">The green APPROVED button saves every edited customer/order field above, assigns the selected user as the authoritative credited rep, attaches selected provider evidence, and updates ranking eligibility in one transaction.</div>`;
    document.getElementById('asrSave').onclick=save;
  }
  function val(id){return document.getElementById(id)?.value??'';}
  async function save(){const s=state.selected?.sale;if(!s)return;const rep=val('asrRep');if(!rep){document.getElementById('adminSaleReviewNotice').textContent='Choose the credited user before approving.';return;}const corrections={customer_first_name:val('asrFirst'),customer_last_name:val('asrLast'),customer_phone:val('asrPhone'),customer_email:val('asrEmail'),service_address:val('asrAddress'),provider_order_number:val('asrOrder'),provider_account_number:val('asrAccount'),install_date:val('asrInstall'),order_date:val('asrOrderDate'),isp:val('asrIsp'),internet_product:val('asrProduct'),internet_speed_mbps:val('asrSpeed'),notes:val('asrNotes')};const button=document.getElementById('asrSave');button.disabled=true;button.textContent='APPROVING…';try{const {data,error}=await sb.rpc('admin_review_sale_transaction',{p_sale_id:s.id,p_credited_rep_email:rep,p_reason:'Admin approved in SALE REVIEW',p_provider_sale_row_id:val('asrProvider')||null,p_corrections:corrections});if(error)throw error;const savedId=s.id;document.getElementById('adminSaleReviewNotice').textContent=`APPROVED. Customer information saved and credited to ${data.rep_name||data.rep_email}.`;state.records=[];await load(true);state.selected=state.records.find(r=>r.sale?.id===savedId)||null;renderSaleOptions();renderForm();window.dispatchEvent(new CustomEvent('mccoy-sale-credit-changed',{detail:{saleId:savedId}}));window.dispatchEvent(new CustomEvent('mccoy-live-sales-changed',{detail:{saleId:savedId}}));}catch(error){document.getElementById('adminSaleReviewNotice').textContent=error?.message||'Approval failed. No changes were committed.';button.disabled=false;button.textContent='APPROVED';}}
  const timer=setInterval(()=>{ensure();if(document.getElementById('saleReviewBtn'))clearInterval(timer);},400);setTimeout(()=>clearInterval(timer),15000);
})();
