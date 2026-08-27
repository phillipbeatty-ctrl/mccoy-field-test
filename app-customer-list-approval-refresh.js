// Admin Customer List controls: edit approved sales in place and return them to SALE REVIEW without a page-wide observer.
(function(){
  const speedOptions=[[200,'200 Mbps'],[300,'300 Mbps'],[500,'500 Mbps'],[600,'600 Mbps'],[940,'940 Mbps'],[1000,'1 GIG'],[2000,'2 GIG'],[3000,'3 GIG'],[5000,'5 GIG'],[8000,'8 GIG'],[10000,'10 GIG']];
  const state={records:[],users:[],loading:false,activeSale:null};
  const byId=id=>document.getElementById(id);
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const normalized=value=>String(value||'').trim().toLowerCase();
  const isAdmin=()=>window.MCCOY_ACCESS?.access?.role==='admin';
  const dateValue=value=>String(value||'').slice(0,10);

  const css=document.createElement('style');
  css.textContent=`
    #customerRows td:last-child{min-width:170px}.customer-admin-actions{display:flex;gap:6px;flex-wrap:wrap}.customer-edit{white-space:nowrap;background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe;border-radius:8px;padding:7px 9px;cursor:pointer}.customer-edit:disabled,.customer-remove:disabled{opacity:.6;cursor:wait}
    #customerEditPanel{position:fixed;inset:0;z-index:160200;display:none;align-items:center;justify-content:center;padding:16px;background:rgba(15,23,42,.78)}#customerEditPanel.show{display:flex}.customer-edit-card{width:min(980px,100%);max-height:92vh;overflow:auto;background:#fff;border-radius:14px;padding:18px;box-shadow:0 18px 48px rgba(0,0,0,.28)}.customer-edit-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.customer-edit-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:14px}.customer-edit-grid label{display:grid;gap:4px;font-size:11px;font-weight:800}.customer-edit-grid input,.customer-edit-grid select,.customer-edit-grid textarea{box-sizing:border-box;width:100%;min-width:0;padding:9px;border:1px solid #d1d5db;border-radius:8px;background:#fff;font:inherit}.customer-edit-wide{grid-column:1/-1}.customer-edit-actions{display:flex;justify-content:flex-end;gap:8px;align-items:center;margin-top:14px}.customer-edit-message{margin-right:auto;font-size:12px;color:#64748b}@media(max-width:900px){.customer-edit-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:620px){.customer-edit-grid{grid-template-columns:1fr}.customer-edit-actions{flex-wrap:wrap}}
  `;
  document.head.appendChild(css);

  function ensureEditor(){
    let panel=byId('customerEditPanel');
    if(panel)return panel;
    panel=document.createElement('div');
    panel.id='customerEditPanel';
    panel.innerHTML='<div class="customer-edit-card"><div id="customerEditBody"></div></div>';
    document.body.appendChild(panel);
    panel.addEventListener('click',event=>{if(event.target===panel)closeEditor();});
    return panel;
  }

  function setCustomerMessage(text,error=false){
    const message=byId('customerListMessage');
    if(message){message.textContent=text;message.style.color=error?'#991b1b':'';}
  }

  async function fetchCustomerRecords(){
    if(!isAdmin()||state.loading)return state.records;
    state.loading=true;
    try{
      const {data,error}=await sb.functions.invoke('accounting-records',{body:{action:'customer_list'}});
      if(error)throw error;
      if(!data?.ok)throw new Error(data?.error||'customer_list_failed');
      state.records=Array.isArray(data.records)?data.records:[];
      patchRows();
      return state.records;
    }catch(error){
      console.error('Customer List Admin controls failed to load records',error);
      return state.records;
    }finally{
      state.loading=false;
    }
  }

  async function fetchUsers(){
    if(state.users.length)return state.users;
    const {data,error}=await sb.from('app_user_access').select('email,display_name,role,active').eq('active',true).order('display_name');
    if(error)throw error;
    state.users=data||[];
    return state.users;
  }

  async function fetchFullSale(saleId){
    const {data,error}=await sb.rpc('admin_all_sales_feed');
    if(error)throw error;
    const rows=Array.isArray(data?.rows)?data.rows:[];
    const sale=rows.find(item=>item.id===saleId);
    if(!sale)throw new Error('Sale not found in Admin organization.');
    return sale;
  }

  function findSaleForRow(row){
    const cells=[...row.querySelectorAll('td')].slice(0,6).map(cell=>normalized(cell.textContent));
    const joined=cells.join(' | ');
    let match=state.records.find(item=>item.provider_order_number&&joined.includes(normalized(item.provider_order_number)));
    if(match)return match;
    match=state.records.find(item=>item.provider_account_number&&joined.includes(normalized(item.provider_account_number)));
    if(match)return match;
    const address=normalized(cells[2]);
    const customer=normalized(cells[0].split('ordered ')[0]);
    match=state.records.find(item=>normalized(item.service_address)===address&&normalized(`${item.customer_first_name||''} ${item.customer_last_name||''}`)===customer);
    if(match)return match;
    return state.records.find(item=>item.service_address&&joined.includes(normalized(item.service_address)))||null;
  }

  function patchRows(){
    if(!isAdmin())return;
    const scope=byId('customerListScope');
    if(scope)scope.textContent='Approved sales stay in Customer List while Admin edits them. NOT A SALE immediately returns a sale to SALE REVIEW; REJECT there moves it to TRASH.';
    document.querySelectorAll('#customerRows tr').forEach(row=>{
      const remove=row.querySelector('button.customer-remove');
      if(!remove)return;
      const sale=findSaleForRow(row);
      if(sale?.id){remove.dataset.saleId=sale.id;row.dataset.saleId=sale.id;}
      remove.textContent='NOT A SALE';
      remove.setAttribute('aria-label','Return this sale to Admin SALE REVIEW');
      remove.title='Return to SALE REVIEW without deleting customer information';
      const actionCell=remove.closest('td');
      if(!actionCell)return;
      let actions=actionCell.querySelector('.customer-admin-actions');
      if(!actions){
        actions=document.createElement('div');
        actions.className='customer-admin-actions';
        actionCell.appendChild(actions);
      }
      if(remove.parentElement!==actions)actions.appendChild(remove);
      let edit=actions.querySelector('button.customer-edit');
      if(!edit){
        edit=document.createElement('button');
        edit.type='button';
        edit.className='customer-edit';
        edit.textContent='EDIT';
        actions.insertBefore(edit,remove);
      }
      if(sale?.id)edit.dataset.saleId=sale.id;
      edit.setAttribute('aria-label','Edit this approved customer sale');
    });
  }

  function option(value,label,current){return `<option value="${esc(value)}" ${String(value)===String(current??'')?'selected':''}>${esc(label)}</option>`;}

  async function openEditor(saleId){
    const panel=ensureEditor(),body=byId('customerEditBody');
    panel.classList.add('show');
    body.innerHTML='<div class="muted">Loading approved sale…</div>';
    try{
      const [sale,users]=await Promise.all([fetchFullSale(saleId),fetchUsers()]);
      state.activeSale=sale;
      body.innerHTML=`
        <div class="customer-edit-head"><div><h2 style="margin:0">Edit Customer Sale</h2><p class="muted" style="margin:5px 0 0">Corrections save to this approved sale without removing it from Customer List.</p></div><button id="customerEditClose" class="assign-btn" type="button">Close</button></div>
        <div class="customer-edit-grid">
          <label>Credited user<select id="customerEditRep"><option value="">Keep current user</option>${users.map(user=>option(user.email,`${user.display_name||user.email} · ${user.role}`,normalized(user.email)===normalized(sale.rep_email)?user.email:null)).join('')}</select></label>
          <label>Customer first name<input data-customer-edit="customer_first_name" value="${esc(sale.customer_first_name)}"></label>
          <label>Customer last name<input data-customer-edit="customer_last_name" value="${esc(sale.customer_last_name)}"></label>
          <label>Phone<input data-customer-edit="customer_phone" value="${esc(sale.customer_phone)}"></label>
          <label>Email<input data-customer-edit="customer_email" type="email" value="${esc(sale.customer_email)}"></label>
          <label class="customer-edit-wide">Service address<input data-customer-edit="service_address" value="${esc(sale.service_address)}"></label>
          <label>Provider order number<input data-customer-edit="provider_order_number" value="${esc(sale.provider_order_number)}"></label>
          <label>Provider account number<input data-customer-edit="provider_account_number" value="${esc(sale.provider_account_number)}"></label>
          <label>ISP<input data-customer-edit="isp" value="${esc(sale.isp)}"></label>
          <label>Order date<input data-customer-edit="order_date" type="date" value="${esc(dateValue(sale.order_date))}"></label>
          <label>Install date<input data-customer-edit="install_date" type="date" value="${esc(dateValue(sale.install_date))}"></label>
          <label>Internet speed<select data-customer-edit="internet_speed_mbps"><option value="">Choose speed…</option>${speedOptions.map(([value,label])=>option(value,label,Number(sale.internet_speed_mbps)||'')).join('')}</select></label>
          <label>VoIP home-phone lines<input data-customer-edit="voip_home_phone_lines" type="number" min="0" value="${esc(sale.voip_home_phone_lines)}"></label>
          <label>Mobile lines<input data-customer-edit="mobile_phone_lines" type="number" min="0" value="${esc(sale.mobile_phone_lines)}"></label>
          <label>DIRECTV service<input data-customer-edit="directv_service" value="${esc(sale.directv_service)}"></label>
          <label>Vivint service<input data-customer-edit="vivint_service" value="${esc(sale.vivint_service)}"></label>
          <label class="customer-edit-wide">Notes<textarea data-customer-edit="notes" rows="4">${esc(sale.notes)}</textarea></label>
        </div>
        <div class="customer-edit-actions"><span id="customerEditMessage" class="customer-edit-message">This sale remains approved and stays in Customer List.</span><button id="customerEditCancel" class="assign-btn" type="button">CANCEL</button><button id="customerEditSave" class="primary" type="button">SAVE CHANGES</button></div>`;
      byId('customerEditClose').onclick=closeEditor;
      byId('customerEditCancel').onclick=closeEditor;
      byId('customerEditSave').onclick=saveEditor;
    }catch(error){
      body.innerHTML=`<div class="customer-edit-head"><div><h2 style="margin:0">Edit Customer Sale</h2><p class="muted" style="color:#991b1b">${esc(error?.message||'Unable to load this sale.')}</p></div><button id="customerEditClose" class="assign-btn" type="button">Close</button></div>`;
      byId('customerEditClose').onclick=closeEditor;
    }
  }

  function closeEditor(){
    byId('customerEditPanel')?.classList.remove('show');
    state.activeSale=null;
  }

  async function saveEditor(){
    const sale=state.activeSale,button=byId('customerEditSave'),message=byId('customerEditMessage');
    if(!sale||!button)return;
    const changes={};
    document.querySelectorAll('#customerEditPanel [data-customer-edit]').forEach(input=>{changes[input.dataset.customerEdit]=input.value;});
    const repEmail=byId('customerEditRep')?.value||sale.rep_email||null;
    button.disabled=true;button.textContent='SAVING…';
    if(message){message.textContent='Saving corrections…';message.style.color='#64748b';}
    try{
      const {data,error}=await sb.rpc('admin_edit_customer_list_sale',{p_sale_id:sale.id,p_changes:changes,p_rep_email:repEmail});
      if(error)throw error;
      state.activeSale=data;
      state.records=state.records.map(item=>item.id===sale.id?{...item,...data}:item);
      if(message){message.textContent='Saved. This sale remains in Customer List.';message.style.color='#166534';}
      setCustomerMessage('Customer sale corrected. It remains approved in Customer List.');
      document.getElementById('customerRefresh')?.click();
      setTimeout(()=>{closeEditor();fetchCustomerRecords();},300);
    }catch(error){
      console.error('Customer List Admin edit failed',error);
      if(message){message.textContent=error?.message||'Unable to save corrections.';message.style.color='#991b1b';}
      button.disabled=false;button.textContent='SAVE CHANGES';
    }
  }

  async function returnToReview(button){
    if(button.dataset.moving==='1')return;
    let saleId=button.dataset.saleId;
    if(!saleId){
      await fetchCustomerRecords();
      patchRows();
      saleId=button.dataset.saleId;
    }
    if(!saleId){setCustomerMessage('Unable to identify this sale. Refresh Customer List and retry.',true);return;}
    button.dataset.moving='1';button.disabled=true;button.textContent='MOVING…';
    try{
      const {error}=await sb.rpc('admin_return_sale_to_review',{p_sale_id:saleId});
      if(error)throw error;
      const row=button.closest('tr');
      row?.remove();
      state.records=state.records.filter(item=>item.id!==saleId);
      const orderCount=byId('customerOrderCount');
      if(orderCount)orderCount.textContent=String(Math.max(0,Number(orderCount.textContent||0)-1));
      setCustomerMessage('Sale moved immediately from Customer List to Admin SALE REVIEW. Its original processed timestamp and customer information were preserved.');
      window.dispatchEvent(new CustomEvent('mccoy-sale-review-changed',{detail:{saleId}}));
      setTimeout(()=>document.getElementById('customerRefresh')?.click(),100);
      setTimeout(fetchCustomerRecords,350);
    }catch(error){
      console.error('Return to SALE REVIEW failed',error);
      setCustomerMessage(error?.message||'Unable to move this sale to SALE REVIEW.',true);
      delete button.dataset.moving;button.disabled=false;button.textContent='NOT A SALE';
    }
  }

  // Capture before the legacy NOT A SALE onclick can mark the sale final or request a reason.
  document.addEventListener('click',event=>{
    const button=event.target?.closest?.('#customerRows button.customer-remove');
    if(!button||!isAdmin())return;
    event.preventDefault();
    event.stopImmediatePropagation();
    returnToReview(button);
  },true);

  document.addEventListener('click',event=>{
    const edit=event.target?.closest?.('#customerRows button.customer-edit');
    if(edit&&isAdmin()){
      event.preventDefault();
      const saleId=edit.dataset.saleId||edit.closest('tr')?.dataset.saleId;
      if(saleId)openEditor(saleId);
      else fetchCustomerRecords().then(()=>{patchRows();const retryId=edit.dataset.saleId||edit.closest('tr')?.dataset.saleId;if(retryId)openEditor(retryId);else setCustomerMessage('Unable to identify this sale. Refresh Customer List and retry.',true);});
      return;
    }
    if(event.target?.closest?.('#customerListPageButton,#customerRefresh'))setTimeout(()=>fetchCustomerRecords(),350);
  });

  document.addEventListener('input',event=>{if(event.target?.id==='customerSearch')setTimeout(patchRows,0);});
  window.addEventListener('mccoy-access-ready',()=>setTimeout(fetchCustomerRecords,250));
  window.addEventListener('mccoy-customer-list-changed',()=>{document.getElementById('customerRefresh')?.click();setTimeout(fetchCustomerRecords,300);});
  window.addEventListener('mccoy-sale-review-changed',()=>setTimeout(()=>document.getElementById('saleReviewRefresh')?.click(),100));
  setTimeout(()=>{if(isAdmin())fetchCustomerRecords();},700);
})();
