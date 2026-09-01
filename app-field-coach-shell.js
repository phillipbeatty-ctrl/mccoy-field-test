// Field Coach product shell: naming, approved visual systems, PWA lifecycle, and iOS/iPadOS ergonomics.
(()=>{
  const PRODUCT_NAME='Field Coach';
  const COMPANY_NAME='McCoy Platform LLC';
  const LOOKS={
    command:{label:'Command · Logo 3',logo:'/assets/branding/logo-3-command.svg',icon:'/field-coach-app-icon.svg',theme:'#080a0d'},
    velocity:{label:'Velocity · Logo 1',logo:'/assets/branding/logo-1-velocity.svg',icon:'/field-coach-app-icon.svg',theme:'#020304'},
    signal:{label:'Signal · Logo 6',logo:'/assets/branding/logo-6-signal.svg',icon:'/field-coach-app-icon.svg',theme:'#fff8ed'}
  };
  const params=new URLSearchParams(location.search);
  const requested=String(params.get('look')||'').toLowerCase();
  let remembered='';
  try{remembered=localStorage.getItem('field_coach_visual_look')||'';}catch(_error){}
  const look=LOOKS[requested]?requested:(LOOKS[remembered]?remembered:'command');
  const isIOS=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
  const isStandalone=matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;

  function upsertMeta(name,content,attribute='name'){
    let meta=document.head.querySelector(`meta[${attribute}="${name}"]`);
    if(!meta){meta=document.createElement('meta');meta.setAttribute(attribute,name);document.head.appendChild(meta);}
    meta.setAttribute('content',content);
  }
  function upsertLink(rel,href,sizes=''){
    let link=document.head.querySelector(`link[rel="${rel}"]${sizes?`[sizes="${sizes}"]`:''}`);
    if(!link){link=document.createElement('link');link.rel=rel;if(sizes)link.sizes=sizes;document.head.appendChild(link);}
    link.href=href;
  }
  function applyHead(){
    document.title=`${PRODUCT_NAME} — Field Sales Operations`;
    upsertMeta('application-name',PRODUCT_NAME);
    upsertMeta('apple-mobile-web-app-capable','yes');
    upsertMeta('apple-mobile-web-app-status-bar-style',look==='signal'?'default':'black-translucent');
    upsertMeta('apple-mobile-web-app-title',PRODUCT_NAME);
    upsertMeta('mobile-web-app-capable','yes');
    upsertMeta('theme-color',LOOKS[look].theme);
    upsertMeta('description','Field Coach provides secure lead mapping, field sessions, coaching, sales tracking, and organization-managed access.');
    upsertLink('manifest','/manifest.webmanifest');
    upsertLink('icon','/field-coach-app-icon.svg');
    upsertLink('apple-touch-icon','/field-coach-app-icon.svg');
  }
  function applyBrand(){
    document.body.dataset.fcLook=look;
    document.body.classList.toggle('ios-web',isIOS);
    document.body.classList.toggle('fc-standalone',isStandalone);
    const brandTitle=document.querySelector('.brand-title');
    if(brandTitle)brandTitle.textContent=PRODUCT_NAME;
    const mark=document.querySelector('.brand .logo');
    if(mark){mark.innerHTML=`<img src="${LOOKS[look].icon}" alt="${PRODUCT_NAME}">`;mark.setAttribute('aria-label',PRODUCT_NAME);}
    const brandText=document.querySelector('.brand>div:last-child');
    if(brandText&&!brandText.querySelector('.fc-company-byline')){
      const byline=document.createElement('div');byline.className='fc-company-byline';byline.textContent=COMPANY_NAME;brandText.appendChild(byline);
    }
    const pageTitle=document.getElementById('pageTitle');
    if(pageTitle&&/McCoy Platform|McCoy Field Coach/i.test(pageTitle.textContent||''))pageTitle.textContent=PRODUCT_NAME;
    document.querySelectorAll('#authGate h2').forEach(node=>{
      node.textContent=(node.textContent||'')
        .replace(/McCoy Field Coach(?: V\d+(?:\.\d+)*)?/gi,PRODUCT_NAME)
        .replace(/Create McCoy Field Coach Account/gi,`Create ${PRODUCT_NAME} Account`);
    });
  }
  function addPicker(){
    if(params.get('compare')!=='1'||document.getElementById('fcLookPicker'))return;
    const host=document.querySelector('.top-actions')||document.body;
    const picker=document.createElement('div');picker.id='fcLookPicker';picker.className='fc-look-picker';picker.setAttribute('aria-label','Field Coach visual design');
    for(const [key,value] of Object.entries(LOOKS)){
      const button=document.createElement('button');button.type='button';button.textContent=value.label.split(' · ')[0];button.setAttribute('aria-pressed',String(key===look));
      button.addEventListener('click',()=>{try{localStorage.setItem('field_coach_visual_look',key);}catch(_error){}const next=new URL(location.href);next.searchParams.set('look',key);next.searchParams.set('compare','1');location.href=next.toString();});
      picker.appendChild(button);
    }
    host.prepend(picker);
  }
  function updateViewport(){
    const height=window.visualViewport?.height||window.innerHeight;
    document.documentElement.style.setProperty('--fc-visual-height',`${Math.round(height)}px`);
  }
  function notifyLayout(){
    updateViewport();
    window.dispatchEvent(new CustomEvent('field-coach-layout-change',{detail:{ios:isIOS,standalone:isStandalone,look}}));
    setTimeout(()=>window.dispatchEvent(new Event('resize')),50);
  }
  function registerWorker(){
    if(!('serviceWorker' in navigator)||location.protocol!=='https:')return;
    navigator.serviceWorker.register('/service-worker.js',{scope:'/'}).then(registration=>{
      registration.update().catch(()=>{});
      registration.addEventListener('updatefound',()=>window.dispatchEvent(new CustomEvent('field-coach-update-available')));
    }).catch(error=>console.error('Field Coach service worker registration failed',error));
  }

  applyHead();
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{applyBrand();addPicker();notifyLayout();registerWorker();},{once:true});
  else{applyBrand();addPicker();notifyLayout();registerWorker();}

  const observer=new MutationObserver(()=>applyBrand());
  observer.observe(document.documentElement,{childList:true,subtree:true});
  setTimeout(()=>observer.disconnect(),15000);
  window.visualViewport?.addEventListener('resize',notifyLayout,{passive:true});
  window.addEventListener('orientationchange',notifyLayout,{passive:true});
  window.addEventListener('pageshow',event=>{if(event.persisted)notifyLayout();});
  window.FIELD_COACH_PRODUCT={name:PRODUCT_NAME,company:COMPANY_NAME,look,looks:LOOKS,isIOS,isStandalone};
  window.dispatchEvent(new CustomEvent('field-coach-shell-ready',{detail:window.FIELD_COACH_PRODUCT}));
})();
