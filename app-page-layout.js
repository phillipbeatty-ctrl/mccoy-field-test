(()=>{
  const descriptions={
    dashboard:'Social and Competition Tracking',
    sales:'Sales Hub',
    field:'Sales, door knocking, pay progress, and field coaching',
    'customer-list':'Approved customer sales and Admin review controls',
    teams:'McCoy Team-members',
    leads:'Lead dispositioning & Tracking',
    settings:''
  };

  function ensureHeaderLayout(){
    const title=document.getElementById('pageTitle');
    const topbar=title?.closest('.topbar');
    const wrap=title?.parentElement;
    if(!title||!topbar||!wrap)return;
    let subtitle=document.getElementById('pageSubtitle');
    if(!subtitle){subtitle=wrap.querySelector('.muted');if(subtitle)subtitle.id='pageSubtitle';else{subtitle=document.createElement('div');subtitle.id='pageSubtitle';subtitle.className='muted';wrap.appendChild(subtitle);}}
    wrap.style.display='flex';wrap.style.alignItems='baseline';wrap.style.gap='14px';wrap.style.flexWrap='wrap';wrap.style.minWidth='0';title.style.margin='0';subtitle.style.margin='0';subtitle.style.whiteSpace='nowrap';
  }

  function setPageHeader(view,titleText){ensureHeaderLayout();const title=document.getElementById('pageTitle'),subtitle=document.getElementById('pageSubtitle');if(title)title.textContent=titleText||'';if(subtitle){const text=descriptions[view]||'';subtitle.textContent=text;subtitle.style.display=text?'block':'none';}}
  function activate(view){const btn=document.querySelector(`.nav-btn[data-view="${view}"]`),section=document.getElementById(view);if(!btn||!section)return;document.querySelectorAll('.nav-btn').forEach(x=>x.classList.toggle('active',x===btn));document.querySelectorAll('.view').forEach(x=>x.classList.toggle('active',x===section));setPageHeader(view,btn.textContent.trim());if(view==='leads')setTimeout(()=>window.MCCOY_RENDER_LEAD_MAP?.(false),60);}
  function reorderNav(){const nav=document.querySelector('.sidebar nav');if(!nav)return;['dashboard','field','customer-list','teams','leads'].forEach(view=>{const btn=nav.querySelector(`.nav-btn[data-view="${view}"]`);if(btn)nav.appendChild(btn);});const systemBtn=nav.querySelector('.nav-btn[data-view="settings"]');if(systemBtn)nav.appendChild(systemBtn);}
  function bindHeaders(){document.querySelectorAll('.nav-btn').forEach(btn=>{if(btn.dataset.mccoyPageHeaderBound==='1')return;btn.dataset.mccoyPageHeaderBound='1';btn.addEventListener('click',()=>setTimeout(()=>setPageHeader(btn.dataset.view,btn.textContent.trim()),0));});}
  function loadSaleLifecycle(){
    for(const src of [
      'app-sale-lifecycle.js?v=2026082801',
      'app-sales-hub-layout.js?v=2026092201',
      'app-sale-photo-staging.js?v=2026082803',
      'app-confirmed-address-history.js?v=2026091801',
      'app-closest-lead-autofill-v2.js?v=2026091803',
      'app-sales-to-complete.js?v=2026091801',
      'app-sales-coaching.js?v=2026091801',
      'app-gamification-feedback.js?v=2026091801',
      'app-gamification.js?v=2026091801',
      'app-objection-quest.js?v=2026091901',
      'app-sale-order-photo-confirm-popup.js?v=2026091701',
      'app-sale-order-photo-admin.js?v=2026091105',
      'app-admin-session-history.js?v=2026082901',
      'app-lead-pool-independent-activity.js?v=2026091108',
      'app-map-viewport-lock.js?v=2026090402',
      'app-map-manual-control.js?v=2026090402',
      'app-field-lead-editor.js?v=2026092001',
      'app-sale-visit-isolation.js?v=2026082901',
      'app-lead-pool-independent-refresh.js?v=2026082901',
      'app-lead-map-window-entry-fix.js?v=2026091001'
    ]){
      if(document.querySelector(`script[src^="${src.split('?')[0]}"]`))continue;
      const script=document.createElement('script');script.src=src;script.async=false;document.body.appendChild(script);
    }
  }
  function init(){reorderNav();bindHeaders();ensureHeaderLayout();activate('dashboard');loadSaleLifecycle();}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
