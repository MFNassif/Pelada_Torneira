const CACHE='pelada-v5';
const ASSETS=[
  '/Pelada_Torneira/',
  '/Pelada_Torneira/index.html',
  '/Pelada_Torneira/app.js',
  '/Pelada_Torneira/manifest.json',
  '/Pelada_Torneira/logo.jpg',
  '/Pelada_Torneira/icon-192.png',
  '/Pelada_Torneira/icon-512.png'
];
self.addEventListener('install',e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS).catch(err=>console.warn('Cache partial:',err))));
  self.skipWaiting();
});
self.addEventListener('activate',e=>{
  e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch',e=>{
  if(['googleapis','gstatic','firebase','firestore'].some(s=>e.request.url.includes(s)))return;
  e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request).catch(()=>caches.match('/Pelada_Torneira/index.html'))));
});
