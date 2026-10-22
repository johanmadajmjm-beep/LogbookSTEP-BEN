// sw-register.js — Ditempatkan di <head> setiap halaman, atau di-import dari app.js
// Daftarkan Service Worker jika browser mendukung

(function () {
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { scope: './' })
      .then(reg => {
        console.log('[SW] Terdaftar, scope:', reg.scope);

        // Deteksi update SW baru
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if (!newWorker) return;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              // Ada versi baru — tampilkan notifikasi update
              showUpdateBanner(reg);
            }
          });
        });
      })
      .catch(err => console.warn('[SW] Gagal daftar:', err));

    // Dengar pesan dari SW
    navigator.serviceWorker.addEventListener('message', event => {
      if (!event.data) return;
      if (event.data.type === 'SYNC_AVAILABLE') {
        // Trigger sync dari halaman jika ada window.MDB.syncAll
        if (window.MDB && typeof window.MDB.syncAll === 'function') {
          window.MDB.syncAll();
        }
      }
    });
  });

  function showUpdateBanner(reg) {
    // Cari elemen banner yang mungkin ada di halaman
    let banner = document.getElementById('swUpdateBanner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'swUpdateBanner';
      banner.style.cssText = [
        'position:fixed', 'bottom:max(20px,env(safe-area-inset-bottom,0px))',
        'left:50%', 'transform:translateX(-50%)',
        'background:#1B6CA8', 'color:#fff',
        'padding:10px 20px', 'border-radius:24px',
        'font-size:14px', 'font-family:system-ui,sans-serif',
        'display:flex', 'align-items:center', 'gap:12px',
        'z-index:9999', 'box-shadow:0 4px 16px rgba(0,0,0,.25)',
        'white-space:nowrap'
      ].join(';');
      banner.innerHTML = `
        <span>🔄 Update tersedia</span>
        <button onclick="window.__swReload()" style="
          background:#fff;color:#1B6CA8;border:none;border-radius:12px;
          padding:5px 12px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit
        ">Perbarui</button>
        <button onclick="this.closest('#swUpdateBanner').remove()" style="
          background:none;border:none;color:rgba(255,255,255,.7);font-size:18px;cursor:pointer;padding:0 2px
        ">✕</button>`;
      document.body.appendChild(banner);
    }

    window.__swReload = () => {
      if (reg.waiting) {
        reg.waiting.postMessage({ type: 'SKIP_WAITING' });
      }
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        window.location.reload();
      }, { once: true });
    };
  }
})();
