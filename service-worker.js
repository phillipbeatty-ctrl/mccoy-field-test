const VERSION='field-coach-app-shell-v11-20260903-live-feed-company-team-preview';
const APP_SHELL_PREFIXES=['mccoy-app-shell-','field-coach-app-shell-'];
const SHELL=[
  '/',
  '/offline.html',
  '/install.html',
  '/install-ios.html',
  '/download.html',
  '/styles.css',
  '/manifest.webmanifest',
  '/assets/brand/official-logo-source.png',
  '/assets/favicon-64.png',
  '/assets/apple-touch-icon-180.png',
  '/assets/icon-192.png',
  '/assets/icon-512.png',
  '/assets/icon-maskable-512.png',
  '/app-product-brand.js',
  '/app-organization-access-gate.js?v=2026090201',
  '/app-supabase-client.js?v=2026090201',
  '/app-sales.js?v=2026082417',
  '/app-sales-products.js?v=2026090201',
  '/app-accounting-records.js?v=2026090301',
  '/app-customer-list-approval-refresh.js?v=2026090301',
  '/app-customer-list-credit-ranking-refresh.js?v=2026090201',
  '/app-page-layout.js',
  '/app-sale-lifecycle.js?v=2026090201',
  '/app-sale-photo-staging.js?v=2026090201',
  '/app-live-wins.js',
  '/app-live-feed.js?v=2026090303',
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
