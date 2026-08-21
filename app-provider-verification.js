// Provider report ingestion: rep-account evidence is preliminary and dealer-account
// evidence is authoritative for rankings, pay progress, and cancellation tracking.
(function(){
  const providers=['Quantum','Brightspeed','AT&T','T-Mobile / T-Fiber','Kinetic','Fidium','Ascend Fiber','Lightcurve','Ripple Fiber','Starlink','DIRECTV','Vivint','Other'];
  const dealerProviders=['Mixed / Auto-detect',...providers];
  const reportUrls={Brightspeed:'https://bass.docxtract.com/Report/Orders_Report.aspx'};
  const esc=value=>String(value??'').replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
  const label=value=>String(value||'').replace(/_/g,' ').replace(/\b\w/g,letter=>letter.toUpperCase());

  const css=document.createElement('style');
  css.textContent=`
    #providerVerificationBtn{position:fixed;right:14px;bottom:146px;z-index:2600;display:none;border:0;border-radius:999px;padding:9px 13px;background:#111827;color:#fff;font-size:12px;cursor:pointer}
    #providerVerificationPanel{position:fixed;inset:0;z-index:145000;background:rgba(17,24,39,.78);display:none;align-items:center;justify-content:center;padding:16px}
    #providerVerificationPanel.show{display:flex}.pv-card{width:min(1080px,100%);max-height:94vh;overflow:auto;background:#fff;border-radius:16px;padding:20px}
    .pv-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}.pv-section{border:1px solid #e5e7eb;border-radius:12px;padding:14px}.pv-section h3{margin:0 0 8px}
    .pv-section input,.pv-section select{width:100%;box-sizing:border-box;padding:9px;margin:5px 0;border:1px solid #d1d5db;border-radius:8px}.pv-period{display:grid;grid-template-columns:1fr 1fr;gap:8px}.pv-period label{font-size:11px;font-weight:800;color:#374151}
    .pv-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}.pv-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:10px 0}.pv-stat{border:1px solid #e5e7eb;border-radius:9px;padding:9px}.pv-stat span{display:block;font-size:10px;color:#6b7280}.pv-stat strong{font-size:18px}
    .pv-table-wrap{overflow:auto}.pv-table{width:100%;border-collapse:collapse;font-size:12px}.pv-table th,.pv-table td{text-align:left;padding:7px;border-bottom:1px solid #eee;vertical-align:top}.pv-msg{font-size:12px;color:#4b5563;margin-top:8px}.pv-warn{color:#92400e;font-weight:700}.pv-good{color:#166534;font-weight:700}
    .pv-authority-note{border-left:4px solid #2563eb;background:#eff6ff;padding:10px 12px;border-radius:8px;margin:10px 0;font-size:12px}.pv-report-link{display:none;text-align:center;text-decoration:none;margin-top:5px}
    @media(max-width:760px){.pv-grid,.pv-stats,.pv-period{grid-template-columns:1fr}}
  `;
  document.head.appendChild(css);

  const btn=document.createElement('button');
  btn.id='providerVerificationBtn';btn.type='button';btn.textContent='Provider Reports';
  document.body.appendChild(btn);

  const panel=document.createElement('div');
  panel.id='providerVerificationPanel';
  panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-labelledby','pvTitle');
  panel.innerHTML=`
    <div class="pv-card">
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:center">
        <div><h2 id="pvTitle" style="margin:0">Provider Sales Reports</h2><div id="pvSubtitle" class="muted small">Upload the report from the same seller account used to process the sale.</div></div>
        <button type="button" id="pvClose" class="assign-btn">Close</button>
      </div>
      <div class="pv-authority-note"><strong>Two-level verification:</strong> your seller-account report records preliminary provider evidence. Rankings and pay progress remain locked until the order is verified against the dealer-level report or another approved authoritative provider feed.</div>
      <div class="pv-grid">
        <div class="pv-section">
          <h3>My Seller-Account Report</h3>
          <p class="muted small">Download a CSV from the provider account you used for the orders, choose the exact report date range, and upload it here. McCoy records your authenticated account provenance and prevents duplicate file imports.</p>
          <select id="pvRepProvider" aria-label="Provider for my seller-account report">${providers.map(provider=>`<option>${provider}</option>`).join('')}</select>
          <a id="pvRepReportLink" class="assign-btn pv-report-link" href="https://bass.docxtract.com/Report/Orders_Report.aspx" target="_blank" rel="noopener noreferrer">OPEN BASS ORDERS REPORT</a>
          <div class="pv-period"><label>Report start<input id="pvRepStart" type="date"></label><label>Report end<input id="pvRepEnd" type="date"></label></div>
          <input id="pvRepCsv" type="file" accept=".csv,text/csv">
          <button type="button" id="pvRepImport" class="primary" style="width:100%;margin-top:5px">UPLOAD MY REPORT</button>
          <div id="pvRepMsg" class="pv-msg" role="status" aria-live="polite"></div>
        </div>
        <div class="pv-section">
          <h3>My Report Status</h3>
          <div id="pvMyStats" class="pv-stats"></div>
          <div id="pvMyImports" class="pv-msg">Loading…</div>
        </div>
      </div>

      <div id="pvAdminOnly" hidden>
        <div class="pv-grid" style="margin-top:14px">
          <div class="pv-section">
            <h3>Dealer-Level ISP Report</h3>
            <p class="muted small">Upload the authoritative dealer export. Every import automatically cross-references rep-account evidence and rechecks recorded sales. Enter the exact report coverage dates before treating missing orders as discrepancies.</p>
            <select id="pvDealerProvider">${dealerProviders.map(provider=>`<option>${provider}</option>`).join('')}</select>
            <a id="pvDealerReportLink" class="assign-btn pv-report-link" href="https://bass.docxtract.com/Report/Orders_Report.aspx" target="_blank" rel="noopener noreferrer">OPEN CORPORATE BASS ORDERS REPORT</a>
            <div class="pv-period"><label>Coverage start<input id="pvDealerStart" type="date"></label><label>Coverage end<input id="pvDealerEnd" type="date"></label></div>
            <input id="pvDealerCsv" type="file" accept=".csv,text/csv">
            <div class="pv-actions"><button type="button" id="pvDealerImport" class="primary">IMPORT & VERIFY</button><button type="button" id="pvCrossReference" class="assign-btn">CROSS-REFERENCE REPORTS</button><button type="button" id="pvReconcile" class="assign-btn">RECHECK SALES</button></div>
            <div id="pvDealerMsg" class="pv-msg" role="status" aria-live="polite"></div>
            <div id="pvImports" class="pv-msg"></div>
          </div>
          <div class="pv-section">
            <h3>Link Seller Identity</h3>
            <p class="muted small">Link the seller ID, email, or display name shown in the dealer report to the correct McCoy user. Rep-uploaded files never create this authoritative link.</p>
            <input id="pvRepEmail" type="email" placeholder="McCoy rep email">
            <select id="pvLinkProvider">${providers.map(provider=>`<option>${provider}</option>`).join('')}</select>
            <input id="pvSellerId" placeholder="Seller ID / dashboard rep identifier">
            <input id="pvSellerName" placeholder="Seller display name (optional)">
            <button type="button" id="pvLink" class="primary" style="width:100%;margin-top:5px">LINK SELLER ACCOUNT</button>
            <div id="pvLinkMsg" class="pv-msg"></div>
          </div>
        </div>

        <div class="pv-section" style="margin-top:14px">
          <h3>Verification Summary</h3><div id="pvStats" class="pv-stats"></div>
        </div>
        <div class="pv-section" style="margin-top:14px">
          <div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><div><h3>Rep / Dealer Discrepancies</h3><p class="muted small">Orders found in a rep report but missing from—or conflicting with—the covered dealer report remain blocked from rankings and pay progress.</p></div><button type="button" id="pvRefresh" class="assign-btn">Refresh</button></div>
          <div id="pvDiscrepancies">Loading…</div>
        </div>
        <div class="pv-section" style="margin-top:14px">
          <h3>Dashboard Sale Capture Queue</h3><p class="muted small">Opening BASS, ASAP, or another provider dashboard creates a durable capture. Rows needing details identify provider sales that a rep has not finished saving in McCoy.</p>
          <div id="pvCaptureStats" class="pv-stats"></div><div id="pvCaptures">Loading…</div>
        </div>
        <div class="pv-section" style="margin-top:14px">
          <h3>Low Potential Sale Bank</h3><p class="muted small">Sales without enough provider evidence stay here until reports or an Admin-approved exception resolve them.</p><div id="pvLowPotential">Loading…</div>
        </div>
      </div>
    </div>`;
  document.body.appendChild(panel);

  async function call(action,payload={}){
    const {data,error}=await sb.functions.invoke('provider-reconcile',{body:{action,...payload}});
    if(error)throw error;if(!data?.ok)throw new Error(data?.detail||data?.error||'provider_reconcile_failed');return data;
  }
  async function captureCall(action,payload={}){
    const {data,error}=await sb.functions.invoke('provider-sale-capture',{body:{action,...payload}});
    if(error)throw error;if(!data?.ok)throw new Error(data?.detail||data?.error||'provider_sale_capture_failed');return data;
  }
  function statsHtml(items,counts={}){
    return items.map(([key,name])=>`<div class="pv-stat"><span>${name}</span><strong>${Number(counts[key]||0).toLocaleString()}</strong></div>`).join('');
  }
  function syncReportLink(selectId,linkId){
    const provider=document.getElementById(selectId)?.value;
    const link=document.getElementById(linkId);const url=reportUrls[provider];
    if(!link)return;link.style.display=url?'block':'none';if(url)link.href=url;
  }
  function setDefaultPeriod(prefix){
    const end=new Date();const start=new Date(end);start.setDate(start.getDate()-30);
    const iso=date=>date.toISOString().slice(0,10);
    const startInput=document.getElementById(`${prefix}Start`),endInput=document.getElementById(`${prefix}End`);
    if(startInput&&!startInput.value)startInput.value=iso(start);if(endInput&&!endInput.value)endInput.value=iso(end);
  }
  function importHistory(imports=[]){
    return imports.length?imports.slice(0,8).map(item=>{
      const scope=item.source_scope==='dealer_account'?'Dealer':(item.source_rep_email||'My account');
      const period=item.report_period_start&&item.report_period_end?`${item.report_period_start}–${item.report_period_end}`:'period not supplied';
      return `${esc(item.source_provider||'Mixed')} · ${esc(scope)} · ${Number(item.mapped_row_count||0).toLocaleString()} mapped · ${esc(period)} · ${new Date(item.created_at).toLocaleString()}`;
    }).join('<br>'):'No provider reports imported yet.';
  }
  async function loadMyReports(){
    const data=await call('my_overview');
    document.getElementById('pvMyStats').innerHTML=statsHtml([
      ['pending_dealer','Pending Dealer'],['matched_dealer','Matched'],['missing_from_dealer','Missing'],['conflict','Conflict']
    ],data.counts);
    document.getElementById('pvMyImports').innerHTML=importHistory(data.imports);
  }
  async function loadAdmin(){
    const [data,capturesData]=await Promise.all([call('overview'),captureCall('list')]);
    document.getElementById('pvStats').innerHTML=statsHtml([
      ['verified_processed','Verified'],['low_potential','Low Potential'],['pending_verification','Pending'],['mismatch','Mismatch']
    ],data.counts);
    document.getElementById('pvImports').innerHTML=importHistory(data.imports);
    const discrepancies=data.discrepancies||[];
    document.getElementById('pvDiscrepancies').innerHTML=discrepancies.length?`<div class="pv-table-wrap"><table class="pv-table"><thead><tr><th>Rep</th><th>Provider</th><th>Order / Account</th><th>Sale Date</th><th>Result</th></tr></thead><tbody>${discrepancies.map(item=>`<tr><td>${esc(item.source_rep_email||'—')}</td><td>${esc(item.provider)}</td><td>${esc(item.order_number||'—')}<br>${esc(item.account_number||'—')}</td><td>${item.sale_date?new Date(item.sale_date).toLocaleDateString():'—'}</td><td class="pv-warn">${esc(label(item.cross_reference_status))}</td></tr>`).join('')}</tbody></table></div>`:'<div class="muted small">No rep/dealer discrepancies in the currently covered report periods.</div>';

    const captures=capturesData.captures||[];
    document.getElementById('pvCaptureStats').innerHTML=statsHtml([
      ['dashboard_opened','Dashboard Open'],['details_required','Needs Details'],['recorded','Recorded'],['cancelled','Cancelled']
    ],capturesData.counts);
    document.getElementById('pvCaptures').innerHTML=captures.length?`<div class="pv-table-wrap"><table class="pv-table"><thead><tr><th>Rep</th><th>Provider</th><th>Address</th><th>Capture</th><th>Verification</th><th>Started</th></tr></thead><tbody>${captures.slice(0,100).map(item=>{const sale=Array.isArray(item.sales_records)?item.sales_records[0]:item.sales_records;return`<tr><td>${esc(item.rep_name||item.rep_email)}</td><td>${esc(item.provider)}</td><td>${esc(item.service_address||'—')}</td><td class="${item.status==='details_required'||item.status==='dashboard_opened'?'pv-warn':''}">${esc(label(item.status))}</td><td>${esc(label(sale?.verification_status||'Not saved'))}</td><td>${new Date(item.created_at).toLocaleString()}</td></tr>`;}).join('')}</tbody></table></div>`:'<div class="muted small">No provider dashboard captures yet.</div>';
    const lows=data.low_potential||[];
    document.getElementById('pvLowPotential').innerHTML=lows.length?`<div class="pv-table-wrap"><table class="pv-table"><thead><tr><th>Rep</th><th>Provider</th><th>Address</th><th>Order / Account</th><th>Reason</th></tr></thead><tbody>${lows.map(item=>`<tr><td>${esc(item.rep_name||item.rep_email)}</td><td>${esc(item.isp)}</td><td>${esc(item.service_address)}</td><td>${esc(item.provider_order_number||'—')}<br>${esc(item.provider_account_number||'—')}</td><td class="pv-warn">${esc(label(item.verification_reason))}</td></tr>`).join('')}</tbody></table></div>`:'<div class="muted small">No low-potential sales currently in the bank.</div>';
  }
  async function load(){
    try{await loadMyReports();if(window.MCCOY_ACCESS?.access?.role==='admin')await loadAdmin();}
    catch(error){console.error(error);document.getElementById('pvMyImports').textContent='Unable to load provider report data.';}
  }
  async function upload(scope){
    const rep=scope==='rep_account';const prefix=rep?'pvRep':'pvDealer';const message=document.getElementById(`${prefix}Msg`);
    const file=document.getElementById(`${prefix}Csv`).files?.[0];if(!file){message.textContent='Choose a CSV report first.';return;}
    const start=document.getElementById(`${prefix}Start`).value,end=document.getElementById(`${prefix}End`).value;
    if(!start||!end){message.textContent='Enter the exact report start and end dates.';return;}
    const button=document.getElementById(`${prefix}Import`);button.disabled=true;const prior=button.textContent;button.textContent='IMPORTING…';
    try{
      const provider=document.getElementById(`${prefix}Provider`).value;
      const data=await call('upload_csv',{source_scope:scope,filename:file.name,csv_text:await file.text(),provider:provider==='Mixed / Auto-detect'?null:provider,report_period_start:start,report_period_end:end});
      if(data.duplicate)message.textContent='This exact report was already imported; no duplicate rows were created.';
      else if(rep)message.textContent=`Imported ${data.rows.toLocaleString()} rows; ${data.mapped.toLocaleString()} contained order/account identifiers. Matching sales are preliminary until dealer verification.`;
      else{const cross=data.cross_reference||{};message.textContent=`Imported ${data.rows.toLocaleString()} dealer rows; ${data.verified_after_import.toLocaleString()} sales now verify. Rep cross-reference: ${Number(cross.matched_dealer||0).toLocaleString()} matched, ${Number(cross.missing_from_dealer||0).toLocaleString()} missing, ${Number(cross.conflict||0).toLocaleString()} conflicts.`;}
      await load();
    }catch(error){console.error(error);message.textContent='Import failed: '+(error?.message||error);}
    finally{button.disabled=false;button.textContent=prior;}
  }

  document.getElementById('pvClose').onclick=()=>panel.classList.remove('show');
  btn.onclick=async()=>{panel.classList.add('show');await load();};
  document.getElementById('pvRepImport').onclick=()=>upload('rep_account');
  document.getElementById('pvDealerImport').onclick=()=>upload('dealer_account');
  document.getElementById('pvRepProvider').addEventListener('change',()=>syncReportLink('pvRepProvider','pvRepReportLink'));
  document.getElementById('pvDealerProvider').addEventListener('change',()=>syncReportLink('pvDealerProvider','pvDealerReportLink'));
  document.getElementById('pvRefresh').onclick=load;
  document.getElementById('pvCrossReference').onclick=async()=>{const button=document.getElementById('pvCrossReference'),message=document.getElementById('pvDealerMsg');button.disabled=true;try{const data=await call('cross_reference_all');const cross=data.cross_reference||{};message.textContent=`Checked ${data.imports_checked.toLocaleString()} dealer imports: ${Number(cross.matched_dealer||0).toLocaleString()} matched, ${Number(cross.missing_from_dealer||0).toLocaleString()} missing, ${Number(cross.conflict||0).toLocaleString()} conflicts.`;await load();}catch(error){message.textContent='Cross-reference failed: '+(error?.message||error);}finally{button.disabled=false;}};
  document.getElementById('pvReconcile').onclick=async()=>{const button=document.getElementById('pvReconcile'),message=document.getElementById('pvDealerMsg');button.disabled=true;try{const data=await call('reconcile_all');message.textContent=`Rechecked ${data.total.toLocaleString()} sales.`;await load();}catch(error){message.textContent='Reconciliation failed: '+(error?.message||error);}finally{button.disabled=false;}};
  document.getElementById('pvLink').onclick=async()=>{const message=document.getElementById('pvLinkMsg');try{await call('link_seller',{rep_email:document.getElementById('pvRepEmail').value.trim(),provider:document.getElementById('pvLinkProvider').value,seller_identifier:document.getElementById('pvSellerId').value.trim(),seller_name:document.getElementById('pvSellerName').value.trim()||null});message.textContent='Seller identity linked. Recheck sales to apply the authoritative link.';}catch(error){message.textContent='Could not link seller identity: '+(error?.message||error);}};
  syncReportLink('pvRepProvider','pvRepReportLink');syncReportLink('pvDealerProvider','pvDealerReportLink');setDefaultPeriod('pvRep');setDefaultPeriod('pvDealer');
  window.addEventListener('mccoy-sale-saved',()=>{if(panel.classList.contains('show'))setTimeout(load,100);});
  const timer=setInterval(()=>{const access=window.MCCOY_ACCESS?.access;if(!access)return;btn.style.display=access.active===false?'none':'block';if(access.role==='admin'){btn.textContent='Provider Verification';document.getElementById('pvAdminOnly').hidden=false;document.getElementById('pvSubtitle').textContent='Rep-account reports provide preliminary evidence; dealer-level ISP reports remain authoritative.';}clearInterval(timer);},400);
})();
