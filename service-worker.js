const VERSION='field-coach-app-shell-v25-20260914-photo-outcome-fixes';
const APP_SHELL_PREFIXES=['mccoy-app-shell-','field-coach-app-shell-'];
const SHELL=[
  '/app-ui-refresh.js?v=2026091106',
  '/app-teams-regions.js?v=2026092301',
  '/app-rep-dashboard.js?v=2026091106',
  '/app-lead-disposition-colors.js?v=2026091106',
  '/app-lead-detail-panel.js?v=2026091106',
  '/app-compensation.js?v=2026092201',
  '/',
  '/offline.html',
  '/install.html',
  '/install-ios.html',
  '/download.html',
  '/styles.css?v=2026092201',
  '/app-part1.js?v=2026091103',
  '/app-part2.js?v=2026091108',
  '/app-page-layout.js?v=2026091512',
  '/app-gps-placement.js?v=2026091109',
  '/app-auth.js?v=2026091110',
  '/app-field-features.js?v=2026091703',
  '/app-lead-address-core.js?v=2026091106',
  '/app-typed-lead-address.js?v=2026091108',
  '/app-distance-to-lead.js?v=2026091106',
  '/app-auto-door-arrival.js?v=2026091707',
  '/app-confirmed-address-history.js?v=2026091801',
  '/app-closest-lead-autofill-v2.js?v=2026091803',
  '/app-provider-portals.js?v=2026091105',
  '/app-provider-verification.js?v=2026091105',
  '/app-sale-order-photo-admin.js?v=2026091105',
  '/app-sale-order-photo-pilot.js?v=2026091105',
  '/app-provider-sale-router.js?v=2026091105',
  '/app-field-lead-editor.js?v=2026092001',
  '/app-sales-hub-layout.js?v=2026092201',
  '/app-field-addresses.js?v=2026091103',
  '/manifest.webmanifest',
  '/assets/brand/official-logo-source.png',
  '/assets/favicon-64.png',
  '/assets/apple-touch-icon-180.png',
  '/assets/icon-192.png',
  '/assets/icon-512.png',
  '/assets/icon-maskable-512.png',
  '/app-product-brand.js',
  '/app-organization-access-gate.js?v=2026090402',
  '/app-supabase-client.js?v=2026090201',
  '/app-sph-home-admin-only.js?v=2026090502',
  '/app-lead-map-window-controls.js?v=2026091901',
  '/app-lead-map.js?v=2026091903',
  '/app-lead-map-window-entry-fix.js?v=2026091001',
  '/app-lead-pool-independent-activity.js?v=2026091108',
  '/app-map-viewport-lock.js?v=2026090402',
  '/app-map-manual-control.js?v=2026090402',
  '/app-sales.js?v=2026091801',
  '/app-sales-products.js?v=2026091105',
  '/app-accounting-records.js?v=2026092301',
  '/app-customer-list-approval-refresh.js?v=2026091105',
  '/app-customer-list-credit-ranking-refresh.js?v=2026090201',
  '/app-sale-lifecycle.js?v=2026090201',
  '/app-sale-photo-staging.js?v=2026091404',
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
