(()=>{
  let promptEvent=null
  const button=document.getElementById('browserInstall')
  const text=document.getElementById('browserInstallText')
  const installedStatus=document.getElementById('installedStatus')
  const standalone=window.matchMedia('(display-mode: standalone)').matches||window.navigator.standalone===true

  if(standalone&&installedStatus)installedStatus.hidden=false

  window.addEventListener('beforeinstallprompt',event=>{
    event.preventDefault()
    promptEvent=event
    if(button)button.disabled=false
    if(text)text.textContent='Field Coach is ready to install on this device.'
  })

  button?.addEventListener('click',async()=>{
    if(!promptEvent)return
    button.disabled=true
    await promptEvent.prompt()
    const choice=await promptEvent.userChoice
    if(text){
      text.textContent=choice.outcome==='accepted'
        ?'Installation accepted. Open Field Coach from the new app icon.'
        :'Installation was not completed. You can try again from the browser menu.'
    }
    promptEvent=null
  })

  window.addEventListener('appinstalled',()=>{
    if(installedStatus)installedStatus.hidden=false
    if(button)button.disabled=true
  })

  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('/service-worker.js',{updateViaCache:'none'}).catch(()=>{})
  }
})()
