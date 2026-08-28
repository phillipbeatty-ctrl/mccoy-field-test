// Explicit SALE REVIEW lifecycle events for add-on modules. No DOM observer.
(function(){
  if(window.MCCOY_SALE_REVIEW_EVENTS)return;
  window.MCCOY_SALE_REVIEW_EVENTS=true;

  function emit(reason){
    const rows=[...document.querySelectorAll('#saleFeed .sale-row')];
    const saleIds=[];
    for(const row of rows){
      const control=row.querySelector('[data-sale]');
      const saleId=String(control?.dataset?.sale||row.dataset.saleReviewId||'');
      if(!saleId)continue;
      row.dataset.saleReviewId=saleId;
      saleIds.push(saleId);
    }
    window.dispatchEvent(new CustomEvent('mccoy-sale-review-rendered',{detail:{reason,saleIds}}));
  }

  function schedule(reason){
    [0,80,220,500,900,1500].forEach(delay=>setTimeout(()=>emit(reason),delay));
  }

  document.addEventListener('click',event=>{
    const target=event.target?.closest?.('#saleReviewBtn,#saleReviewRefresh,[data-approve],[data-remove],[data-restore]');
    if(target){const reason=target.matches('#saleReviewBtn,#saleReviewRefresh')?'sale_review_click':'sale_review_action';schedule(reason);}
  },true);
  document.addEventListener('input',event=>{if(event.target?.id==='saleReviewSearch')schedule('sale_review_search');},true);
  document.addEventListener('change',event=>{if(event.target?.closest?.('#saleFeed [data-sale]'))schedule('sale_review_field_change');},true);
  window.addEventListener('mccoy-sale-review-changed',()=>schedule('sale_review_changed'));
  window.addEventListener('mccoy-customer-list-changed',()=>schedule('customer_list_changed'));
  setTimeout(()=>emit('initial'),700);
})();
