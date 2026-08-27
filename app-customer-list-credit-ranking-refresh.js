// Refresh ranking consumers immediately after an Admin Customer List edit commits.
// The database remains authoritative; this only removes the stale-dashboard delay.
(function(){
  if(window.MCCOY_CUSTOMER_LIST_CREDIT_RANKING_REFRESH)return;
  window.MCCOY_CUSTOMER_LIST_CREDIT_RANKING_REFRESH=true;

  function install(){
    if(!window.sb?.rpc)return false;
    if(sb.rpc.__mccoyCustomerListCreditRefresh)return true;

    const originalRpc=sb.rpc.bind(sb);
    const wrapped=async function(name,args,options){
      const result=await originalRpc(name,args,options);
      if(name==='admin_edit_customer_list_sale'&&!result?.error&&result?.data){
        const sale=result.data;
        const detail={
          saleId:sale.id||args?.p_sale_id||null,
          repUserId:sale.rep_user_id||null,
          repEmail:sale.rep_email||args?.p_rep_email||null,
          repName:sale.rep_name||null,
          rankingEligible:sale.ranking_eligible===true,
          source:'customer_list_admin_edit'
        };
        queueMicrotask(()=>{
          window.dispatchEvent(new CustomEvent('mccoy-live-sales-changed',{detail}));
          window.dispatchEvent(new CustomEvent('mccoy-sale-credit-changed',{detail}));
          window.dispatchEvent(new CustomEvent('mccoy-rankings-changed',{detail}));
          try{Promise.resolve(window.MCCOY_REFRESH_RANKINGS?.()).catch(error=>console.error('Ranking refresh failed',error));}
          catch(error){console.error('Ranking refresh failed',error);}
        });
      }
      return result;
    };
    wrapped.__mccoyCustomerListCreditRefresh=true;
    wrapped.__mccoyOriginalRpc=originalRpc;
    sb.rpc=wrapped;
    return true;
  }

  if(!install()){
    let attempts=0;
    const timer=setInterval(()=>{
      attempts++;
      if(install()||attempts>=40)clearInterval(timer);
    },100);
  }
})();
