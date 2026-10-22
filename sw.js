// MasterDB SCN — Service Worker
// Strategi: Cache-first untuk assets statis, Network-first untuk data

const CACHE_NAME = 'masterdb-scn-v2';
const CACHE_VERSION = 2;

// File yang di-cache saat install
const PRECACHE_URLS = [
  './index.html',
  './signup.html',
  './profil.html',
  './observasi.html',
  './irp.html',
  './buku-harian.html',
  './eval-tengah.html',
  './eval-akhir.html',
  './app.js',
  './manifest.json',
  // Placeholder modules (akan muncul setelah dibangun)
  // './sel.html',
  // './myp.html',
  // './ppdp.html',
  // './rujukan.html',
];

// ─── Install ─────────────────────────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        // Cache satu per satu agar satu file gagal tidak merusak install
        return Promise.allSettled(
          PRECACHE_URLS.map(url =>
            cache.add(url).catch(err => {
              console.warn('[SW] Gagal cache:', url, err.message);
            })
          )
        );
      })
      .then(() => {
        console.log('[SW] Install selesai —', CACHE_NAME);
        return self.skipWaiting();
      })
  );
});

// ─── Activate ────────────────────────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(k => k !== CACHE_NAME)
          .map(k => {
            console.log('[SW] Hapus cache lama:', k);
            return caches.delete(k);
          })
      ))
      .then(() => {
        console.log('[SW] Aktif —', CACHE_NAME);
        return self.clients.claim();
      })
  );
});

// ─── Fetch ───────────────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Hanya tangani request dari origin yang sama
  if (url.origin !== location.origin) return;

  // Jangan intercept request ke Supabase / API eksternal
  if (url.hostname.includes('supabase') || url.pathname.startsWith('/rest/') || url.pathname.startsWith('/auth/')) {
    return;
  }

  // Strategi berdasarkan tipe resource
  const isNavigation = event.request.mode === 'navigate';
  const isHTMLPage = url.pathname.endsWith('.html') || url.pathname === '/' || url.pathname.endsWith('/');
  const isStaticAsset = url.pathname.match(/\.(js|css|json|png|jpg|jpeg|svg|ico|woff2?|ttf)$/i);

  if (isStaticAsset || isHTMLPage || isNavigation) {
    // Cache-first dengan network fallback untuk semua asset app
    event.respondWith(
      caches.match(event.request)
        .then(cached => {
          if (cached) {
            // Ada di cache — gunakan, sekaligus refresh di background
            const networkFetch = fetch(event.request)
              .then(response => {
                if (response && response.status === 200 && response.type === 'basic') {
                  caches.open(CACHE_NAME).then(cache => cache.put(event.request, response.clone()));
                }
                return response;
              })
              .catch(() => {});
            // Tidak menunggu network — langsung kembalikan cache
            return cached;
          }

          // Belum di cache — ambil dari network lalu cache
          return fetch(event.request)
            .then(response => {
              if (!response || response.status !== 200 || response.type !== 'basic') {
                return response;
              }
              const toCache = response.clone();
              caches.open(CACHE_NAME).then(cache => cache.put(event.request, toCache));
              return response;
            })
            .catch(() => {
              // Offline dan tidak ada cache — kembalikan halaman offline fallback
              if (isNavigation || isHTMLPage) {
                return caches.match('./index.html');
              }
              return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
            });
        })
    );
  }
  // Request lain (IndexedDB, fetch API internal) dibiarkan langsung
});

// ─── Background Sync ─────────────────────────────────────────────────────────
self.addEventListener('sync', event => {
  if (event.tag === 'sync-masterdb') {
    event.waitUntil(doBackgroundSync());
  }
});

async function doBackgroundSync() {
  // Notifikasi ke semua tab bahwa sync tersedia
  const clients = await self.clients.matchAll({ type: 'window' });
  clients.forEach(client => {
    client.postMessage({ type: 'SYNC_AVAILABLE', ts: Date.now() });
  });
}

// ─── Push Notifications (placeholder) ────────────────────────────────────────
self.addEventListener('push', event => {
  if (!event.data) return;
  try {
    const data = event.data.json();
    event.waitUntil(
      self.registration.showNotification(data.title || 'MasterDB SCN', {
        body: data.body || '',
        icon: './icons/icon-192.png',
        badge: './icons/icon-192.png',
        tag: 'masterdb-notification',
        data: data.url ? { url: data.url } : {}
      })
    );
  } catch (e) {
    console.warn('[SW] Push payload error:', e);
  }
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data && event.notification.data.url;
  if (url) {
    event.waitUntil(clients.openWindow(url));
  }
});

// ─── Message dari halaman ─────────────────────────────────────────────────────
self.addEventListener('message', event => {
  if (!event.data) return;

  switch (event.data.type) {
    case 'SKIP_WAITING':
      self.skipWaiting();
      break;

    case 'CACHE_URLS':
      // Halaman bisa meminta SW untuk cache URL tertentu
      if (Array.isArray(event.data.urls)) {
        caches.open(CACHE_NAME).then(cache => {
          event.data.urls.forEach(url => cache.add(url).catch(() => {}));
        });
      }
      break;

    case 'CLEAR_CACHE':
      caches.delete(CACHE_NAME).then(() => {
        if (event.source) event.source.postMessage({ type: 'CACHE_CLEARED' });
      });
      break;

    case 'GET_VERSION':
      if (event.source) {
        event.source.postMessage({ type: 'SW_VERSION', version: CACHE_VERSION, cacheName: CACHE_NAME });
      }
      break;
  }
});
