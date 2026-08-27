// Refresh ranking consumers after Admin Customer List edits and render date-only
// order/install dates as calendar dates instead of UTC timestamps.
(function(){
  if(window.MCCOY_CUSTOMER_LIST_CREDIT_RANKING_REFRESH)return;
  window.MCCOY_CUSTOMER_LIST_CREDIT_RANKING_REFRESH=true;

  const customerRecords=new Map();
  const normalized=value=>String(value||'').trim().toLowerCase();

  function formatCalendarDate(value){
    if(value==null||value==='')return '—';
    const text=String(value).trim();
    const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    if(match){
      const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]);
      const currentYear=new Date().getFullYear();
      if(year<2000||year>currentYear+1)return text;
      const localDate=new Date(year,month-1,day,12,0,0,0);
      if(localDate.getFullYear()===year&&localDate.getMonth()===month-1&&localDate.getDate()===day)return localDate.toLocaleDateString();
      return text;
    }
    const date=new Date(text);
    return Number.isNaN(date.getTime())?text:date.toLocaleDateString();
  }

  function findRecordForRow(row){
    const direct=customerRecords.get(row.dataset.saleId||'');
    if(direct)return direct;
    const cells=[...row.querySelectorAll('td')].slice(0,6).map(cell=>normalized(cell.textContent));
    const joined=cells.join(' | ');
    let record=[...customerRecords.values()].find(item=>item.provider_order_number&&joined.includes(normalized(item.provider_order_number)));
    if(record)return record;
    record=[...customerRecords.values()].find(item=>item.provider_account_number&&joined.includes(normalized(item.provider_account_number)));
    if(record)return record;
    return [...customerRecords.values()].find(item=>item.service_address&&joined.includes(normalized(item.service_address)))||null;
  }

  function patchCustomerListDates(){
    document.querySelectorAll('#customerRows tr').forEach(row=>{
      const record=findRecordForRow(row);
      if(!record)return;
      const customer=row.querySelector('.customer-main');
      if(!customer)return;
      const dateLine=[...customer.querySelectorAll('.customer-sub')].find(element=>element.textContent.trim().startsWith('Ordered '));
      if(dateLine)dateLine.textContent=`Ordered ${formatCalendarDate(record.order_date)} · Install ${formatCalendarDate(record.install_date)}`;
    });
  }

  function scheduleCustomerDatePatch(){
    [0,60,180,420,800,1400].forEach(delay=>setTimeout(patchCustomerListDates,delay));
  }

  function rememberCustomerRecords(result){
    const rows=Array.isArray(result?.data?.records)?result.data.records:[];
    if(!result?.error&&result?.data?.ok){
      customerRecords.clear();
      rows.forEach(row=>{if(row?.id)customerRecords.set(row.id,row);});
      scheduleCustomerDatePatch();
    }
  }

  function installRpc(){
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

  function installFunctionInvoke(){
    if(!window.sb?.functions?.invoke)return false;
    if(sb.functions.invoke.__mccoyCustomerDateFix)return true;
    const originalInvoke=sb.functions.invoke.bind(sb.functions);
    const wrapped=async function(name,options){
      const result=await originalInvoke(name,options);
      if(name==='accounting-records'&&String(options?.body?.action||'customer_list')==='customer_list')rememberCustomerRecords(result);
      return result;
    };
    wrapped.__mccoyCustomerDateFix=true;
    wrapped.__mccoyOriginalInvoke=originalInvoke;
    sb.functions.invoke=wrapped;
    return true;
  }

  function install(){return installRpc()&&installFunctionInvoke();}
  if(!install()){
    let attempts=0;
    const timer=setInterval(()=>{
      attempts++;
      if(install()||attempts>=40)clearInterval(timer);
    },100);
  }

  document.addEventListener('click',event=>{
    if(event.target?.closest?.('#customerListPageButton,#customerRefresh'))scheduleCustomerDatePatch();
  });
  document.addEventListener('input',event=>{if(event.target?.id==='customerSearch')scheduleCustomerDatePatch();});
  window.addEventListener('mccoy-customer-list-changed',scheduleCustomerDatePatch);
})();
