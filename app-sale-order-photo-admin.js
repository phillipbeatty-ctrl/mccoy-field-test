// Show rep-attached order photos inside the single Admin SALE REVIEW page.
// The module is driven only by explicit SALE REVIEW lifecycle events and user clicks.
(function(){
  if(window.MCCOY_SALE_ORDER_PHOTO_ADMIN)return;
  window.MCCOY_SALE_ORDER_PHOTO_ADMIN=true;

  for(const src of ['app-sale-review-events.js?v=2026082701','app-sale-order-photo-pilot.js?v=2026082701']){
    if(document.querySelector(`script[src^="${src.split('?')[0]}"]`))continue;
    const script=document.createElement('script');script.src=src;script.defer=true;document.body.appendChild(script);
  }

  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const requestSeq=new Map();

  const style=document.createElement('style');
  style.textContent=`
    .sale-order-photo-slot{margin-top:10px;padding-top:10px;border-top:1px solid #e5e7eb}.sale-order-photo-toggle{font-size:11px}.sale-order-photo-body{margin-top:9px;padding:11px;border:1px solid #bfdbfe;border-radius:10px;background:#eff6ff}.sale-order-photo-grid{display:grid;grid-template-columns:minmax(170px,250px) 1fr;gap:12px;align-items:start}.sale-order-photo-grid img{display:block;width:100%;max-height:240px;object-fit:contain;border-radius:8px;background:#fff}.sale-order-photo-json{white-space:pre-wrap;font-size:11px;background:#fff;padding:8px;border-radius:8px;margin-top:8px}.sale-order-photo-muted{font-size:11px;color:#64748b;margin-top:7px}@media(max-width:680px){.sale-order-photo-grid{grid-template-columns:1fr}}
  `;
  document.head.appendChild(style);

  function mount(){
    document.querySelectorAll('#saleFeed .sale-row[data-sale-review-id]').forEach(row=>{
      const saleId=row.dataset.saleReviewId;
      if(!saleId||row.querySelector(`[data-sale-photo-slot="${CSS.escape(saleId)}"]`))return;
      const slot=document.createElement('div');
      slot.className='sale-order-photo-slot';
      slot.dataset.salePhotoSlot=saleId;
      slot.innerHTML=`<button type="button" class="assign-btn sale-order-photo-toggle" data-sale-photo-toggle="${esc(saleId)}" aria-expanded="false">ORDER PHOTO EVIDENCE</button><div class="sale-order-photo-body" data-sale-photo-body="${esc(saleId)}" hidden></div>`;
      const grid=row.querySelector('.sale-grid');
      if(grid)grid.insertAdjacentElement('afterend',slot);else row.appendChild(slot);
    });
  }

  function photoMarkup(photo){
    const fields=photo.extracted_fields||{};
    return `<div class="sale-order-photo-grid"><div><strong>Attached order photo</strong>${photo.signed_url?`<a href="${esc(photo.signed_url)}" target="_blank" rel="noopener"><img src="${esc(photo.signed_url)}" alt="Attached ISP order"></a>`:'<div class="sale-order-photo-muted">Preview unavailable.</div>'}</div><div><strong>Extraction status:</strong> ${esc(String(photo.extraction_status||'uploaded').replaceAll('_',' '))}<br><strong>Rep confirmed:</strong> ${photo.user_confirmed_at?'Yes':'No'}${photo.extracted_at?`<br><strong>Extracted:</strong> ${esc(new Date(photo.extracted_at).toLocaleString())}`:''}${Object.keys(fields).length?`<pre class="sale-order-photo-json">${esc(JSON.stringify(fields,null,2))}</pre>`:''}<div class="sale-order-photo-muted">The photo and extraction are evidence only. The green APPROVED button and ISP/provider evidence remain authoritative.</div></div></div>`;
  }

  async function load(saleId,body,force=false){
    if(!force&&body.dataset.loaded==='1')return;
    const seq=(requestSeq.get(saleId)||0)+1;requestSeq.set(saleId,seq);
    body.hidden=false;body.textContent='Loading attached order photos…';
    try{
      const {data,error}=await sb.functions.invoke('sale-order-photo',{body:{action:'list',sale_id:saleId}});
      if(requestSeq.get(saleId)!==seq)return;
      if(error||!data?.ok)throw new Error(data?.error||error?.message||'photo_lookup_failed');
      const rows=Array.isArray(data.rows)?data.rows:[];
      body.dataset.loaded='1';
      if(!rows.length){body.innerHTML='<strong>Order photo</strong><div class="sale-order-photo-muted">No order photo attached to this sale.</div>';return;}
      body.innerHTML=rows.map(photo=>photoMarkup(photo)).join('<hr style="border:0;border-top:1px solid #bfdbfe;margin:12px 0">');
    }catch(error){
      body.textContent=error?.message||'Attached order photo could not be loaded.';
    }
  }

  document.addEventListener('click',event=>{
    const button=event.target?.closest?.('[data-sale-photo-toggle]');
    if(!button)return;
    const saleId=button.dataset.salePhotoToggle;
    const body=document.querySelector(`[data-sale-photo-body="${CSS.escape(saleId)}"]`);
    if(!body)return;
    const opening=body.hidden;
    body.hidden=!opening;
    button.setAttribute('aria-expanded',opening?'true':'false');
    button.textContent=opening?'HIDE ORDER PHOTO':'ORDER PHOTO EVIDENCE';
    if(opening)load(saleId,body);
  },true);

  window.addEventListener('mccoy-sale-review-rendered',mount);
  window.addEventListener('mccoy-sale-order-photo-updated',event=>{
    const saleId=String(event.detail?.saleId||'');
    const body=saleId?document.querySelector(`[data-sale-photo-body="${CSS.escape(saleId)}"]`):null;
    if(body){delete body.dataset.loaded;if(!body.hidden)load(saleId,body,true);}
  });
  setTimeout(mount,800);
})();
