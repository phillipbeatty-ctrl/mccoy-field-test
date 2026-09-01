(()=>{
  const PRODUCT_NAME='Field Coach';
  const LEGAL_NAME='McCoy Platform LLC';
  const LEGAL_TOKEN='__FIELD_COACH_LEGAL_ENTITY__';
  const replacements=[
    [/McCoy Platform — Unified Field & Sales App/g,'Field Coach — Field & Sales App'],
    [/McCoy Field Coach V9\.2/g,PRODUCT_NAME],
    [/McCoy Field Coach/g,PRODUCT_NAME],
    [/McCoy Platform Sales Hub/g,'Field Coach Sales Hub'],
    [/McCoy Pending Account Access/g,'Field Coach Pending Account Access'],
    [/McCoy Lead Import/g,'Field Coach Lead Import'],
    [/McCoy Platform/g,PRODUCT_NAME],
    [/Install McCoy/g,'Install Field Coach'],
    [/INSTALL MCCOY APP/g,'INSTALL FIELD COACH'],
    [/OPEN MCCOY/g,'OPEN FIELD COACH'],
    [/BACK TO MCCOY PLATFORM/g,'BACK TO FIELD COACH'],
    [/BACK TO MCCOY/g,'BACK TO FIELD COACH'],
    [/CONTINUE TO MCCOY/g,'CONTINUE TO FIELD COACH'],
    [/McCoy account/g,'Field Coach account'],
    [/McCoy login/g,'Field Coach login'],
    [/McCoy session/g,'Field Coach session'],
    [/McCoy password/g,'Field Coach password'],
    [/McCoy Admin/g,'Field Coach Admin'],
    [/McCoy administrator/g,'Field Coach administrator'],
    [/McCoy email/g,'Field Coach email'],
    [/McCoy production/g,'Field Coach production'],
    [/McCoy is/g,'Field Coach is'],
    [/McCoy was/g,'Field Coach was'],
    [/McCoy's/g,"Field Coach's"]
  ];
  const skippedTags=new Set(['SCRIPT','STYLE','NOSCRIPT','CODE','PRE','TEXTAREA']);
  const brandedAttributes=['title','aria-label','placeholder','alt'];

  function transform(value){
    const original=String(value??'');
    let next=original.replaceAll(LEGAL_NAME,LEGAL_TOKEN);
    for(const [pattern,replacement] of replacements)next=next.replace(pattern,replacement);
    return next.replaceAll(LEGAL_TOKEN,LEGAL_NAME);
  }
  function brandTextNode(node){
    if(!node||node.nodeType!==Node.TEXT_NODE||skippedTags.has(node.parentElement?.tagName))return;
    const next=transform(node.data);
    if(next!==node.data)node.data=next;
  }
  function brandElement(element){
    if(!(element instanceof Element)||skippedTags.has(element.tagName))return;
    for(const attribute of brandedAttributes){
      if(!element.hasAttribute(attribute))continue;
      const current=element.getAttribute(attribute)||'';
      const next=transform(current);
      if(next!==current)element.setAttribute(attribute,next);
    }
    if(element.classList.contains('logo')&&element.textContent?.trim()==='M'){
      element.textContent='FC';
      element.setAttribute('aria-label','Field Coach');
    }
  }
  function brandSubtree(root){
    if(!root)return;
    if(root.nodeType===Node.TEXT_NODE){brandTextNode(root);return;}
    if(!(root instanceof Element)&&root!==document.body)return;
    if(root instanceof Element)brandElement(root);
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_ELEMENT|NodeFilter.SHOW_TEXT);
    let node;
    while((node=walker.nextNode())){
      if(node.nodeType===Node.TEXT_NODE)brandTextNode(node);
      else brandElement(node);
    }
  }

  const nativeAlert=window.alert?.bind(window);
  const nativeConfirm=window.confirm?.bind(window);
  const nativePrompt=window.prompt?.bind(window);
  if(nativeAlert)window.alert=message=>nativeAlert(transform(message));
  if(nativeConfirm)window.confirm=message=>nativeConfirm(transform(message));
  if(nativePrompt)window.prompt=(message,defaultValue)=>nativePrompt(transform(message),defaultValue);

  let observer=null;
  let applying=false;
  function observe(){
    if(!document.body||observer)return;
    observer=new MutationObserver(records=>{
      if(applying)return;
      applying=true;
      observer.disconnect();
      try{
        for(const record of records){
          if(record.type==='characterData')brandTextNode(record.target);
          else if(record.type==='attributes')brandElement(record.target);
          else for(const node of record.addedNodes)brandSubtree(node);
        }
      }finally{
        observer.observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:brandedAttributes});
        applying=false;
      }
    });
    observer.observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:brandedAttributes});
  }
  function applyBrand(){
    document.title=transform(document.title)||PRODUCT_NAME;
    brandSubtree(document.body);
    let style=document.getElementById('fieldCoachBrandStyles');
    if(!style){
      style=document.createElement('style');
      style.id='fieldCoachBrandStyles';
      style.textContent='.logo{font-size:14px!important;letter-spacing:-.5px!important}.brand-title{white-space:nowrap}';
      document.head.appendChild(style);
    }
    observe();
    window.dispatchEvent(new CustomEvent('field-coach-brand-ready',{detail:{productName:PRODUCT_NAME,legalName:LEGAL_NAME}}));
  }

  window.FIELD_COACH_BRAND={productName:PRODUCT_NAME,legalName:LEGAL_NAME,transform,apply:applyBrand};
  window.addEventListener('mccoy-access-ready',()=>queueMicrotask(applyBrand));
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',applyBrand,{once:true});
  else applyBrand();
})();
