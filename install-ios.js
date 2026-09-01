(()=>{
  const standalone=window.matchMedia('(display-mode: standalone)').matches||window.navigator.standalone===true
  const ios=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1)
  const installedStatus=document.getElementById('installedStatus')
  const deviceWarning=document.getElementById('deviceWarning')
  const copyLink=document.getElementById('copyLink')

  if(standalone&&installedStatus)installedStatus.hidden=false
  if(!ios&&deviceWarning)deviceWarning.hidden=false

  copyLink?.addEventListener('click',async event=>{
    const button=event.currentTarget
    try{
      await navigator.clipboard.writeText(`${location.origin}/install-ios.html`)
      button.textContent='INSTALL LINK COPIED'
    }catch{
      button.textContent='COPY THIS PAGE ADDRESS'
    }
  })

  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('/service-worker.js',{updateViaCache:'none'}).catch(()=>{})
  }
})()
