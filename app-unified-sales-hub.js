// Keeps the combined Sale Hub and field workflow in one authenticated page.
(function(){
  const byId=id=>document.getElementById(id);
  function openSaleHub(){
    const button=document.querySelector('.nav-btn[data-view="field"]'),section=byId('field');
    if(!button||!section)return;
    document.querySelectorAll('.nav-btn').forEach(item=>item.classList.toggle('active',item===button));
    document.querySelectorAll('.view').forEach(view=>view.classList.toggle('active',view===section));
    const title=byId('pageTitle');if(title)title.textContent='Sale Hub';
    const subtitle=byId('pageSubtitle');if(subtitle){subtitle.textContent='Sales, door knocking, pay progress, and field coaching';subtitle.style.display='block';}
  }
  function mountSaleActivity(){
    const mount=byId('salesHubSocialMount'),social=document.querySelector('.sales-strip');
    if(mount&&social&&!mount.contains(social))mount.appendChild(social);
  }
  function routeLegacySalesLink(){if(['#sales','#sale','#field'].includes(location.hash))openSaleHub();}
  byId('salesHubRefreshBtn')?.addEventListener('click',()=>byId('salesRefreshBtn')?.click());
  window.addEventListener('hashchange',routeLegacySalesLink);
  let tries=0;
  const startup=setInterval(()=>{tries++;mountSaleActivity();if(byId('salesFeed')||tries>=30){clearInterval(startup);routeLegacySalesLink();}},100);
})();