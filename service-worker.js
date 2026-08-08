const CACHE_NAME='pep-enterprise-static-v500a11';
const STATIC_ASSETS=['/manifest.webmanifest','/icons/pep-192.png','/icons/pep-512.png'];
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(STATIC_ASSETS)).catch(()=>{}));
});
self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter(k=>k.startsWith('pep-enterprise-')&&k!==CACHE_NAME).map(k=>caches.delete(k)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin)return;
  // HTML y JavaScript operativo siempre vienen de red para evitar runtimes antiguos.
  if(event.request.mode==='navigate'||url.pathname==='/'||url.pathname.endsWith('/index.html')||url.pathname.endsWith('.js')){
    event.respondWith(fetch(event.request,{cache:'no-store'}));
    return;
  }
  // Manifest e iconos sí pueden ser cache-first.
  if(url.pathname==='/manifest.webmanifest'||url.pathname.startsWith('/icons/')){
    event.respondWith(caches.match(event.request).then(hit=>hit||fetch(event.request).then(response=>{const copy=response.clone();caches.open(CACHE_NAME).then(c=>c.put(event.request,copy)).catch(()=>{});return response})));
    return;
  }
  // Resto: red normal, sin persistir runtime dinámico.
  event.respondWith(fetch(event.request));
});
self.addEventListener('message',event=>{if(event.data?.type==='SKIP_WAITING')self.skipWaiting()});
