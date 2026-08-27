// Rep-owned post-sale detail completion. Admin approval is the hard lock and Customer List gate.
(function(){
  const byId=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let rows=[],openId=null,loading=false;const pendingPhotoBySale={};

  const style=document.createElement('style');style.textContent=`
    .sales-to-complete{margin-top:14px}.stc-list{display:grid;gap:10px}.stc-row{border:1px solid #e5e7eb;border-radius:12px;padding:12px;background:#fff}.stc-head{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}.stc-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;margin-top:12px}.stc-form label{display:grid;gap:4px;font-size:12px;font-weight:700}.stc-form input,.stc-form textarea{padding:9px;border:1px solid #d1d5db;border-radius:8px;background:#fff;font:inherit;min-width:0}.stc-wide{grid-column:1/-1}.stc-save{background:#2563eb;color:#fff;border:0;border-radius:8px;padding:10px 14px;font-weight:800;cursor:pointer}.stc-badge{display:inline-block;padding:3px 7px;border-radius:999px;background:#fef3c7;color:#92400e;font-size:11px;font-weight:800}.stc-complete{background:#dbeafe;color:#1d4ed8}.stc-photo{grid-column:1/-1;padding:10px;border:1px solid #bfdbfe;border-radius:10px;background:#eff6ff}.stc-photo input{width:100%}.stc-photo-status{margin-top:6px;font-size:12px;color:#1e3a8a}@media(max-width:760px){.stc-form{grid-template-columns:1fr}.stc-wide{grid-column:auto}}
  `;document.head.appendChild(style);

  function approved(row){return String(row?.compensation_snapshot?.admin_approval?.status||'').toLowerCase()==='approved'||String(row?.verification_reason||'').toLowerCase().startsWith('admin_sale_review_verified:');}

  function patchCustomerListGate(){
    if(!window.sb?.functions?.invoke||window.sb.functions.__mccoyApprovedCustomerGate)return;
    const original=window.sb.functions.invoke.bind(window.sb.functions);
    window.sb.functions.invoke=async function(name,options){
      const result=await original(name,options);
      if(name!=='accounting-records'||String(options?.body?.action||'customer_list')!=='customer_list'||!result?.data?.ok)return result;
      const approvedRows=(result.data.records||[]).filter(row=>String(row.verification_reason||'').toLowerCase().startsWith('admin_sale_review_verified:'));
      return{...result,data:{...result.data,records:approvedRows,summary:{orders:approvedRows.length,current_earned_pay:approvedRows.reduce((sum,row)=>sum+Number(row.current_earned_pay||0),0),cancellation_reductions:approvedRows.reduce((sum,row)=>sum+Number(row.cancellation_reduction||0),0)}}};
    };
    window.sb.functions.__mccoyApprovedCustomerGate=true;
  }

  function ensure(){
    if(byId('salesToCompleteCard'))return;
    const anchor=byId('saleHubActivity')||byId('salesHubSocialMount')?.closest('.card')||document.querySelector('#field .card:last-of-type');if(!anchor)return;
    const card=document.createElement('div');card.id='salesToCompleteCard';card.className='card sales-to-complete';card.innerHTML=`<div class="card-head"><div><h2>SALES TO COMPLETE</h2><p class="muted small">COMPLETE SALE can be recorded at the door without customer information. Enter it later, or attach a clear ISP order photo and review the extracted suggestions before saving.</p></div><button id="stcRefresh" class="assign-btn">Refresh</button></div><div id="stcMessage" class="muted small"></div><div id="stcRows" class="stc-list"></div>`;anchor.insertAdjacentElement('afterend',card);byId('stcRefresh').onclick=()=>load(true);load();
  }

  function field(id,label,value,type='text',wide=false){return `<label class="${wide?'stc-wide':''}">${label}<input id="${id}" type="${type}" value="${esc(value||'')}"></label>`;}
  function render(){
    const root=byId('stcRows'),message=byId('stcMessage');if(!root)return;message.textContent=rows.length?`${rows.length} unapproved sale${rows.length===1?'':'s'} can still be completed by you.`:'No unapproved sales need customer information.';
    root.innerHTML=rows.map((s,index)=>{const missing=Array.isArray(s.required_metrics_missing)?s.required_metrics_missing:[],isOpen=openId===s.id,status=s.required_metrics_complete===true?'<span class="stc-badge stc-complete">READY FOR ISP / ADMIN REVIEW</span>':'<span class="stc-badge">DETAILS PENDING</span>';return `<article class="stc-row"><div class="stc-head"><div><strong>${esc(s.isp||'Provider')} · ${esc(s.service_address||s.lead_label||'Address not entered')}</strong><div class="muted small">${new Date(s.created_at).toLocaleString()} · ${status}${missing.length?` · Missing: ${esc(missing.join(', '))}`:''}</div></div><button class="assign-btn" data-stc-open="${esc(s.id)}">${isOpen?'Close':'ENTER / EDIT CUSTOMER INFO'}</button></div>${isOpen?`<div class="stc-form">
      <div class="stc-photo"><strong>Attach ISP order photo</strong><div class="muted small">Photo extraction only fills draft suggestions. You must confirm them, and Admin must still approve the sale.</div><input id="stcPhoto${index}" type="file" accept="image/jpeg,image/png,image/webp" capture="environment"><div id="stcPhotoStatus${index}" class="stc-photo-status">No order photo selected.</div></div>
      ${field(`stcFirst${index}`,'Customer first name',s.customer_first_name)}${field(`stcLast${index}`,'Customer last name',s.customer_last_name)}${field(`stcPhone${index}`,'Phone',s.customer_phone)}${field(`stcEmail${index}`,'Email',s.customer_email,'email')}${field(`stcAddress${index}`,'Service address',s.service_address,'text',true)}${field(`stcOrder${index}`,'Provider order number',s.provider_order_number)}${field(`stcAccount${index}`,'Provider account number',s.provider_account_number)}${field(`stcOrderDate${index}`,'Order date',s.order_date,'date')}${field(`stcInstall${index}`,'Install date',s.install_date,'date')}${field(`stcIsp${index}`,'Internet provider',s.isp)}${field(`stcProduct${index}`,'Internet product',s.internet_product)}${field(`stcSpeed${index}`,'Internet speed Mbps',s.internet_speed_mbps,'number')}<label class="stc-wide">Notes<textarea id="stcNotes${index}" rows="3">${esc(s.notes||'')}</textarea></label><div class="stc-wide" style="display:flex;justify-content:flex-end"><button class="stc-save" data-stc-save="${esc(s.id)}" data-index="${index}">SAVE CUSTOMER INFO</button></div></div>`:''}</article>`;}).join('');
    root.querySelectorAll('[data-stc-open]').forEach(btn=>btn.onclick=()=>{openId=openId===btn.dataset.stcOpen?null:btn.dataset.stcOpen;render();if(openId){const i=rows.findIndex(r=>r.id===openId);if(i>=0)loadPhotos(openId,i);}});
    root.querySelectorAll('[data-stc-save]').forEach(btn=>btn.onclick=()=>save(btn.dataset.stcSave,Number(btn.dataset.index),btn));
    rows.forEach((s,index)=>{const input=byId(`stcPhoto${index}`);if(input)input.onchange=()=>{const file=input.files?.[0];if(file)uploadAndExtract(s.id,index,file);};});
  }

  async function load(force=false){if(loading)return;if(!force&&rows.length){render();return;}loading=true;try{const {data,error}=await sb.rpc('my_sales_to_complete');if(error)throw error;rows=(data?.rows||[]).filter(row=>!approved(row));render();}catch(error){console.error('Sales to Complete load failed',error);if(byId('stcMessage'))byId('stcMessage').textContent=error?.message||'Unable to load Sales to Complete.';}finally{loading=false;}}
  function value(id){return byId(id)?.value??'';}
  function setPhotoStatus(index,text){const el=byId(`stcPhotoStatus${index}`);if(el)el.textContent=text;}
  function fillIfPresent(id,value){const el=byId(id);if(el&&value!==null&&value!==undefined&&String(value)!=='')el.value=String(value);}
  function applyExtracted(index,x){fillIfPresent(`stcFirst${index}`,x.customer_first_name);fillIfPresent(`stcLast${index}`,x.customer_last_name);fillIfPresent(`stcPhone${index}`,x.customer_phone);fillIfPresent(`stcEmail${index}`,x.customer_email);fillIfPresent(`stcAddress${index}`,x.service_address);fillIfPresent(`stcOrder${index}`,x.provider_order_number);fillIfPresent(`stcAccount${index}`,x.provider_account_number);fillIfPresent(`stcOrderDate${index}`,x.order_date);fillIfPresent(`stcInstall${index}`,x.install_date);fillIfPresent(`stcIsp${index}`,x.isp);fillIfPresent(`stcProduct${index}`,x.internet_product);fillIfPresent(`stcSpeed${index}`,x.internet_speed_mbps);}

  async function loadPhotos(saleId,index){try{const {data,error}=await sb.functions.invoke('sale-order-photo',{body:{action:'list',sale_id:saleId}});if(error||!data?.ok)return;const photo=data.rows?.[0];if(!photo)return;pendingPhotoBySale[saleId]=photo.id;if(photo.extraction_status==='extracted'||photo.extraction_status==='user_confirmed'){applyExtracted(index,photo.extracted_fields||{});setPhotoStatus(index,`Order photo attached · extraction ready${photo.extracted_fields?.confidence!=null?` · confidence ${Math.round(Number(photo.extracted_fields.confidence)*100)}%`:''}. Review every field before saving.`);}else setPhotoStatus(index,`Order photo attached · ${String(photo.extraction_status||'uploaded').replaceAll('_',' ')}.`);}catch(_){}}

  async function uploadAndExtract(saleId,index,file){
    if(!['image/jpeg','image/png','image/webp'].includes(file.type)){setPhotoStatus(index,'Use a JPEG, PNG, or WebP image.');return;}if(file.size>10485760){setPhotoStatus(index,'Photo must be 10 MB or less.');return;}
    setPhotoStatus(index,'Securing private upload…');
    try{
      const created=await sb.functions.invoke('sale-order-photo',{body:{action:'create_upload',sale_id:saleId,mime_type:file.type,file_size_bytes:file.size}});if(created.error||!created.data?.ok)throw new Error(created.data?.error||created.error?.message||'upload_setup_failed');
      const photoId=created.data.photo_id;pendingPhotoBySale[saleId]=photoId;const upload=await sb.storage.from('sale-order-photos').uploadToSignedUrl(created.data.path,created.data.token,file,{contentType:file.type});if(upload.error)throw upload.error;
      setPhotoStatus(index,'Photo attached privately. Extracting visible order information…');
      const processed=await sb.functions.invoke('sale-order-photo',{body:{action:'process',photo_id:photoId}});
      if(processed.error||!processed.data?.ok){const code=processed.data?.error||processed.error?.message||'photo_extraction_failed';if(String(code).includes('ai_extraction_not_configured')){setPhotoStatus(index,'Photo attached. Automatic extraction is not configured yet; enter the information manually for now.');return;}throw new Error(code);}
      const x=processed.data.extracted_fields||{};applyExtracted(index,x);const warnings=Array.isArray(x.warnings)&&x.warnings.length?` Warnings: ${x.warnings.join('; ')}`:'';setPhotoStatus(index,`Draft information extracted${x.confidence!=null?` · confidence ${Math.round(Number(x.confidence)*100)}%`:''}. Confirm/correct every field, then SAVE CUSTOMER INFO.${warnings}`);
    }catch(error){console.error('Order photo failed',error);setPhotoStatus(index,error?.message||'Order photo could not be processed.');}
  }

  async function save(id,index,button){const sale=rows.find(row=>row.id===id);if(!sale)return;button.disabled=true;button.textContent='SAVING…';const corrections={customer_first_name:value(`stcFirst${index}`),customer_last_name:value(`stcLast${index}`),customer_phone:value(`stcPhone${index}`),customer_email:value(`stcEmail${index}`),service_address:value(`stcAddress${index}`),provider_order_number:value(`stcOrder${index}`),provider_account_number:value(`stcAccount${index}`),order_date:value(`stcOrderDate${index}`),install_date:value(`stcInstall${index}`),isp:value(`stcIsp${index}`),internet_product:value(`stcProduct${index}`),internet_speed_mbps:value(`stcSpeed${index}`),notes:value(`stcNotes${index}`)};try{const {data,error}=await sb.rpc('save_my_sale_details',{p_sale_id:id,p_corrections:corrections});if(error)throw error;const photoId=pendingPhotoBySale[id];if(photoId)await sb.functions.invoke('sale-order-photo',{body:{action:'confirm',photo_id:photoId}}).catch(()=>{});byId('stcMessage').textContent='Customer information saved and rep-confirmed. The sale remains pending until ISP/Admin verification.';rows=rows.map(row=>row.id===id?data:row);render();window.dispatchEvent(new CustomEvent('mccoy-sale-details-updated',{detail:{saleId:id}}));}catch(error){byId('stcMessage').textContent=error?.message||'Customer information could not be saved.';button.disabled=false;button.textContent='SAVE CUSTOMER INFO';}}

  patchCustomerListGate();const timer=setInterval(()=>{patchCustomerListGate();ensure();if(byId('salesToCompleteCard'))clearInterval(timer);},300);setTimeout(()=>clearInterval(timer),15000);window.addEventListener('mccoy-sale-saved',()=>{rows=[];load(true);});window.addEventListener('mccoy-sale-credit-changed',()=>{rows=[];load(true);});
})();
