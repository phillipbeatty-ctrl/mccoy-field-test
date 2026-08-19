// V9.3 sale entry + sanitized live feed. Customer PII is submitted only to protected server functions.
(function(){
  const byId=id=>document.getElementById(id);
  const css=document.createElement('style');css.textContent=`
  .sales-strip{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:12px 0}.sales-card{border:1px solid #e5e7eb;border-radius:12px;padding:12px;background:#fff}.sales-feed{max-height:260px;overflow:auto}.feed-item{padding:10px 0;border-bottom:1px solid #eee;font-size:13px}.feed-item:last-child{border-bottom:0}.leader-row{display:flex;justify-content:space-between;padding:6px 0;font-size:13px}.sale-modal{position:fixed;inset:0;z-index:120000;background:rgba(17,24,39,.78);display:none;align-items:center;justify-content:center;padding:16px}.sale-modal.show{display:flex}.sale-form{width:min(620px,100%);max-height:92vh;overflow:auto;background:#fff;border-radius:16px;padding:20px}.sale-form h2{margin-top:0}.sale-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.sale-form input,.sale-form select,.sale-form textarea{width:100%;box-sizing:border-box;padding:10px;border:1px solid #d1d5db;border-radius:8px}.sale-checks{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:12px 0}.sale-checks label{padding:9px;background:#f8fafc;border-radius:8px;font-size:13px}.sale-actions{display:flex;gap:8px;margin-top:12px}.sale-actions button{min-height:44px;flex:1;touch-action:manipulation}.sale-msg-error{color:#991b1b!important;font-weight:700}.sale-msg-ok{color:#166534!important;font-weight:700}@media(max-width:650px){.sales-strip,.sale-grid{grid-template-columns:1fr}.sale-checks{grid-template-columns:1fr}}
  `;document.head.appendChild(css);

  let providerBar=byId('sessionIsp')?.closest('.sales-card');
  if(!providerBar){
    providerBar=document.createElement('div');providerBar.className='sales-card';providerBar.innerHTML=`<strong>Selling for</strong><select id="sessionIsp" style="margin-top:8px;width:100%;padding:9px"><option>Quantum</option><option>Brightspeed</option><option>AT&T</option><option>Other</option></select>`;
    const fieldSelect=byId('fieldLeadSelect');
    if(fieldSelect?.parentNode)fieldSelect.parentNode.insertBefore(providerBar,fieldSelect);
  }
  const ispSel=byId('sessionIsp');
  if(ispSel){
    const savedIsp=localStorage.getItem('mccoy_isp');
    ispSel.value=[...ispSel.options].some(o=>o.value===savedIsp)?savedIsp:'Quantum';
    ispSel.onchange=()=>localStorage.setItem('mccoy_isp',ispSel.value);
  }

  if(!byId('monthlyLeaders')){
    const social=document.createElement('div');social.className='sales-strip';social.innerHTML=`<div class="sales-card"><div style="display:flex;justify-content:space-between;gap:8px"><strong>🏆 Monthly Sales</strong><button type="button" id="salesRefreshBtn" class="assign-btn">Refresh</button></div><div id="monthlyLeaders" style="margin-top:8px">Loading…</div><button type="button" id="accountingDownloadBtn" class="assign-btn" style="display:none;margin-top:10px">Download Sales Ledger CSV</button></div><div class="sales-card"><strong>🎉 Live Wins</strong><div id="salesFeed" class="sales-feed" style="margin-top:8px">Loading…</div></div>`;
    const eff=byId('efficiencySummary');if(eff?.parentNode)eff.parentNode.insertBefore(social,eff);
  }

  let modal=byId('saleModal');
  if(!modal){
    modal=document.createElement('div');modal.className='sale-modal';modal.id='saleModal';modal.innerHTML=`<div class="sale-form"><h2>Log Sale</h2><p class="muted small">Customer details are stored privately for accounting/audit. They are never posted to the social feed.</p><div class="sale-grid"><input id="saleFirst" placeholder="Customer first name *"><input id="saleLast" placeholder="Customer last name *"><input id="salePhone" placeholder="Phone"><input id="saleEmail" type="email" placeholder="Email"><input id="saleAddress" placeholder="Service address *"><select id="saleInternetProduct"><option value="Internet">Internet</option><option value="Fiber">Fiber</option><option value="Internet Air">Internet Air</option><option value="None">No Internet</option></select><input id="saleSpeed" type="number" min="0" placeholder="Internet speed Mbps (e.g. 1000)"><input id="saleMobile" type="number" min="0" max="20" value="0" placeholder="AT&T mobile lines"></div><div class="sale-checks"><label><input id="saleDirectv" type="checkbox"> DIRECTV</label><label><input id="saleVivint" type="checkbox"> Vivint</label><label id="saleConfirmLabel"><input id="saleConfirm" type="checkbox"> Information reviewed</label></div><textarea id="saleNotes" rows="3" placeholder="Internal notes (optional)"></textarea><div id="saleMsg" class="muted small" role="status" aria-live="polite" style="margin-top:8px;min-height:16px"></div><div class="sale-actions"><button type="button" id="submitSaleBtn" class="primary">SAVE SALE</button><button type="button" id="cancelSaleBtn" class="assign-btn">Cancel</button></div></div>`;document.body.appendChild(modal);
  }

  const setSaleMsg=(text,type='')=>{const el=byId('saleMsg');if(!el)return;el.textContent=text;el.classList.remove('sale-msg-error','sale-msg-ok');if(type==='error')el.classList.add('sale-msg-error');if(type==='ok')el.classList.add('sale-msg-ok');};
  let pendingSaleBtn=null,submitting=false;
  document.addEventListener('click',(e)=>{
    const b=e.target?.closest?.('[data-disp="Sale"]');if(!b||window.MCCOY_SALE_CONFIRMED)return;
    e.preventDefault();e.stopImmediatePropagation();
    const s=(typeof state!=='undefined')?state:null;
    if(!s?.session){alert('Start Knocking first.');return;}
    if(!s?.activeDoorVisit){alert('Tap PHYSICALLY KNOCKED first.');return;}
    pendingSaleBtn=b;const lead=s.activeDoorVisit.lead;byId('saleAddress').value=lead?.address||lead?.fullAddress||'';setSaleMsg('');modal.classList.add('show');setTimeout(()=>byId('saleFirst')?.focus(),50);
  },true);

  function resetSaleForm(){
    ['saleFirst','saleLast','salePhone','saleEmail','saleSpeed','saleNotes'].forEach(id=>{const el=byId(id);if(el)el.value='';});
    if(byId('saleMobile'))byId('saleMobile').value='0';
    ['saleDirectv','saleVivint','saleConfirm'].forEach(id=>{const el=byId(id);if(el)el.checked=false;});
  }
  byId('cancelSaleBtn')?.addEventListener('click',()=>{if(submitting)return;pendingSaleBtn=null;setSaleMsg('');modal.classList.remove('show');});

  async function functionErrorDetail(error,data){
    let detail=data?.detail||data?.error||'';
    try{if(!detail&&error?.context?.clone){const j=await error.context.clone().json();detail=j?.detail||j?.error||'';}}catch(_){ }
    return String(detail||error?.message||'').replace(/_/g,' ').trim();
  }

  async function submitSale(e){
    e?.preventDefault?.();e?.stopPropagation?.();if(submitting)return;
    const first=byId('saleFirst')?.value.trim()||'',last=byId('saleLast')?.value.trim()||'',address=byId('saleAddress')?.value.trim()||'';
    if(!first||!last||!address){setSaleMsg('First name, last name, and service address are required.','error');(!first?byId('saleFirst'):!last?byId('saleLast'):byId('saleAddress'))?.focus();return;}
    if(!byId('saleConfirm')?.checked){setSaleMsg('Check “Information reviewed” before saving the sale.','error');byId('saleConfirmLabel')?.scrollIntoView?.({block:'nearest'});return;}
    if(!ispSel?.value){setSaleMsg('Choose the ISP for this sale.','error');return;}

    const btn=byId('submitSaleBtn');submitting=true;if(btn){btn.disabled=true;btn.textContent='SAVING…';}setSaleMsg('Saving sale…');
    try{
      const {data:sessionData,error:sessionError}=await sb.auth.getSession();
      if(sessionError||!sessionData?.session)throw new Error('Your sign-in session expired. Sign in again and retry.');
      const s=(typeof state!=='undefined')?state:null,lead=s?.activeDoorVisit?.lead;
      const sessionId=(typeof telemetrySessionId!=='undefined'&&telemetrySessionId)?telemetrySessionId:null;
      const speedRaw=Number(byId('saleSpeed')?.value||0),mobileRaw=Number(byId('saleMobile')?.value||0);
      const body={session_id:sessionId,lead_label:lead?.address||lead?.fullAddress||null,customer_first_name:first,customer_last_name:last,customer_phone:byId('salePhone')?.value.trim()||null,customer_email:byId('saleEmail')?.value.trim()||null,service_address:address,isp:ispSel.value,internet_product:byId('saleInternetProduct')?.value||'Internet',internet_speed_mbps:Number.isFinite(speedRaw)&&speedRaw>0?Math.round(speedRaw):null,att_mobile_lines:Number.isFinite(mobileRaw)?Math.max(0,Math.min(20,Math.round(mobileRaw))):0,directv:!!byId('saleDirectv')?.checked,vivint:!!byId('saleVivint')?.checked,notes:byId('saleNotes')?.value.trim()||null};
      const invokePromise=sb.functions.invoke('sale-submit',{body});
      const timeoutPromise=new Promise((_,reject)=>setTimeout(()=>reject(new Error('Sale save timed out. Check connection and retry.')),20000));
      const {data,error}=await Promise.race([invokePromise,timeoutPromise]);
      if(error||!data?.ok){const detail=await functionErrorDetail(error,data);throw new Error(detail?`Sale could not be saved: ${detail}`:'Sale could not be saved. Check connection and try again.');}
      setSaleMsg('Sale saved.','ok');modal.classList.remove('show');resetSaleForm();
      const b=pendingSaleBtn;pendingSaleBtn=null;window.MCCOY_SALE_CONFIRMED=true;try{b?.click();}finally{window.MCCOY_SALE_CONFIRMED=false;}
      await loadFeed();
      window.dispatchEvent(new CustomEvent('mccoy-sale-saved',{detail:{saleId:data.sale_id||null}}));
    }catch(err){console.error('SAVE SALE failed',err);setSaleMsg(err?.message||'Sale could not be saved. Check connection and try again.','error');}
    finally{submitting=false;if(btn){btn.disabled=false;btn.textContent='SAVE SALE';}}
  }
  byId('submitSaleBtn')?.addEventListener('click',submitSale);

  async function loadFeed(){
    if(!window.MCCOY_ACCESS?.user)return;const start=new Date();start.setDate(1);start.setHours(0,0,0,0);
    try{const {data,error}=await sb.from('sales_feed').select('created_at,rep_user_id,rep_name,isp,directv,att_mobile_lines,vivint,message').gte('created_at',start.toISOString()).order('created_at',{ascending:false}).limit(100);if(error)throw error;const rows=data||[];
      if(byId('salesFeed'))byId('salesFeed').innerHTML=rows.slice(0,20).map(r=>`<div class="feed-item"><strong>${r.message}</strong><div class="muted small">${new Date(r.created_at).toLocaleString()}</div></div>`).join('')||'<div class="muted small">No sales posted this month yet.</div>';
      const m=new Map();for(const r of rows){const x=m.get(r.rep_user_id)||{name:r.rep_name,sales:0,mobile:0,directv:0,vivint:0};x.sales++;x.mobile+=r.att_mobile_lines||0;x.directv+=r.directv?1:0;x.vivint+=r.vivint?1:0;m.set(r.rep_user_id,x);}const leaders=[...m.values()].sort((a,b)=>b.sales-a.sales);
      if(byId('monthlyLeaders'))byId('monthlyLeaders').innerHTML=leaders.slice(0,10).map((x,i)=>`<div class="leader-row"><span>${i+1}. ${x.name}</span><strong>${x.sales} sale${x.sales===1?'':'s'}</strong></div><div class="muted small">${x.mobile} mobile lines · ${x.directv} DIRECTV · ${x.vivint} Vivint</div>`).join('')||'<div class="muted small">No monthly totals yet.</div>';
    }catch(err){console.error('Sales feed refresh failed',err);}
  }
  byId('salesRefreshBtn')?.addEventListener('click',loadFeed);

  async function downloadLedger(){try{const {data:{session}}=await sb.auth.getSession();if(!session){alert('Sign in again before downloading the sales ledger.');return;}const resp=await fetch(SUPABASE_URL+'/functions/v1/accounting-sales?format=csv',{headers:{Authorization:'Bearer '+session.access_token,apikey:SUPABASE_PUBLISHABLE_KEY}});if(!resp.ok)throw new Error('Accounting export failed.');const blob=await resp.blob(),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='mccoy-sales-ledger.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(err){console.error(err);alert(err?.message||'Accounting export failed.');}}
  byId('accountingDownloadBtn')?.addEventListener('click',downloadLedger);

  const authPoll=setInterval(()=>{const a=window.MCCOY_ACCESS?.access;if(!a)return;clearInterval(authPoll);if(a.role==='admin'&&byId('accountingDownloadBtn'))byId('accountingDownloadBtn').style.display='inline-block';loadFeed();sb.channel('mccoy-sales-feed').on('postgres_changes',{event:'INSERT',schema:'public',table:'sales_feed'},()=>loadFeed()).subscribe();},400);
})();
