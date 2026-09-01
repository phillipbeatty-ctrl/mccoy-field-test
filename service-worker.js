const VERSION='mccoy-app-shell-v2-20260831-update-recovery';
const APP_SHELL_PREFIXES=['mccoy-app-shell-','field-coach-app-shell-'];
const SHELL=['/','/offline.html','/styles.css','/manifest.webmanifest','/mccoy-app-icon.svg','/confirm-email.html','/pending-access.html'];

function deleteOldAppShellCaches(){
  return caches.keys().then(keys=>Promise.all(
    keys
      .filter(key=>APP_SHELL_PREFIXES.some(prefix=>key.startsWith(prefix))&&key!==VERSION)
      .map(key=>caches.delete(key))
  ));
}

self.addEventListener('install',event=>{
  event.waitUntil(
    caches.open(VERSION)
      .then(cache=>cache.addAll(SHELL))
      .then(()=>self.skipWaiting())
  );
});

self.addEventListener('activate',event=>{
  event.waitUntil(deleteOldAppShellCaches().then(()=>self.clients.claim()));
});

self.addEventListener('message',event=>{
  const type=event.data?.type;
  if(type==='SKIP_WAITING'){
    event.waitUntil(self.skipWaiting());
    return;
  }
  if(type==='CLEAR_APP_SHELL'){
    event.waitUntil(deleteOldAppShellCaches());
  }
});

self.addEventListener('fetch',event=>{
  const request=event.request;
  if(request.method!=='GET')return;
  const url=new URL(request.url);
  if(url.hostname.includes('supabase.co')||url.pathname.startsWith('/functions/')||url.pathname.startsWith('/api/'))return;

  if(request.mode==='navigate'){
    event.respondWith(
      fetch(request)
        .then(response=>{
          const copy=response.clone();
          caches.open(VERSION).then(cache=>cache.put(request,copy));
          return response;
        })
        .catch(async()=>await caches.match(request)||await caches.match('/')||await caches.match('/offline.html'))
    );
    return;
  }

  if(url.origin!==self.location.origin)return;
  event.respondWith(
    fetch(request)
      .then(response=>{
        if(response.ok){
          const copy=response.clone();
          caches.open(VERSION).then(cache=>cache.put(request,copy));
        }
        return response;
      })
      .catch(()=>caches.match(request))
  );
});
