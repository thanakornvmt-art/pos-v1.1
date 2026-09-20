importScripts('/sw-assets.js');
const CACHE = 'morning-pos-shell-' + self.POS_ASSETS.version;
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(c => c.addAll(['/pos', '/login', '/print', '/manifest.webmanifest', '/icon.svg', ...self.POS_ASSETS.files]))); });
self.addEventListener('activate', event => { event.waitUntil(self.clients.claim()); });
self.addEventListener('message', event => {
  if (event.data?.type === 'CACHE_MENU' && Array.isArray(event.data.urls)) event.waitUntil(caches.open(CACHE).then(async cache => { await Promise.allSettled(event.data.urls.filter(url => typeof url === 'string' && new URL(url, self.location.origin).origin === self.location.origin).map(url => cache.add(url))); }));
});
self.addEventListener('fetch', event => {
 const req=event.request;const url=new URL(req.url);
 if(req.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/')||req.headers.has('RSC')||url.searchParams.has('_rsc'))return;
 if(req.mode==='navigate'){
  if(!['/pos','/login','/print'].includes(url.pathname))return;
  event.respondWith(fetch(req).then(res=>{if(res.ok){const copy=res.clone();event.waitUntil(caches.open(CACHE).then(c=>c.put(url.pathname,copy)));}return res;}).catch(async()=>await caches.match(url.pathname)||Response.error()));return;
 }
 if(url.pathname.startsWith('/_next/static/')||url.pathname.startsWith('/menu/')||url.pathname==='/icon.svg')event.respondWith(caches.match(req).then(cached=>cached||fetch(req).then(res=>{if(res.ok){const copy=res.clone();event.waitUntil(caches.open(CACHE).then(c=>c.put(req,copy)));}return res;})));
});
