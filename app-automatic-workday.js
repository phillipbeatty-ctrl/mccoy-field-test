// One-touch automatic workday: Start Knocking begins the daily record. Breaks,
// tracking gaps, homeward departure, and local-midnight closure are server-derived.
(()=>{
  if(window.MCCOY_AUTOMATIC_WORKDAY)return
  const stop=document.getElementById('stopKnockingBtn')
  if(stop){
    stop.classList.add('hidden')
    stop.hidden=true
    stop.setAttribute('aria-hidden','true')
    stop.tabIndex=-1
  }
  function message(active=false){
    const stateText=document.getElementById('fieldState')
    if(stateText&&active)stateText.textContent='Knocking — Automatic Workday Active'
    const panel=document.querySelector('.field-controls')
    if(panel&&!document.getElementById('automaticWorkdayNotice')){
      const note=document.createElement('div')
      note.id='automaticWorkdayNotice'
      note.className='muted small'
      note.textContent='Breaks, tracking gaps, travel home, and the end of the workday are recognized automatically. No Stop button is required.'
      panel.appendChild(note)
    }
  }
  window.addEventListener('mccoy-field-session-started',()=>{if(stop)stop.classList.add('hidden');message(true)})
  window.addEventListener('mccoy-field-session-ended',()=>{if(stop)stop.classList.add('hidden')})
  setTimeout(()=>message(typeof state!=='undefined'&&!!state.session),0)
  window.MCCOY_AUTOMATIC_WORKDAY={enabled:true}
})()
