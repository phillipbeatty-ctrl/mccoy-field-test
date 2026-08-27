// Admin Customer List lifecycle: approved customer -> SALE REVIEW -> REJECT -> TRASH.
(function(){
  async function returnToReview(button){
    const row=button.closest('tr');
    const saleId=button.dataset.saleId;
    if(!saleId)return;
    const customer=row?.querySelector('.customer-main')?.textContent?.trim()||'this customer';
    if(!confirm(`Return ${customer} to SALE REVIEW? The original processed timestamp will be preserved.`))return;
    const message=document.getElementById('customerListMessage');
    button.disabled=true;button.textContent='RETURNING…';
    try{
      const {error}=await sb.rpc('admin_return_sale_to_review',{p_sale_id:saleId});
      if(error)throw error;
      row?.remove();
      if(message)message.textContent='Sale returned to SALE REVIEW with its original processed timestamp preserved.';
      window.dispatchEvent(new CustomEvent('mccoy-sale-review-changed',{detail:{saleId}}));
      window.dispatchEvent(new CustomEvent('mccoy-customer-list-changed',{detail:{saleId}}));
      document.getElementById('customerRefresh')?.click();
    }catch(error){
      console.error('Return to SALE REVIEW failed',error);
      if(message)message.textContent=error?.message||'Unable to return this sale to SALE REVIEW.';
      button.disabled=false;button.textContent='RETURN TO REVIEW';
    }
  }

  function patchButtons(){
    const rows=document.querySelectorAll('#customerRows tr');
    for(const row of rows){
      const button=row.querySelector('button.customer-remove');
      if(!button||button.dataset.returnReviewBound==='1')continue;
      const cells=row.querySelectorAll('td');
      const providerText=cells[3]?.textContent||'';
      const customerText=cells[0]?.textContent||'';
      const contactText=cells[1]?.textContent||'';
      const addressText=cells[2]?.textContent||'';
      const match=[...window.__MCCOY_CUSTOMER_LIST_IDS__||[]].find(item=>{
        const hay=`${item.customer_first_name||''} ${item.customer_last_name||''} ${item.customer_phone||''} ${item.customer_email||''} ${item.service_address||''} ${item.provider_order_number||''} ${item.provider_account_number||''}`.toLowerCase();
        return hay.includes(customerText.trim().toLowerCase().split('\n')[0])&&(!addressText.trim()||hay.includes(addressText.trim().toLowerCase()));
      });
      if(match?.id)button.dataset.saleId=match.id;
      button.textContent='RETURN TO REVIEW';
      button.setAttribute('aria-label','Return sale to SALE REVIEW');
      button.dataset.returnReviewBound='1';
    }
  }

  // Capture before the legacy NOT A SALE onclick executes.
  document.addEventListener('click',event=>{
    const button=event.target?.closest?.('#customerRows button.customer-remove');
    if(!button)return;
    event.preventDefault();event.stopImmediatePropagation();
    if(button.dataset.saleId)returnToReview(button);
    else{
      const message=document.getElementById('customerListMessage');
      if(message)message.textContent='Refreshing Customer List before returning this sale to review…';
      document.getElementById('customerRefresh')?.click();
    }
  },true);

  async function refreshIds(){
    try{
      const {data,error}=await sb.functions.invoke('accounting-records',{body:{action:'customer_list'}});
      if(error||!data?.ok)return;
      window.__MCCOY_CUSTOMER_LIST_IDS__=data.records||[];
      setTimeout(patchButtons,0);
    }catch(_){}
  }

  window.addEventListener('mccoy-customer-list-changed',()=>setTimeout(()=>{refreshIds();patchButtons();},100));
  document.addEventListener('click',event=>{
    if(event.target?.closest?.('#customerListPageButton,#customerRefresh'))setTimeout(refreshIds,250);
  });
  const observer=new MutationObserver(()=>patchButtons());
  const start=setInterval(()=>{
    const root=document.getElementById('customerRows');
    if(root){observer.observe(root,{childList:true,subtree:true});refreshIds();clearInterval(start);}
  },300);
  setTimeout(()=>clearInterval(start),15000);
})();
