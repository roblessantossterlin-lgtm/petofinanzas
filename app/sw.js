/* PETO Web — Service Worker (distinto al de la app móvil)

   El SW de la app (www/sw.js) es cache-first: sirve siempre la
   copia guardada y puede dejar al usuario atrapado en una versión
   vieja. Este, pensado para la web pública:

   - Navegaciones (el HTML): RED primero; la caché solo es respaldo
     sin conexión. Así una versión nueva se ve al recargar.
   - Resto de archivos propios (JS/CSS/iconos): stale-while-
     revalidate — responde al instante con la caché y refresca en
     segundo plano para la próxima visita.
   - NUNCA intercepta peticiones de otro origen: las de Supabase
     (https://*.supabase.co) pasan directas a la red.
   - No se activa solo al instalarse una versión nueva: espera el
     mensaje SKIP_WAITING que envía web.js cuando la persona toca
     «Actualizar» en la barra de aviso. */
'use strict';

const CACHE_NAME = 'peto-web-v5';
const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './web.css',
  './vendor/supabase.js',
  './web.js',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // jamás tocar peticiones externas (Supabase)

  /* Navegaciones: red primero, caché de respaldo. */
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  /* Archivos propios: stale-while-revalidate. */
  event.respondWith(
    caches.match(req).then((hit) => {
      const network = fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          return res;
        })
        .catch(() => hit);
      return hit || network;
    })
  );
});
