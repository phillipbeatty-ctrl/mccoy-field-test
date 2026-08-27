// Unified Admin Sale Review: credited user + customer/order corrections + provider evidence + approval.
(function(){
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const state={records:[],users:[],bank:[],selected:null};

  function ensure(){
    if(document.getElementById('adminSaleReviewBtn')||!document.getElementById('saleCreditBtn'))return;
    const anchor=document.getElementById('saleCreditBtn');
    const btn=document.createElement('button');btn.id='adminSaleReviewBtn';btn.className=anchor.className||'nav-btn';btn.textContent='Admin Sale Review';
    anchor.insertAdjacentElement('afterend',btn);
    const panel=document.createElement('div');panel.id='adminSaleReviewPanel';panel.style.cssText='position:fixed;inset:0;z-index:150100;display:none;align-items:center;justify-content:center;padding:16px;background:rgba(17,24,39,.82)';
    panel.innerHTML=`<div style="width:min(1180px,100%);max-height:94vh;overflow:auto;background:#fff;border-radius:16px;padding:18px">
      <div class="card-head"><div><h2>Admin Sale Review</h2><p class="muted small">One transaction: choose the authoritative credited user, correct customer/order details, optionally attach provider evidence, then approve rankings.</p></div><button id="adminSaleReviewCloseTop" class="assign-btn">Close</button></div>
      <div id="adminSaleReviewNotice" class="muted small" style="margin:8px 0"></div>
      <div style="display:grid;grid-template-columns:minmax(220px,.7fr) minmax(260px,1.3fr) auto;gap:8px;margin:10px 0"><select id="adminSaleReviewSale"></select><input id="adminSaleReviewSearch" placeholder="Search sale, customer, address, order, rep"><button id="adminSaleReviewRefresh" class="assign-btn">Refresh</button></div>
      <div id="adminSaleReviewBody" class="sale-credit-empty">Choose a sale to review.</div>
      <div style="text-align:right;margin-top:12px"><button id="adminSaleReviewClose" class="assign-btn">Close</button></div>
    </div>`;
    document.body.appendChild(panel);
    const close=()=>panel.style.display='none';
    document.getElementById('adminSaleReviewClose').onclick=close;document.getElementById('adminSaleReviewCloseTop').onclick=close;
    btn.onclick=async()=>{panel.style.display='flex';await load();};
    document.getElementById('adminSaleReviewRefresh').onclick=()=>load(true);
    document.getElementById('adminSaleReviewSearch').oninput=renderSaleOptions;
    document.getElementById('adminSaleReviewSale').onchange=()=>{state.selected=state.records.find(r=>r.sale?.id===document.getElementById('adminSaleReviewSale').value)||null;renderForm();};
  }

  async function load(force=false){
    const notice=document.getElementById('adminSaleReviewNotice');if(!force&&state.records.length){renderSaleOptions();renderForm();return;}
    notice.textContent='Loading sale records and provider evidence…';
    try{
      const records=[];let offset=0,total=0;
      do{const {data,error}=await sb.rpc('admin_sale_credit_dashboard_page',{p_limit:250,p_offset:offset});if(error)throw error;const page=Array.isArray(data?.rows)?data.rows:[];records.push(...page);total=Number(data?.total_count||0);offset+=page.length;if(!page.length)break;}while(offset<total);
      const [usersRes,bankRes]=await Promise.all([
        sb.from('app_user_access').select('email,display_name,role,active').eq('active',true).order('display_name'),
        sb.rpc('admin_unassigned_sales_bank')
      ]);
      if(usersRes.error)throw usersRes.error;if(bankRes.error)throw bankRes.error;
      state.records=records;state.users=usersRes.data||[];state.bank=Array.isArray(bankRes.data?.rows)?bankRes.data.rows:[];
      if(state.selected)state.selected=records.find(r=>r.sale?.id===state.selected.sale?.id)||null;
      notice.textContent=`Loaded ${records.length} sales. Save is atomic: if any validation fails, no review changes commit.`;
      renderSaleOptions();renderForm();
    }catch(error){notice.textContent=error?.message||'Unable to load Admin Sale Review.';}
  }

  function renderSaleOptions(){
    const select=document.getElementById('adminSaleReviewSale');if(!select)return;
    const q=(document.getElementById('adminSaleReviewSearch')?.value||'').trim().toLowerCase();
    const current=state.selected?.sale?.id||select.value;
    const rows=state.records.filter(r=>!q||JSON.stringify(r).toLowerCase().includes(q)).slice(0,500);
    select.innerHTML='<option value="">Choose sale…</option>'+rows.map(r=>{const s=r.sale||{};return `<option value="${esc(s.id)}" ${s.id===current?'selected':''}>${esc(s.rep_name||s.rep_email||'Unassigned')} · ${esc(s.isp||'ISP')} · ${esc(s.provider_order_number||s.customer_first_name||'No order')} · ${esc(s.service_address||'No address')}</option>`;}).join('');
  }

  function input(id,label,value,type='text') {return `<label style="display:grid;gap:4px;font-size:12px;font-weight:700">${label}<input id="${id}" type="${type}" value="${esc(value||'')}" style="padding:9px;border:1px solid #d1d5db;border-radius:8px"></label>`;}

  function renderForm(){
    const root=document.getElementById('adminSaleReviewBody');const record=state.selected;if(!root)return;
    if(!record){root.className='sale-credit-empty';root.innerHTML='Choose a sale to review.';return;}
    const s=record.sale||{};root.className='';
    const users=state.users.map(u=>`<option value="${esc(u.email)}" ${String(u.email).toLowerCase()===String(s.rep_email).toLowerCase()?'selected':''}>${esc(u.display_name||u.email)} · ${esc(u.email)} (${esc(u.role)})</option>`).join('');
    const providerRows=[];
    if(record.provider_account?.id)providerRows.push({...record.provider_account,current:true});
    for(const p of state.bank){if(!providerRows.some(x=>x.id===p.id)&&String(p.provider||'').toLowerCase()===String(s.isp||'').toLowerCase())providerRows.push(p);}
    const providers='<option value="">No provider evidence change</option>'+providerRows.slice(0,300).map(p=>`<option value="${esc(p.id)}" ${p.id===s.provider_sale_row_id?'selected':''}>${p.current?'CURRENT · ':''}${esc(p.provider||'ISP')} · ${esc(p.order_number||p.account_number||'No order')} · ${esc(p.customer_name||'Unknown')} · ${esc(p.service_address||'No address')}</option>`).join('');
    root.innerHTML=`
      <div style="padding:12px;border:1px solid #dbe4f0;border-radius:12px;background:#f8fafc"><strong>Original processor/current credit:</strong> ${esc(s.rep_name||s.rep_email||'Unknown')} &nbsp; <strong>Provider seller:</strong> ${esc(s.provider_reported_rep_name||s.provider_reported_rep_email||record.provider_account?.seller_name||'Not reported')}<br><span class="muted small">The credited user selected below is authoritative after save. Original processor/provider seller remain in audit/evidence fields.</span></div>
      <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:12px">
        <label style="display:grid;gap:4px;font-size:12px;font-weight:700">Authoritative credited user<select id="asrRep" style="padding:9px;border:1px solid #d1d5db;border-radius:8px"><option value="">Choose active user…</option>${users}</select></label>
        <label style="display:grid;gap:4px;font-size:12px;font-weight:700">Provider evidence<select id="asrProvider" style="padding:9px;border:1px solid #d1d5db;border-radius:8px">${providers}</select></label>
        ${input('asrFirst','Customer first name',s.customer_first_name)}${input('asrLast','Customer last name',s.customer_last_name)}
        ${input('asrPhone','Customer phone',s.customer_phone)}${input('asrEmail','Customer email',s.customer_email,'email')}
        ${input('asrAddress','Service address',s.service_address)}${input('asrOrder','Provider order number',s.provider_order_number)}
        ${input('asrAccount','Provider account number',s.provider_account_number)}${input('asrInstall','Install date',s.install_date,'date')}
        ${input('asrOrderDate','Order date',s.order_date,'date')}${input('asrIsp','Internet provider',s.isp)}
        ${input('asrProduct','Internet product',s.internet_product)}${input('asrSpeed','Internet speed Mbps',s.internet_speed_mbps,'number')}
      </div>
      <label style="display:grid;gap:4px;font-size:12px;font-weight:700;margin-top:10px">Notes<textarea id="asrNotes" rows="3" style="padding:9px;border:1px solid #d1d5db;border-radius:8px">${esc(s.notes||'')}</textarea></label>
      <div style="display:grid;grid-template-columns:minmax(260px,1fr) auto;gap:10px;margin-top:12px"><input id="asrReason" maxlength="500" placeholder="Admin correction/reassignment/approval reason required" style="padding:10px;border:1px solid #d1d5db;border-radius:8px"><button id="asrSave" class="primary">SAVE REVIEW &amp; APPROVE</button></div>
      <div class="muted small" style="margin-top:8px">Duplicate provider order/account identities, NOT A SALE records, cross-company users/evidence, incomplete required data, cancelled/abandoned evidence, or already-used provider evidence are rejected server-side.</div>`;
    document.getElementById('asrSave').onclick=save;
  }

  function val(id){return document.getElementById(id)?.value??'';}
  async function save(){
    const s=state.selected?.sale;if(!s)return;const rep=val('asrRep');const reason=val('asrReason').trim();
    if(!rep){document.getElementById('adminSaleReviewNotice').textContent='Choose the authoritative credited user.';return;}if(!reason){document.getElementById('adminSaleReviewNotice').textContent='Enter an Admin review reason.';return;}
    const corrections={
      customer_first_name:val('asrFirst'),customer_last_name:val('asrLast'),customer_phone:val('asrPhone'),customer_email:val('asrEmail'),service_address:val('asrAddress'),provider_order_number:val('asrOrder'),provider_account_number:val('asrAccount'),install_date:val('asrInstall'),order_date:val('asrOrderDate'),isp:val('asrIsp'),internet_product:val('asrProduct'),internet_speed_mbps:val('asrSpeed'),notes:val('asrNotes')
    };
    const button=document.getElementById('asrSave');button.disabled=true;button.textContent='SAVING…';
    try{
      const {data,error}=await sb.rpc('admin_review_sale_transaction',{p_sale_id:s.id,p_credited_rep_email:rep,p_reason:reason,p_provider_sale_row_id:val('asrProvider')||null,p_corrections:corrections});if(error)throw error;
      document.getElementById('adminSaleReviewNotice').textContent=`Sale verified and credited to ${data.rep_name||data.rep_email}. Customer/order corrections, provider evidence, rankings, and audit committed together.`;
      state.records=[];state.selected=null;await load(true);window.dispatchEvent(new CustomEvent('mccoy-sale-credit-changed',{detail:{saleId:s.id}}));window.dispatchEvent(new CustomEvent('mccoy-live-sales-changed',{detail:{saleId:s.id}}));
    }catch(error){document.getElementById('adminSaleReviewNotice').textContent=error?.message||'Admin Sale Review failed. No changes were committed.';button.disabled=false;button.textContent='SAVE REVIEW & APPROVE';}
  }

  const timer=setInterval(()=>{ensure();if(document.getElementById('adminSaleReviewBtn'))clearInterval(timer);},400);setTimeout(()=>clearInterval(timer),15000);
})();
