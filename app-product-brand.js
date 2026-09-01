// Field Coach product identity. McCoy Platform LLC remains the legal company name.
(()=>{
  if(globalThis.__fieldCoachProductBrandInstalled)return;
  globalThis.__fieldCoachProductBrandInstalled=true;

  const PRODUCT='Field Coach';
  const LEGAL='McCoy Platform LLC';
  const LOGO='/assets/brand/official-logo-source.png';
  const replacements=new Map([
    ['McCoy Field Coach V9.2',PRODUCT],
    ['Create McCoy Field Coach Account',`Create ${PRODUCT} Account`],
    ['Complete your access request for McCoy Field Coach V9.2.',`Complete your access request for ${PRODUCT}.`],
    ['Unified McCoy Field Coach and Sales platform is connected and ready for testing.',`${PRODUCT} is connected and ready for testing.`]
  ]);

  function replaceTextNode(node){
    const current=node.nodeValue?.trim();
    const replacement=replacements.get(current);
    if(!replacement)return;
    const next=node.nodeValue.replace(current,replacement);
    if(next!==node.nodeValue)node.nodeValue=next;
  }

  function normalizeText(root=document){
    if(root?.nodeType===Node.TEXT_NODE){
      replaceTextNode(root);
      return;
    }
    if(!root)return;
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
    const nodes=[];
    while(walker.nextNode())nodes.push(walker.currentNode);
    for(const node of nodes)replaceTextNode(node);
  }

  function ensureAuthBrand(){
    const card=document.querySelector('#authGate .auth-card');
    if(!card||card.querySelector('.field-coach-auth-brand'))return;
    const brand=document.createElement('div');
    brand.className='field-coach-auth-brand';
    brand.innerHTML=`<img src="${LOGO}" alt=""><div><strong>${PRODUCT}</strong><span>by ${LEGAL}</span></div>`;
    card.prepend(brand);
  }

  function apply(){
    if(document.title!==PRODUCT)document.title=PRODUCT;
    const title=document.getElementById('pageTitle');
    if(title&&/McCoy Platform|McCoy Field Coach/i.test(title.textContent||''))title.textContent=PRODUCT;
    const brandTitle=document.querySelector('.sidebar .brand-title');
    if(brandTitle&&(brandTitle.textContent||'').trim()!==PRODUCT)brandTitle.textContent=PRODUCT;
    ensureAuthBrand();
  }

  const style=document.createElement('style');
  style.textContent=`
    .field-coach-auth-brand{display:flex;align-items:center;gap:12px;margin:0 0 18px;padding:0 0 16px;border-bottom:1px solid #e5e7eb}
    .field-coach-auth-brand img{width:58px;height:58px;border-radius:14px;object-fit:cover;background:#050505}
    .field-coach-auth-brand strong{display:block;font-size:19px;color:#111827}
    .field-coach-auth-brand span{display:block;margin-top:2px;color:#f97316;font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}
    .sidebar .brand>.logo{overflow:hidden;background:#050505!important;padding:0!important}
    .sidebar .brand>.logo img{display:block;width:100%;height:100%;object-fit:cover}
  `;
  document.head.appendChild(style);

  let scheduled=false;
  function scheduleApply(){
    if(scheduled)return;
    scheduled=true;
    queueMicrotask(()=>{
      scheduled=false;
      apply();
    });
  }

  const observer=new MutationObserver(records=>{
    for(const record of records){
      for(const node of record.addedNodes)normalizeText(node);
    }
    scheduleApply();
  });
  observer.observe(document.documentElement,{subtree:true,childList:true});

  const initialize=()=>{
    normalizeText(document);
    apply();
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initialize,{once:true});else initialize();
})();
