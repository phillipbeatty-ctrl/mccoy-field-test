// Enforces a fixed page order in the sidebar nav, regardless of which script
// inserted which .nav-btn or when (several run asynchronously, after their
// own admin/status checks resolve). Rather than editing each script's own
// insertion point -- fragile, and breaks again the next time a page is
// added -- this watches the nav for any change and re-sorts to the target
// order every time, so the final visual order is guaranteed independent of
// insertion timing.
(()=>{
  if(window.MCCOY_NAV_ORDER)return;
  window.MCCOY_NAV_ORDER=true;

  // Matched in order; each entry is a selector for one .nav-btn. Sale Review
  // has no data-view (it opens a separate overlay panel, not a .view
  // section), so it's matched by id instead.
  const ORDER=[
    '[data-view="dashboard"]',
    '[data-view="field"]',
    '[data-view="leads"]',
    '[data-view="comms"]',
    '[data-view="teams"]',
    '#saleReviewBtn'
  ];

  let sorting=false;
  function sortNav(){
    const nav=document.querySelector('.sidebar nav');
    if(!nav||sorting)return;
    sorting=true;
    try{
      let anchor=null;
      for(const selector of ORDER){
        const btn=nav.querySelector(selector);
        if(!btn)continue;
        if(anchor){if(anchor.nextElementSibling!==btn)anchor.insertAdjacentElement('afterend',btn);}
        else if(nav.firstElementChild!==btn)nav.insertBefore(btn,nav.firstElementChild);
        anchor=btn;
      }
      // IMPORT REAL LEADS isn't a .nav-btn (it's moved into the sidebar by
      // app-page-layout.js) but is meant to sit immediately before System;
      // since System is part of "the rest" and may have just moved, restore
      // that relationship rather than leaving the import button stranded
      // wherever System used to be.
      const importBtn=document.getElementById('adminLeadImportBtn');
      const systemBtn=nav.querySelector('[data-view="settings"]');
      if(importBtn&&systemBtn&&importBtn.nextElementSibling!==systemBtn){
        systemBtn.insertAdjacentElement('beforebegin',importBtn);
      }
    }finally{sorting=false;}
  }

  const nav=document.querySelector('.sidebar nav');
  if(nav){
    sortNav();
    new MutationObserver(()=>sortNav()).observe(nav,{childList:true});
  }
  window.addEventListener('mccoy-access-ready',sortNav);
})();
