// Keep Customer List synchronized with the Admin SALE REVIEW approval destination.
(function(){
  window.addEventListener('mccoy-customer-list-changed',()=>{
    const refresh=document.getElementById('customerRefresh');
    if(refresh)refresh.click();
  });
})();
