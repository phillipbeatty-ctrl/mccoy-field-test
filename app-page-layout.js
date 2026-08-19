(()=>{
  const descriptions={
    dashboard:'Social and Competition Tracking',
    field:'Field Coach',
    teams:'McCoy Team-members',
    leads:'Lead dispositioning & Tracking',
    settings:''
  };

  function ensureSidebarImportStyles(){
    if(document.getElementById('sidebarImportLeadStyles'))return;
    const style=document.createElement('style');
    style.id='sidebarImportLeadStyles';
    style.textContent=`
      .sidebar-import-leads-btn{
        border:0!important;
        background:transparent!important;
        color:#d1d5db!important;
        text-align:left!important;
        padding:11px 12px!important;
        border-radius:8px!important;
        cursor:pointer!important;
        width:100%!important;
        font-weight:400!important;
        box-sizing:border-box!important;
      }
      .sidebar-import-leads-btn:hover{
        background:#1f2937!important;
        color:#fff!important;
      }
    `;
    document.head.appendChild(style);
  }

  function ensureHeaderLayout(){
    const title=document.getElementById('pageTitle');
    const topbar=title?.closest('.topbar');
    const wrap=title?.parentElement;
    if(!title||!topbar||!wrap)return;

    let subtitle=document.getElementById('pageSubtitle');
    if(!subtitle){
      subtitle=wrap.querySelector('.muted');
      if(subtitle)subtitle.id='pageSubtitle';
      else{
        subtitle=document.createElement('div');
        subtitle.id='pageSubtitle';
        subtitle.className='muted';
        wrap.appendChild(subtitle);
      }
    }

    wrap.style.display='flex';
    wrap.style.alignItems='baseline';
    wrap.style.gap='14px';
    wrap.style.flexWrap='wrap';
    wrap.style.minWidth='0';
    title.style.margin='0';
    subtitle.style.margin='0';
    subtitle.style.whiteSpace='nowrap';
  }

  function setPageHeader(view,titleText){
    ensureHeaderLayout();
    const title=document.getElementById('pageTitle');
    const subtitle=document.getElementById('pageSubtitle');
    if(title)title.textContent=titleText||'';
    if(subtitle){
      const text=descriptions[view]||'';
      subtitle.textContent=text;
      subtitle.style.display=text?'block':'none';
    }
  }

  function activate(view){
    const btn=document.querySelector(`.nav-btn[data-view="${view}"]`);
    const section=document.getElementById(view);
    if(!btn||!section)return;
    document.querySelectorAll('.nav-btn').forEach(x=>x.classList.toggle('active',x===btn));
    document.querySelectorAll('.view').forEach(x=>x.classList.toggle('active',x===section));
    setPageHeader(view,btn.textContent.trim());
    if(view==='leads')setTimeout(()=>window.MCCOY_RENDER_LEAD_MAP?.(false),60);
  }

  function moveImportButtonToSidebar(){
    ensureSidebarImportStyles();
    const nav=document.querySelector('.sidebar nav');
    const importBtn=document.getElementById('adminLeadImportBtn');
    const systemBtn=nav?.querySelector('.nav-btn[data-view="settings"]');
    if(!nav||!importBtn||!systemBtn)return;
    importBtn.textContent='IMPORT REAL LEADS';
    importBtn.className='sidebar-import-leads-btn';
    importBtn.removeAttribute('style');
    nav.insertBefore(importBtn,systemBtn);
  }

  function reorderNav(){
    const nav=document.querySelector('.sidebar nav');
    if(!nav)return;
    ['dashboard','field','teams','leads'].forEach(view=>{
      const btn=nav.querySelector(`.nav-btn[data-view="${view}"]`);
      if(btn)nav.appendChild(btn);
    });
    moveImportButtonToSidebar();
    const systemBtn=nav.querySelector('.nav-btn[data-view="settings"]');
    if(systemBtn)nav.appendChild(systemBtn);
  }

  function bindHeaders(){
    document.querySelectorAll('.nav-btn').forEach(btn=>{
      if(btn.dataset.mccoyPageHeaderBound==='1')return;
      btn.dataset.mccoyPageHeaderBound='1';
      btn.addEventListener('click',()=>setTimeout(()=>setPageHeader(btn.dataset.view,btn.textContent.trim()),0));
    });
  }

  function init(){
    ensureSidebarImportStyles();
    reorderNav();
    bindHeaders();
    ensureHeaderLayout();
    activate('dashboard');
    setTimeout(moveImportButtonToSidebar,250);
    setTimeout(moveImportButtonToSidebar,900);
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});
  else init();
})();
