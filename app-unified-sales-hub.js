// Consolidates the former standalone Sales Hub into the main McCoy Platform app.
(function(){
  const byId=id=>document.getElementById(id);
  function openSalesHub(){
    const salesButton=document.querySelector('.nav-btn[data-view="sales"]');
    const salesSection=byId('sales');
    if(!salesButton||!salesSection)return;
    document.querySelectorAll('.nav-btn').forEach(button=>button.classList.toggle('active',button===salesButton));
    document.querySelectorAll('.view').forEach(section=>section.classList.toggle('active',section===salesSection));
    const title=byId('pageTitle');if(title)title.textContent='Sales Hub';
    const subtitle=byId('pageSubtitle');if(subtitle){subtitle.textContent='Sales · Social · Competition · Accounting';subtitle.style.display='block';}
  }
  const selectSalesHub=()=>document.querySelector('.nav-btn[data-view="sales"]')?.click();

  function syncProviderSelectors(){
    const fieldProvider=byId('sessionIsp');
    const salesProvider=byId('salesHubIsp');
    if(!fieldProvider||!salesProvider)return;
    salesProvider.innerHTML=fieldProvider.innerHTML;
    salesProvider.value=fieldProvider.value;
    salesProvider.addEventListener('change',()=>{
      fieldProvider.value=salesProvider.value;
      fieldProvider.dispatchEvent(new Event('change'));
    });
    fieldProvider.addEventListener('change',()=>{salesProvider.value=fieldProvider.value;});
  }

  function mountSalesHub(){
    const mount=byId('salesHubSocialMount');
    const social=document.querySelector('.sales-strip');
    if(mount&&social&&!mount.contains(social))mount.appendChild(social);
    syncProviderSelectors();
  }

  function showSalesFromHash(){
    if(location.hash==='#sales')openSalesHub();
  }

  document.querySelector('.nav-btn[data-view="sales"]')?.addEventListener('click',()=>{
    if(location.hash!=='#sales')location.hash='sales';
    setTimeout(openSalesHub,0);
  });
  byId('salesHubFieldCoachBtn')?.addEventListener('click',()=>document.querySelector('.nav-btn[data-view="field"]')?.click());
  byId('salesHubRefreshBtn')?.addEventListener('click',()=>byId('salesRefreshBtn')?.click());
  window.addEventListener('hashchange',showSalesFromHash);
  let tries=0;
  const startup=setInterval(()=>{
    tries++;
    mountSalesHub();
    if(byId('salesHubIsp')?.options.length||tries>=30){clearInterval(startup);showSalesFromHash();}
  },100);
})();
