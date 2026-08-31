(()=>{
  const capacitor=window.Capacitor;
  const isNative=Boolean(capacitor?.isNativePlatform?.()||capacitor?.isNative);
  if(!isNative)return;

  const VERSION='1.0.0-beta.1';
  window.MCCOY_NATIVE_APP=Object.freeze({
    active:true,
    version:VERSION,
    platform:String(capacitor?.getPlatform?.()||'native')
  });

  document.documentElement.classList.add('mccoy-native-app');
  document.body?.classList.add('mccoy-native-app');

  const style=document.createElement('style');
  style.textContent=`
    html.mccoy-native-app,body.mccoy-native-app{min-height:100%;overscroll-behavior:none}
    body.mccoy-native-app{padding-top:env(safe-area-inset-top);padding-right:env(safe-area-inset-right);padding-bottom:env(safe-area-inset-bottom);padding-left:env(safe-area-inset-left)}
    #mccoyNativeOfflineBanner{position:fixed;z-index:2147483646;left:env(safe-area-inset-left);right:env(safe-area-inset-right);top:env(safe-area-inset-top);padding:8px 12px;background:#991b1b;color:#fff;font:700 12px/1.3 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;text-align:center;box-shadow:0 2px 10px #0004}
    #mccoyNativeOfflineBanner[hidden]{display:none!important}
  `;
  document.head.appendChild(style);

  const banner=document.createElement('div');
  banner.id='mccoyNativeOfflineBanner';
  banner.setAttribute('role','status');
  banner.setAttribute('aria-live','polite');
  banner.textContent='McCoy is offline. Saved screens remain available, but live leads, assignments, sessions, and sales cannot update.';
  banner.hidden=navigator.onLine;
  document.body.appendChild(banner);

  const syncNetworkState=()=>{banner.hidden=navigator.onLine;};
  window.addEventListener('online',syncNetworkState);
  window.addEventListener('offline',syncNetworkState);

  const appPlugin=capacitor?.Plugins?.App;
  if(appPlugin?.addListener){
    appPlugin.addListener('backButton',event=>{
      if(event?.canGoBack||history.length>1)history.back();
      else appPlugin.minimizeApp?.();
    });
    appPlugin.addListener('appUrlOpen',event=>{
      try{
        const url=new URL(String(event?.url||''));
        if(url.protocol==='mccoy:'){
          const path=`/${url.host}${url.pathname}`.replace(/\/+/g,'/');
          location.assign(`${path}${url.search}${url.hash}`);
          return;
        }
        if(['mccoyplatform.com','www.mccoyplatform.com','mccoy-field-test.vercel.app'].includes(url.hostname)){
          location.assign(`${url.pathname}${url.search}${url.hash}`);
        }
      }catch(_error){}
    });
  }

  window.dispatchEvent(new CustomEvent('mccoy-native-ready',{detail:window.MCCOY_NATIVE_APP}));
})();
