const VERSION='field-coach-app-shell-v3-20260901';
const APP_SHELL_PREFIXES=['mccoy-app-shell-','field-coach-app-shell-'];
const SHELL=[
  '/',
  '/offline.html',
  '/install.html',
  '/field-coach-designs.html',
  '/styles.css',
  '/field-coach-shell.css',
  '/manifest.webmanifest',
  '/field-coach-app-icon.svg',
  '/app-field-coach-shell.js',
  '/app-organization-access-gate.js',
  '/assets/branding/logo-3-command.svg',
  '/assets/branding/logo-1-velocity.svg',
  '/assets/branding/logo-6-signal.svg',
  '/confirm-email.html',
  '/pending-access.html'
];

function deleteOldAppShellCaches(){
  return caches.keys().then(keys=>Promise.all(
    keys
      .filter(key=>APP_SHELL_PREFIXES.some(prefix=>key.startsWith(prefix))&&key!==VERSION)
      .map(key=>caches.delete(key))
  ));
}

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(VERSION).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting()));
});

self.addEventListener('activate',event=>{
  event.waitUntil(deleteOldAppShellCaches().then(()=>self.clients.claim()));
});

self.addEventListener('message',event=>{
  const type=event.data?.type;
  if(type==='SKIP_WAITING'){event.waitUntil(self.skipWaiting());return;}
  if(type==='CLEAR_APP_SHELL')event.waitUntil(deleteOldAppShellCaches());
});

self.addEventListener('fetch',event=>{
  const request=event.request;
  if(request.method!=='GET')return;
  const url=new URL(request.url);
  if(url.hostname.includes('supabase.co')||url.pathname.startsWith('/functions/')||url.pathname.startsWith('/api/'))return;

  if(request.mode==='navigate'){
    event.respondWith(
      fetch(request,{cache:'no-store'})
        .then(response=>{
          if(response.ok){const copy=response.clone();caches.open(VERSION).then(cache=>cache.put(request,copy));}
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
        if(response.ok){const copy=response.clone();caches.open(VERSION).then(cache=>cache.put(request,copy));}
        return response;
      })
      .catch(()=>caches.match(request))
  );
});
