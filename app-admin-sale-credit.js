// Admin-only sale credit, verification review, account evidence, and unassigned-sale bank.
(function(){
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const state={records:[],users:[],bank:null};
  const css=document.createElement('style');
  css.textContent=`
    #saleCreditBtn.sale-credit-floating{position:fixed;right:14px;bottom:14px;z-index:2600;display:none;border:0;border-radius:999px;padding:9px 13px;background:#1d4ed8;color:#fff;font-size:12px;cursor:pointer}
    #saleCreditPanel{position:fixed;inset:0;z-index:140002;display:none;align-items:center;justify-content:center;padding:16px;background:rgba(17,24,39,.78)}
    #saleCreditPanel.show{display:flex}.sale-credit-card{width:min(1240px,100%);max-height:92vh;overflow:auto;padding:20px;border-radius:16px;background:#fff}
    .sale-credit-toolbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:14px 0}.sale-credit-toolbar select,.sale-credit-toolbar input{padding:9px;border:1px solid #d1d5db;border-radius:8px;background:#fff}
    .sale-credit-toolbar input{min-width:min(360px,100%);flex:1}.sale-credit-row{padding:14px 0;border-top:1px solid #e5e7eb}.sale-credit-summary{display:grid;grid-template-columns:minmax(260px,1.4fr) minmax(220px,1fr);gap:10px}
    .sale-credit-actions{display:grid;grid-template-columns:minmax(180px,1fr) minmax(200px,1.2fr) auto auto;gap:8px;margin-top:10px;align-items:center}.sale-credit-actions select,.sale-credit-actions input{min-width:0;padding:9px;border:1px solid #d1d5db;border-radius:8px;background:#fff}
    .sale-credit-review{display:grid;grid-template-columns:minmax(180px,.7fr) minmax(260px,1.4fr) auto auto;gap:8px;margin-top:8px;align-items:center}.sale-credit-review select,.sale-credit-review input{min-width:0;padding:9px;border:1px solid #d1d5db;border-radius:8px;background:#fff}
    .sale-credit-payment{display:grid;grid-template-columns:minmax(180px,1fr) minmax(240px,1.4fr) auto;gap:8px;margin-top:10px;align-items:center}.sale-credit-payment input{min-width:0;padding:9px;border:1px solid #d1d5db;border-radius:8px;background:#fff}.sale-credit-approved{background:#15803d!important;color:#fff!important;border-color:#15803d!important}.sale-credit-queued{color:#7c3aed;font-weight:700}
    .sale-credit-evidence{font-size:12px;color:#4b5563}.sale-credit-missing{color:#b91c1c;font-weight:700}.sale-credit-complete{color:#166534;font-weight:700}
    .sale-account-details{margin-top:10px;border:1px solid #dbe4f0;border-radius:10px;padding:10px;background:#f8fafc}.sale-account-details>summary{cursor:pointer;font-weight:700}.sale-account-columns{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:10px}.sale-account-block{min-width:0}.sale-account-json{max-height:360px;overflow:auto;padding:10px;border-radius:8px;background:#111827;color:#f9fafb;font-size:11px;white-space:pre-wrap;overflow-wrap:anywhere}
    .sale-bank{margin-top:18px;border-top:2px solid #e5e7eb;padding-top:14px}.sale-bank-row{padding:12px 0;border-top:1px solid #e5e7eb}.sale-bank-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;font-size:12px}.sale-bank-actions{display:grid;grid-template-columns:minmax(210px,1fr) minmax(230px,1.2fr) auto minmax(160px,.7fr) auto;gap:8px;margin-top:10px;align-items:center}.sale-bank-actions select,.sale-bank-actions input{min-width:0;padding:9px;border:1px solid #d1d5db;border-radius:8px;background:#fff}.sale-credit-empty{padding:18px;border:1px dashed #d1d5db;border-radius:10px;color:#6b7280}
    @media(max-width:980px){.sale-bank-actions{grid-template-columns:1fr 1fr}}@media(max-width:760px){.sale-credit-summary,.sale-credit-actions,.sale-credit-review,.sale-credit-payment,.sale-account-columns,.sale-bank-grid,.sale-bank-actions{grid-template-columns:1fr}}
  `;
  document.head.appendChild(css);

  function displayDate(value){
    if(!value)return 'Not recorded';
    const date=new Date(value);
    return Number.isNaN(date.getTime())?String(value):date.toLocaleString();
  }
  function pretty(value){return esc(JSON.stringify(value??null,null,2));}

  function placeButton(button){
    const metrics=document.getElementById('metricsPageButton');
    if(metrics?.parentElement){
      button.className='nav-btn';button.dataset.view='sale-credit-controls';metrics.insertAdjacentElement('afterend',button);button.style.display='block';return true;
    }
    button.className='sale-credit-floating';document.body.appendChild(button);button.style.display='block';return false;
  }

  function ensurePanel(){
    if(document.getElementById('saleCreditBtn'))return;
    const button=document.createElement('button');button.id='saleCreditBtn';button.textContent='Sale Credit';placeButton(button);
    const placement=setInterval(()=>{if(placeButton(button))clearInterval(placement);},400);setTimeout(()=>clearInterval(placement),8000);
    const panel=document.createElement('div');panel.id='saleCreditPanel';panel.innerHTML=`<div class="sale-credit-card">
      <div class="card-head"><div><h2>Sale Credit</h2><p class="muted">Apply Credit changes the credited user. “No rep” removes ranking credit only and preserves the sale, accounting eligibility, and ISP evidence. Apply Review changes sale verification and accounting eligibility.</p></div><button id="saleCreditCloseTop" class="assign-btn">Close</button></div>
      <div id="saleCreditNotice" class="muted small"></div>
      <div class="sale-credit-toolbar"><select id="saleCreditFilter" aria-label="Sale record filter"><option value="review_queue">REVIEW QUEUE</option><option value="verified">VERIFIED sales</option><option value="unverified">UNVERIFIED sales</option><option value="not_a_sale">NOT A SALE</option><option value="all">All sales</option></select><select id="saleCreditSort" aria-label="Sort Sale Credit list"><option value="newest">Sort: Newest</option><option value="isp">Sort: ISP</option><option value="region">Sort: Region</option></select><input id="saleCreditSearch" placeholder="Search any account, customer, address, order, provider, region, or rep data" aria-label="Search all sale account data"><button id="saleCreditRefresh" class="assign-btn">Refresh</button></div>
      <div id="saleCreditRows">Loading…</div>
      <section class="sale-bank"><div class="card-head"><div><h2>Unassigned Sales Bank</h2><p class="muted small">Assign one provider-evidence row to any active McCoy user and approve it for rankings/pay, or hold/deny it without changing the source ISP evidence. ABANDONED and CANCELLED provider orders are excluded.</p></div><button id="saleBankRefresh" class="assign-btn">Refresh Bank</button></div><div id="saleBankRows">Loading…</div></section>
      <div style="text-align:right;margin-top:12px"><button id="saleCreditClose" class="assign-btn">Close</button></div>
    </div>`;document.body.appendChild(panel);
    const close=()=>panel.classList.remove('show');document.getElementById('saleCreditClose').onclick=close;document.getElementById('saleCreditCloseTop').onclick=close;
    document.getElementById('saleCreditRefresh').onclick=()=>loadAll(true);document.getElementById('saleBankRefresh').onclick=()=>loadBank(true);document.getElementById('saleCreditFilter').onchange=renderSales;document.getElementById('saleCreditSort').onchange=renderSales;document.getElementById('saleCreditSearch').oninput=renderSales;
    button.onclick=async event=>{event.preventDefault();panel.classList.add('show');await loadAll();};
  }

  async function loadDashboardPages(){
    const rows=[];let offset=0,total=0;
    do{
      const {data,error}=await sb.rpc('admin_sale_credit_dashboard_page',{p_limit:250,p_offset:offset});if(error)throw error;
      const page=Array.isArray(data?.rows)?data.rows:[];total=Number(data?.total_count||0);rows.push(...page);offset+=page.length;if(!page.length)break;
    }while(offset<total);
    return rows;
  }

  async function loadAll(force=false){
    const root=document.getElementById('saleCreditRows'),notice=document.getElementById('saleCreditNotice');
    if(!force&&state.records.length){renderSales();if(!state.bank)await loadBank();return;}
    root.textContent='Loading all sale account data…';notice.textContent='';
    try{
      const [recordsResult,usersResult]=await Promise.all([loadDashboardPages(),sb.from('app_user_access').select('email,display_name,role,active').eq('active',true).order('display_name')]);
      if(usersResult.error)throw usersResult.error;state.records=recordsResult;state.users=usersResult.data||[];notice.textContent=`Loaded ${state.records.length} sale account record${state.records.length===1?'':'s'}.`;renderSales();await loadBank(force);
    }catch(error){console.error(error);root.textContent='Unable to load sale credit controls.';notice.textContent=error?.message||'';}
  }

  function recordMatches(record,filter,needle){
    const sale=record.sale||{};
    const filterMatch=filter==='all'||(filter==='verified'&&sale.verification_status==='verified_processed'&&sale.required_metrics_complete===true&&sale.sale_status!=='not_a_sale')||(filter==='review_queue'&&sale.sale_credit_review_queued===true)||(filter==='unverified'&&sale.verification_status!=='verified_processed'&&sale.sale_status!=='not_a_sale')||(filter==='not_a_sale'&&sale.sale_status==='not_a_sale');
    return filterMatch&&(!needle||JSON.stringify(record).toLowerCase().includes(needle));
  }

  function renderSales(){
    const root=document.getElementById('saleCreditRows');if(!root)return;
    const filter=document.getElementById('saleCreditFilter')?.value||'review_queue',sort=document.getElementById('saleCreditSort')?.value||'newest',needle=(document.getElementById('saleCreditSearch')?.value||'').trim().toLowerCase();
    const records=state.records.filter(record=>recordMatches(record,filter,needle)).sort((a,b)=>{const newest=String(b.sale?.created_at||'').localeCompare(String(a.sale?.created_at||''));if(sort==='isp')return String(a.sale?.isp||'').localeCompare(String(b.sale?.isp||''),undefined,{sensitivity:'base'})||newest;if(sort==='region')return String(a.region||'Unassigned').localeCompare(String(b.region||'Unassigned'),undefined,{sensitivity:'base'})||newest;return newest;});
    if(!records.length){root.innerHTML='<div class="sale-credit-empty">No sale records match this view.</div>';return;}
    root.innerHTML=records.map((record,index)=>saleRow(record,index)).join('');records.forEach((record,index)=>bindSaleActions(record,index));
  }

  function saleRow(record,index){
    const sale=record.sale||{},provider=record.provider_account,missing=Array.isArray(sale.required_metrics_missing)?sale.required_metrics_missing:[];
    const noRep=sale.ranking_credit_excluded===true;
    const options=`<option value="" ${noRep?'selected':''}>No rep — remove from rankings</option>`+state.users.map(user=>`<option value="${esc(user.email)}" ${!noRep&&String(user.email).toLowerCase()===String(sale.rep_email).toLowerCase()?'selected':''}>${esc(user.display_name||user.email)} · ${esc(user.email)} (${esc(user.role)})</option>`).join('');
    const complete=sale.required_metrics_complete===true,verified=sale.ranking_eligible===true,adminApproved=String(sale.verification_reason||'').startsWith('admin_approved_sale_credit:'),queued=sale.sale_credit_review_queued===true;
    return `<article class="sale-credit-row">
      <div class="sale-credit-summary"><div><strong>${esc(sale.isp||'Unknown provider')} · ${esc(sale.provider_order_number||'No order number')}</strong><div>${esc(sale.customer_first_name||'')} ${esc(sale.customer_last_name||'')}</div><div>${esc(sale.service_address||'No service address')}</div></div><div class="sale-credit-evidence">Region: ${esc(record.region||'Unassigned')} · Order date: ${esc(sale.order_date||'Missing')} · Install date: ${esc(sale.install_date||'Missing')}<br>Ranking credit: ${noRep?'<span class="sale-credit-missing">NO REP</span>':esc(sale.rep_name||sale.rep_email||'Unassigned')} · Accounting owner: ${esc(sale.rep_name||sale.rep_email||'Unassigned')} · Provider seller: ${esc(sale.provider_reported_rep_name||sale.provider_reported_rep_email||provider?.seller_name||provider?.seller_email||'Not reported')}<br>Status: ${esc(sale.sale_status)} · ${verified?'<span class="sale-credit-complete">IN RANKINGS</span>':'<span class="sale-credit-missing">OUT OF RANKINGS</span>'} · ${sale.competition_eligible===true?'<span class="sale-credit-complete">PAY ELIGIBLE</span>':'<span class="sale-credit-missing">NOT PAY ELIGIBLE</span>'} ${adminApproved?'· <span class="sale-credit-complete">ADMIN APPROVED</span>':''} ${queued?'· <span class="sale-credit-queued">IN REVIEW QUEUE</span>':''}<br>${complete?'<span class="sale-credit-complete">required data complete</span>':'<span class="sale-credit-missing">missing '+esc(missing.join(', ')||'account data')+'</span>'}</div></div>
      <div class="sale-credit-actions"><select id="saleCreditUser${index}" aria-label="Ranked or credited McCoy user">${options}</select><input id="saleCreditReason${index}" maxlength="240" placeholder="Credit reassignment reason (APPROVED needs none)" aria-label="Credit reassignment reason"><button id="saleCreditSave${index}" class="primary">Apply Credit</button><button id="saleCreditApprove${index}" class="${adminApproved?'sale-credit-approved':'primary'}" title="One-click verification for rankings and pay; removes the sale from the Review Queue" ${noRep?'disabled':''}>APPROVED</button></div>
      <div class="sale-credit-review"><select id="saleReviewDisposition${index}" aria-label="Sale verification disposition"><option value="">Choose Admin review…</option><option value="unverified">UNVERIFIED</option><option value="not_a_sale">NOT A SALE</option><option value="restore">RESTORE provider decision</option></select><input id="saleReviewReason${index}" maxlength="500" placeholder="Admin review or queue reason required" aria-label="Admin review or queue reason"><button id="saleReviewSave${index}" class="assign-btn">Apply Review</button><button id="saleReviewQueue${index}" class="assign-btn">${queued?'Remove from Review':'Add to Review'}</button></div>
      <div class="sale-credit-payment"><input id="salePayment${index}" type="number" min="0.01" step="0.01" placeholder="${sale.commission_paid_at?'Paid $'+Number(sale.commission_paid_amount||0).toFixed(2):'Gross commission payment'}" ${sale.commission_paid_at?'disabled':''}><span class="sale-credit-evidence">${sale.commission_paid_at?'Recorded '+esc(displayDate(sale.commission_paid_at)):'Cancellations affect accounting, not ranking.'}</span><button id="salePaymentSave${index}" class="assign-btn" ${sale.commission_paid_at?'disabled':''}>${sale.commission_paid_at?'Payment Recorded':'Record Payment'}</button></div>
      <details class="sale-account-details"><summary>All account data</summary><div class="sale-account-columns"><div class="sale-account-block"><h3>McCoy sale record</h3><pre class="sale-account-json">${pretty(sale)}</pre></div><div class="sale-account-block"><h3>Linked ISP account evidence</h3><pre class="sale-account-json">${pretty(provider||{status:'No linked provider account row'})}</pre></div><div class="sale-account-block"><h3>Sale credit history</h3><pre class="sale-account-json">${pretty(record.credit_history||[])}</pre></div><div class="sale-account-block"><h3>Ranking credit history</h3><pre class="sale-account-json">${pretty(record.ranking_credit_history||[])}</pre></div><div class="sale-account-block"><h3>Review queue history</h3><pre class="sale-account-json">${pretty(record.review_queue_history||[])}</pre></div><div class="sale-account-block"><h3>Admin review history</h3><pre class="sale-account-json">${pretty(record.review_history||[])}</pre></div></div></details>
    </article>`;
  }

  function setNotice(message){const notice=document.getElementById('saleCreditNotice');if(notice)notice.textContent=message;}
  async function refreshAfterChange(saleId,message){setNotice(message);state.records=[];await loadAll(true);window.dispatchEvent(new CustomEvent('mccoy-sale-credit-changed',{detail:{saleId}}));window.dispatchEvent(new CustomEvent('mccoy-live-sales-changed',{detail:{saleId}}));}

  function bindSaleActions(record,index){
    const sale=record.sale||{},creditButton=document.getElementById('saleCreditSave'+index),approveButton=document.getElementById('saleCreditApprove'+index),userSelect=document.getElementById('saleCreditUser'+index);
    userSelect.onchange=()=>{approveButton.disabled=!userSelect.value;};
    creditButton.onclick=async()=>{
      const email=document.getElementById('saleCreditUser'+index).value,reason=document.getElementById('saleCreditReason'+index).value.trim();
      if(!reason){setNotice('Enter a reason before changing sale credit.');return;}
      creditButton.disabled=true;creditButton.textContent='Applying…';
      try{const {data,error}=await sb.rpc('admin_apply_sale_credit',{p_sale_id:sale.id,p_new_rep_email:email||null,p_reason:reason});if(error)throw error;const message=!email?`No rep selected. Sale removed from rankings only; accounting remains credited to ${sale.rep_name||sale.rep_email}.`:`Verified Sale approved for ${data.rep_name||data.rep_email}; ranking and pay eligibility were updated.`;await refreshAfterChange(sale.id,message+' ISP evidence and audit history are preserved.');}catch(error){setNotice(error?.message||'Unable to update sale credit.');creditButton.disabled=false;creditButton.textContent='Apply Credit';}
    };
    approveButton.onclick=async()=>{
      const email=userSelect.value;
      if(!email){setNotice('Choose a rep before approving the sale.');return;}
      approveButton.disabled=true;approveButton.textContent='APPROVING…';
      try{const {data,error}=await sb.rpc('admin_approve_sale_credit',{p_sale_id:sale.id,p_rep_email:email});if(error)throw error;const filter=document.getElementById('saleCreditFilter');if(filter)filter.value='review_queue';await refreshAfterChange(sale.id,`Verified Sale approved for ${data.rep_name||data.rep_email}, applied to rankings and ${data.competition_eligible===true?'pay':'the cancellation/chargeback accounting path'}, and removed from the actionable Sale Credit queue.`);}catch(error){setNotice(error?.message||'Unable to approve sale credit.');approveButton.disabled=false;approveButton.textContent='APPROVED';}
    };
    const reviewButton=document.getElementById('saleReviewSave'+index);
    reviewButton.onclick=async()=>{
      const disposition=document.getElementById('saleReviewDisposition'+index).value,reason=document.getElementById('saleReviewReason'+index).value.trim();
      if(!disposition){setNotice('Choose UNVERIFIED, NOT A SALE, or RESTORE.');return;}if(!reason){setNotice('Enter an Admin review reason.');return;}
      reviewButton.disabled=true;reviewButton.textContent='Applying…';
      try{const {error}=await sb.rpc('admin_set_sale_review_disposition',{p_sale_id:sale.id,p_disposition:disposition,p_reason:reason});if(error)throw error;await refreshAfterChange(sale.id,disposition==='not_a_sale'?'Sale marked NOT A SALE and removed from rankings.':disposition==='unverified'?'Sale marked UNVERIFIED and removed from rankings.':'Provider decision restored subject to required-data validation.');}catch(error){setNotice(error?.message||'Unable to apply Admin review.');reviewButton.disabled=false;reviewButton.textContent='Apply Review';}
    };
    const queueButton=document.getElementById('saleReviewQueue'+index);
    queueButton.onclick=async()=>{
      const queued=sale.sale_credit_review_queued===true,reason=document.getElementById('saleReviewReason'+index).value.trim();
      if(!reason){setNotice('Enter a reason before changing the review queue.');return;}
      queueButton.disabled=true;queueButton.textContent=queued?'Removing…':'Adding…';
      try{const {error}=await sb.rpc('admin_set_sale_credit_review_queue',{p_sale_id:sale.id,p_queued:!queued,p_reason:reason});if(error)throw error;await refreshAfterChange(sale.id,queued?'Sale removed from the review queue.':'Verified sale added to the Sale Credit review queue without changing rankings or pay.');}catch(error){setNotice(error?.message||'Unable to change the review queue.');queueButton.disabled=false;queueButton.textContent=queued?'Remove from Review':'Add to Review';}
    };
    const paymentButton=document.getElementById('salePaymentSave'+index);
    if(!paymentButton.disabled)paymentButton.onclick=async()=>{
      const gross=Number(document.getElementById('salePayment'+index).value);if(!Number.isFinite(gross)||gross<=0){setNotice('Enter the gross commission payment amount.');return;}
      paymentButton.disabled=true;paymentButton.textContent='Recording…';
      try{const {data,error}=await sb.rpc('admin_record_sale_commission_payment',{p_sale_id:sale.id,p_gross_amount:gross});if(error)throw error;await refreshAfterChange(sale.id,`Payment recorded: $${Number(data.net_paid_amount||0).toFixed(2)} net paid; $${Number(data.chargeback_applied||0).toFixed(2)} applied to prior cancellations.`);}catch(error){setNotice(error?.message||'Unable to record payment.');paymentButton.disabled=false;paymentButton.textContent='Record Payment';}
    };
  }

  async function loadBank(force=false){
    const root=document.getElementById('saleBankRows');if(!root)return;if(!force&&state.bank){renderBank();return;}root.textContent='Loading investigation bank…';
    try{const {data,error}=await sb.rpc('admin_unassigned_sales_bank');if(error)throw error;state.bank=data||{};renderBank();}catch(error){console.error(error);root.textContent=error?.message||'Unable to load the Unassigned Sales Bank.';}
  }

  function renderBank(){
    const root=document.getElementById('saleBankRows'),bank=state.bank||{},rows=bank.rows||[],denied=bank.denied_rows||[],incomplete=bank.incomplete_sales||[];
    const userOptions='<option value="">Choose active McCoy user…</option>'+state.users.map(user=>`<option value="${esc(user.email)}">${esc(user.display_name||user.email)} · ${esc(user.email)} (${esc(user.role)})</option>`).join('');
    const rowMarkup=(row,index,deniedRow=false)=>`<div class="sale-bank-row"><strong>${esc(row.provider)} · ${esc(row.order_number||row.account_number||'No order/account number')}</strong>${row.admin_evidence_disposition?` · <span class="sale-credit-missing">${esc(String(row.admin_evidence_disposition).toUpperCase().replaceAll('_',' '))}</span>`:''}<div class="sale-bank-grid"><span>Seller: ${esc(row.seller_name||row.seller_email||row.seller_identifier||'Unknown')}</span><span>Customer: ${esc(row.customer_name||'Unknown')}</span><span>Status: ${esc(row.provider_status||'Unknown')}</span><span>Address: ${esc(row.service_address||'Unknown')}</span><span>Sale date: ${esc(row.sale_date||'Unknown')}</span><span>Import: ${esc(row.materialization_status||'unmaterialized')}</span></div><div class="sale-credit-evidence">${esc(row.why_considered_sale||row.admin_evidence_reason||row.materialization_reason||'Provider evidence requires review.')}</div>${deniedRow?`<div class="sale-bank-actions"><span></span><input id="saleBankReasonDenied${index}" maxlength="500" placeholder="Reason required to restore" aria-label="Provider evidence restore reason"><button id="saleBankRestoreDenied${index}" class="assign-btn">RESTORE</button><span></span><span></span></div>`:`<div class="sale-bank-actions"><select id="saleBankUser${index}" aria-label="Assign provider evidence to McCoy user">${userOptions}</select><input id="saleBankReason${index}" maxlength="500" placeholder="Assignment or review reason required" aria-label="Provider evidence decision reason"><button id="saleBankAssign${index}" class="primary">APPROVE &amp; ASSIGN</button><select id="saleBankDisposition${index}" aria-label="Provider evidence review disposition"><option value="">Choose review…</option><option value="unverified">UNVERIFIED</option><option value="not_a_sale">NOT A SALE</option>${row.admin_evidence_disposition?'<option value="restore">RESTORE</option>':''}</select><button id="saleBankReview${index}" class="assign-btn">Apply Review</button></div>`}<details class="sale-account-details"><summary>Provider evidence and review history</summary><div class="sale-account-columns"><div class="sale-account-block"><h3>ISP evidence</h3><pre class="sale-account-json">${pretty(row)}</pre></div><div class="sale-account-block"><h3>Evidence decision history</h3><pre class="sale-account-json">${pretty(row.review_history||[])}</pre></div></div></details></div>`;
    root.innerHTML=`<p><strong>${Number(bank.count||0)} unassigned provider candidate${Number(bank.count||0)===1?'':'s'}</strong> · <strong>${Number(bank.denied_count||0)} denied provider row${Number(bank.denied_count||0)===1?'':'s'}</strong> · <strong>${Number(bank.incomplete_count||0)} incomplete McCoy record${Number(bank.incomplete_count||0)===1?'':'s'}</strong></p>
      <details open><summary>Unassigned provider evidence (${rows.length})</summary>${rows.length?rows.map((row,index)=>rowMarkup(row,index)).join(''):'<div class="sale-credit-empty">No unassigned provider sale candidates.</div>'}</details>
      <details><summary>Denied provider evidence (${denied.length})</summary>${denied.length?denied.map((row,index)=>rowMarkup(row,index,true)).join(''):'<div class="sale-credit-empty">No provider evidence is denied.</div>'}</details>
      <details open><summary>Incomplete McCoy sale evidence (${incomplete.length})</summary>${incomplete.length?incomplete.map(row=>`<div class="sale-bank-row"><strong>${esc(row.provider)} · ${esc(row.order_number||'No order number')}</strong><div class="sale-bank-grid"><span>Rep: ${esc(row.rep_name||row.rep_email||'Unknown')}</span><span>Customer: ${esc(row.customer_name||'Unknown')}</span><span>Address: ${esc(row.service_address||'Missing')}</span><span>Order date: ${esc(row.order_date||'Missing')}</span><span>Install date: ${esc(row.install_date||'Missing')}</span><span class="sale-credit-missing">Missing: ${esc((row.missing||[]).join(', ')||'required data')}</span></div></div>`).join(''):'<div class="sale-credit-empty">No incomplete McCoy sale records.</div>'}</details>`;
    rows.forEach((row,index)=>bindBankActions(row,index));denied.forEach((row,index)=>bindDeniedBankAction(row,index));
  }

  async function refreshBankAfterChange(rowId,message,includeSales=false){
    setNotice(message);state.bank=null;if(includeSales){state.records=[];await loadAll(true);}else await loadBank(true);
    window.dispatchEvent(new CustomEvent('mccoy-live-sales-changed',{detail:{providerSaleRowId:rowId}}));
  }

  function bindBankActions(row,index){
    const assign=document.getElementById('saleBankAssign'+index),review=document.getElementById('saleBankReview'+index);
    assign.onclick=async()=>{const email=document.getElementById('saleBankUser'+index).value,reason=document.getElementById('saleBankReason'+index).value.trim();if(!email){setNotice('Choose an active McCoy user for this provider sale.');return;}if(!reason){setNotice('Enter why this provider evidence belongs to that user.');return;}assign.disabled=true;assign.textContent='ASSIGNING…';try{const {data,error}=await sb.rpc('admin_assign_provider_evidence',{p_provider_sale_row_id:row.id,p_rep_email:email,p_reason:reason});if(error)throw error;await refreshBankAfterChange(row.id,`Provider sale approved and assigned to ${data.rep_name||data.rep_email}; rankings and pay were updated.`,true);}catch(error){setNotice(error?.message||'Unable to assign provider evidence.');assign.disabled=false;assign.textContent='APPROVE & ASSIGN';}};
    review.onclick=async()=>{const disposition=document.getElementById('saleBankDisposition'+index).value,reason=document.getElementById('saleBankReason'+index).value.trim();if(!disposition){setNotice('Choose UNVERIFIED, NOT A SALE, or RESTORE.');return;}if(!reason){setNotice('Enter an evidence review reason.');return;}review.disabled=true;review.textContent='Applying…';try{const {error}=await sb.rpc('admin_set_provider_evidence_disposition',{p_provider_sale_row_id:row.id,p_disposition:disposition,p_reason:reason});if(error)throw error;const message=disposition==='not_a_sale'?'Provider evidence denied as NOT A SALE and removed from the candidate list.':disposition==='unverified'?'Provider evidence held as UNVERIFIED and kept in the investigation bank.':'Provider evidence decision restored.';await refreshBankAfterChange(row.id,message);}catch(error){setNotice(error?.message||'Unable to review provider evidence.');review.disabled=false;review.textContent='Apply Review';}};
  }

  function bindDeniedBankAction(row,index){
    const button=document.getElementById('saleBankRestoreDenied'+index);button.onclick=async()=>{const reason=document.getElementById('saleBankReasonDenied'+index).value.trim();if(!reason){setNotice('Enter why this denied provider evidence should be restored.');return;}button.disabled=true;button.textContent='RESTORING…';try{const {error}=await sb.rpc('admin_set_provider_evidence_disposition',{p_provider_sale_row_id:row.id,p_disposition:'restore',p_reason:reason});if(error)throw error;await refreshBankAfterChange(row.id,'Provider evidence restored to the unassigned candidate list.');}catch(error){setNotice(error?.message||'Unable to restore provider evidence.');button.disabled=false;button.textContent='RESTORE';}};
  }

  const timer=setInterval(()=>{if(window.MCCOY_ACCESS?.access){clearInterval(timer);if(window.MCCOY_ACCESS.access.role==='admin')setTimeout(ensurePanel,0);}},300);
  window.addEventListener('mccoy-access-ready',()=>{if(window.MCCOY_ACCESS?.access?.role==='admin')setTimeout(ensurePanel,0);});
})();
