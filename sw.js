/* Service Worker — cache-first com atualização em segundo plano (stale-while-revalidate)
   e fallback offline para o app shell. A versão do cache é derivada de um hash curto
   embutido no próprio arquivo a cada deploy. */
const CACHE = 'cronograma-idib-v4';
const CORE = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './data/cronograma.json',
  './data/questoes.json',
  './data/assuntos.json',
  './data/questoes_stats.json',
  './data/simulados/simulados.json',
  './icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const req = e.request;
  const isNav = req.mode === 'navigate';
  const withinOrigin = req.url.startsWith(self.location.origin);

  const fromCache = () => caches.match(req).then(hit =>
    hit || Promise.resolve(null)
  );

  if (isNav) {
    // network-first para o shell: sempre entregar a última versão do HTML
    e.respondWith(
      fetch(req).then(net => {
        if (net.ok) {
          const clone = net.clone();
          caches.open(CACHE).then(c => c.put('./index.html', clone));
        }
        return net;
      }).catch(() =>
        caches.match('./index.html').then(h => h || caches.match('./'))
      )
    );
    return;
  }

  // stale-while-revalidate para assets/dados
  e.respondWith(
    fromCache().then(hit => {
      const update = fetch(req).then(net => {
        if (net.ok && withinOrigin) {
          const clone = net.clone();
          caches.open(CACHE).then(c => c.put(req, clone));
        }
        return net;
      }).catch(() => null);
      if (hit) return hit;
      return update.then(net => net || caches.match('./index.html'));
    })
  );
});