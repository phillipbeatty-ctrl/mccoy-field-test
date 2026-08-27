// Show rep-attached order photos and extraction state inside the single Admin SALE REVIEW page.
(function(){
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let lastSaleId=null,requestSeq=0;
  async function refresh(){
    const select=document.getElementById('adminSaleReviewSale'),body=document.getElementById('adminSaleReviewBody');if(!select||!body)return;
    const saleId=select.value;if(!saleId){document.getElementById('saleOrderPhotoAdmin')?.remove();lastSaleId=null;return;}
    const seq=++requestSeq;lastSaleId=saleId;
    let block=document.getElementById('saleOrderPhotoAdmin');if(!block){block=document.createElement('div');block.id='saleOrderPhotoAdmin';block.style.cssText='margin:12px 0;padding:12px;border:1px solid #bfdbfe;border-radius:12px;background:#eff6ff';const summary=body.querySelector('.sale-review-summary');if(summary)summary.insertAdjacentElement('afterend',block);else body.prepend(block);}
    block.textContent='Loading attached order photos…';
    try{const {data,error}=await sb.functions.invoke('sale-order-photo',{body:{action:'list',sale_id:saleId}});if(seq!==requestSeq)return;if(error||!data?.ok)throw new Error(data?.error||error?.message||'photo_lookup_failed');const rows=data.rows||[];if(!rows.length){block.innerHTML='<strong>Order photo</strong><div class="muted small">No order photo attached to this sale.</div>';return;}const p=rows[0],x=p.extracted_fields||{};block.innerHTML=`<div style="display:grid;grid-template-columns:minmax(180px,260px) 1fr;gap:12px;align-items:start"><div><strong>Attached order photo</strong>${p.signed_url?`<a href="${esc(p.signed_url)}" target="_blank" rel="noopener"><img src="${esc(p.signed_url)}" alt="Attached ISP order" style="display:block;width:100%;max-height:240px;object-fit:contain;margin-top:8px;border-radius:8px;background:#fff"></a>`:''}</div><div><strong>Extraction status:</strong> ${esc(String(p.extraction_status||'uploaded').replaceAll('_',' '))}<br><strong>Rep confirmed:</strong> ${p.user_confirmed_at?'Yes':'No'}${p.extracted_at?`<br><strong>Extracted:</strong> ${new Date(p.extracted_at).toLocaleString()}`:''}${Object.keys(x).length?`<pre style="white-space:pre-wrap;font-size:11px;background:#fff;padding:8px;border-radius:8px;margin-top:8px">${esc(JSON.stringify(x,null,2))}</pre>`:''}<div class="muted small">The photo/extraction is evidence only. The green APPROVED button and ISP/provider evidence remain authoritative.</div></div></div>`;}catch(error){block.textContent='Attached order photo could not be loaded.';}
  }
  document.addEventListener('change',e=>{if(e.target?.id==='adminSaleReviewSale')setTimeout(refresh,0);},true);
  const observer=new MutationObserver(()=>{const select=document.getElementById('adminSaleReviewSale');if(select&&select.value&&select.value!==lastSaleId)setTimeout(refresh,0);});observer.observe(document.documentElement,{childList:true,subtree:true});
})();
