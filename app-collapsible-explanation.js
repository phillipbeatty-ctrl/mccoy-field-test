// Reusable collapsed-by-default explanation toggle. The original version of
// this (Dashboard's "How rankings work") was built as a one-off, hand-coded
// directly into app-compensation.js with no shared helper -- so when other
// cards needed the same "long explanation hidden by default, with a button
// to reveal it" treatment, there was nothing to reach for, and it was
// never extended past that first card. This exists so the next one is a
// single function call instead of a repeat of that hand-coding.
(function(){
  if(window.MCCOY_WRAP_EXPLANATION)return;

  const style=document.createElement('style');style.textContent=`
    .mccoy-explain-toggle{font-size:11px;font-weight:800;color:#1455d9;background:#eaf0ff;border:0;padding:5px 10px;border-radius:999px;cursor:pointer;white-space:nowrap}
    .mccoy-explain-panel{margin:6px 0 8px;padding:10px 12px;background:#f7f8fa;border-radius:10px}
    .mccoy-explain-panel p{margin:0;color:#6b7280;font-size:12px;line-height:1.5}
  `;document.head.appendChild(style);

  // Wraps an existing paragraph element in a collapsed-by-default panel with
  // a toggle button inserted just before it. label is the collapsed verb
  // phrase, e.g. "How rankings work" -- the caret and expanded/collapsed
  // state are handled automatically.
  function wrapExplanation(paragraphEl,label){
    if(!paragraphEl || paragraphEl.dataset.mccoyWrapped)return;
    paragraphEl.dataset.mccoyWrapped='1';
    const panel=document.createElement('div');
    panel.className='mccoy-explain-panel';
    panel.hidden=true;
    paragraphEl.parentNode.insertBefore(panel,paragraphEl);
    panel.appendChild(paragraphEl);

    const toggle=document.createElement('button');
    toggle.type='button';
    toggle.className='mccoy-explain-toggle';
    toggle.setAttribute('aria-expanded','false');
    toggle.textContent=label+' \u25be';
    panel.parentNode.insertBefore(toggle,panel);

    toggle.onclick=function(){
      const wasHidden=panel.hidden;
      panel.hidden=!wasHidden;
      toggle.setAttribute('aria-expanded',String(wasHidden));
      toggle.textContent=label+(wasHidden?' \u25b4':' \u25be');
    };
    return toggle;
  }

  window.MCCOY_WRAP_EXPLANATION=wrapExplanation;
})();
