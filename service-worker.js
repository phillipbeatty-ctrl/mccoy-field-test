const VERSION='field-coach-app-shell-v2-20260831-brand';
const SHELL=['/','/offline.html','/styles.css','/manifest.webmanifest','/field-coach-app-icon.svg','/app-branding.js','/confirm-email.html','/pending-access.html'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(VERSION).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>(key.startsWith('mccoy-app-shell-')||key.startsWith('field-coach-app-shell-'))&&key!==VERSION).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',event=>{
  const request=event.request;
  if(request.method!=='GET')return;
  const url=new URL(request.url);
  if(url.hostname.includes('supabase.co')||url.pathname.startsWith('/functions/')||url.pathname.startsWith('/api/'))return;
  if(request.mode==='navigate'){
    event.respondWith(fetch(request).then(response=>{const copy=response.clone();caches.open(VERSION).then(cache=>cache.put(request,copy));return response;}).catch(async()=>await caches.match(request)||await caches.match('/')||await caches.match('/offline.html')));
    return;
  }
  if(url.origin!==self.location.origin)return;
  event.respondWith(fetch(request).then(response=>{if(response.ok){const copy=response.clone();caches.open(VERSION).then(cache=>cache.put(request,copy));}return response;}).catch(()=>caches.match(request)));
});
