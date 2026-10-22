/* ═══════════════════════════════════════════════════════════════
   MasterDB SCN — Shared App Logic
   • IndexedDB (offline storage)
   • Session (login state)
   • Toast / Sync overlay helpers
   • GPS capture
   • Photo compression
═══════════════════════════════════════════════════════════════ */

'use strict';

/* ─── IndexedDB ──────────────────────────────────────────────── */
const DB_NAME    = 'masterdb_scn';
const DB_VERSION = 1;
let _db = null;

function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      // Store untuk setiap modul — key = id unik auto-generated
      const stores = [
        'anak',           // profil anak
        'observasi',      // observasi ICF
        'buku_harian',    // buku harian
        'irp',            // IRP / perencanaan
        'eval_tengah',    // evaluasi jangka menengah
        'eval_akhir',     // evaluasi akhir
        'sel',            // SEL (placeholder)
        'myp',            // MYP (placeholder)
        'ppdp',           // PPDP KUBIK (placeholder)
        'rujukan',        // rujukan kasus (placeholder)
        'users',          // data login lokal
        'sync_queue',     // antrian sinkronisasi
      ];
      stores.forEach(name => {
        if (!db.objectStoreNames.contains(name)) {
          const store = db.createObjectStore(name, { keyPath: 'id', autoIncrement: true });
          if (name === 'anak') store.createIndex('scn_id', 'scn_id', { unique: false });
          if (['observasi','buku_harian','irp','eval_tengah','eval_akhir','sel','myp','ppdp','rujukan'].includes(name)) {
            store.createIndex('anak_id', 'anak_id', { unique: false });
          }
        }
      });
    };
    req.onsuccess = e => { _db = e.target.result; resolve(_db); };
    req.onerror   = e => reject(e.target.error);
  });
}

async function dbGet(storeName, id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

async function dbGetAll(storeName, indexName, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req   = indexName
      ? store.index(indexName).getAll(value)
      : store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

async function dbPut(storeName, data) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(storeName, 'readwrite');
    const req = tx.objectStore(storeName).put(data);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

async function dbDelete(storeName, id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(storeName, 'readwrite');
    const req = tx.objectStore(storeName).delete(id);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

/* ─── Session ────────────────────────────────────────────────── */
const SESSION_KEY = 'masterdb_session';

function getSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function setSession(data) {
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(data)); } catch {}
}

function clearSession() {
  try { localStorage.removeItem(SESSION_KEY); } catch {}
}

function requireLogin() {
  const s = getSession();
  if (!s) { window.location.href = 'index.html'; return null; }
  return s;
}

/* ─── Toast ──────────────────────────────────────────────────── */
let _toastTimer = null;
function showToast(msg, duration = 2500) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), duration);
}

/* ─── Sync overlay ───────────────────────────────────────────── */
function showSync(msg = 'Menyimpan data…', sub = 'Data tersimpan offline, akan sinkron saat ada sinyal') {
  let el = document.getElementById('sync-overlay');
  if (!el) {
    el = document.createElement('div');
    el.id = 'sync-overlay';
    el.innerHTML = `<div class="sync-spinner"></div>
      <div class="sync-text">${msg}</div>
      <div class="sync-sub">${sub}</div>`;
    document.body.appendChild(el);
  }
  el.querySelector('.sync-text').textContent = msg;
  el.querySelector('.sync-sub').textContent  = sub;
  el.classList.add('show');
}
function hideSync() {
  const el = document.getElementById('sync-overlay');
  if (el) el.classList.remove('show');
}

/* ─── GPS ────────────────────────────────────────────────────── */
function getGPS() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('GPS tidak tersedia di perangkat ini'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      pos => resolve({
        lat:      pos.coords.latitude,
        lng:      pos.coords.longitude,
        alt:      pos.coords.altitude,
        accuracy: pos.coords.accuracy,
        ts:       new Date().toISOString(),
      }),
      err => reject(err),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  });
}

function formatGPS(gps) {
  if (!gps) return '—';
  const lat = gps.lat.toFixed(4);
  const lng = gps.lng.toFixed(4);
  const alt = gps.alt != null ? ` · Alt ${Math.round(gps.alt)}m` : '';
  const acc = gps.accuracy != null ? ` · ±${Math.round(gps.accuracy)}m` : '';
  return `${lat}°, ${lng}°${alt}${acc}`;
}

/* GPS widget helper — attaches click handler to a .gps-block element */
function initGPSWidget(blockEl, onSuccess) {
  const btn     = blockEl.querySelector('.gps-btn');
  const status  = blockEl.querySelector('.gps-status');
  const coords  = blockEl.querySelector('.gps-coords');
  if (!btn) return;

  btn.addEventListener('click', async () => {
    btn.textContent = '…';
    btn.disabled    = true;
    if (status) { status.textContent = 'Mengambil lokasi…'; status.className = 'gps-status wait'; }
    try {
      const gps = await getGPS();
      if (status) { status.textContent = '✓ Lokasi diperoleh'; status.className = 'gps-status ok'; }
      if (coords) coords.textContent = formatGPS(gps);
      btn.textContent = 'Perbarui';
      if (onSuccess) onSuccess(gps);
    } catch (err) {
      if (status) { status.textContent = '✗ Gagal mendapat lokasi'; status.className = 'gps-status'; }
      if (coords) coords.textContent = err.message || 'Error';
      btn.textContent = 'Coba lagi';
      showToast('⚠️ GPS gagal: ' + (err.message || 'Error tidak diketahui'));
    } finally {
      btn.disabled = false;
    }
  });
}

/* ─── Photo compression ──────────────────────────────────────── */
const MAX_PHOTO_SIZE = 10 * 1024 * 1024; // 10 MB
const TARGET_SIZE    = 800 * 1024;        // compress to ~800 KB

function compressPhoto(file) {
  return new Promise((resolve, reject) => {
    if (file.size <= TARGET_SIZE) { resolve(file); return; }
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let w = img.width, h = img.height;
        // Scale down if > 1600px
        const MAX_DIM = 1600;
        if (w > MAX_DIM || h > MAX_DIM) {
          if (w > h) { h = Math.round(h * MAX_DIM / w); w = MAX_DIM; }
          else       { w = Math.round(w * MAX_DIM / h); h = MAX_DIM; }
        }
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        canvas.toBlob(blob => {
          if (blob) resolve(new File([blob], file.name, { type: 'image/jpeg' }));
          else reject(new Error('Kompresi gagal'));
        }, 'image/jpeg', 0.82);
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/* Photo widget helper */
function initPhotoWidget(containerEl, onChange) {
  const input  = containerEl.querySelector('input[type="file"]');
  const thumbs = containerEl.querySelector('.photo-thumbs');
  const trigger = containerEl.querySelector('.photo-upload');
  const photos  = []; // array of { file, dataUrl }

  if (trigger) trigger.addEventListener('click', () => input && input.click());

  if (!input) return { getPhotos: () => photos };

  input.addEventListener('change', async () => {
    const files = Array.from(input.files || []);
    for (const file of files) {
      if (file.size > MAX_PHOTO_SIZE) {
        showToast(`⚠️ ${file.name} terlalu besar (maks 10 MB)`);
        continue;
      }
      try {
        showToast('🔄 Mengompresi foto…');
        const compressed = await compressPhoto(file);
        const dataUrl    = await fileToDataUrl(compressed);
        photos.push({ file: compressed, dataUrl, name: file.name });
        renderThumb(dataUrl, photos.length - 1);
        if (onChange) onChange(photos);
      } catch {
        showToast('⚠️ Gagal memproses foto');
      }
    }
    input.value = '';
  });

  function renderThumb(dataUrl, idx) {
    if (!thumbs) return;
    const div = document.createElement('div');
    div.className = 'photo-thumb';
    div.innerHTML = `<img src="${dataUrl}" alt="foto"><button class="photo-thumb-rm" data-idx="${idx}">×</button>`;
    div.querySelector('.photo-thumb-rm').addEventListener('click', e => {
      e.stopPropagation();
      photos.splice(idx, 1);
      thumbs.innerHTML = '';
      photos.forEach((p, i) => renderThumb(p.dataUrl, i));
      if (onChange) onChange(photos);
    });
    thumbs.appendChild(div);
  }

  return { getPhotos: () => photos };
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = e => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/* ─── Tag / checkbox toggle ──────────────────────────────────── */
function initTags(containerEl, onChange) {
  containerEl.querySelectorAll('.tag').forEach(tag => {
    tag.addEventListener('click', () => {
      tag.classList.toggle('selected');
      if (onChange) onChange(getSelectedTags(containerEl));
    });
  });
}

function getSelectedTags(containerEl) {
  return Array.from(containerEl.querySelectorAll('.tag.selected'))
    .map(t => t.dataset.value || t.textContent.replace('✓', '').trim());
}

/* ─── Cantril scale ──────────────────────────────────────────── */
function initCantril(containerEl, onChange) {
  containerEl.querySelectorAll('.cantril-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      containerEl.querySelectorAll('.cantril-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      if (onChange) onChange(parseInt(btn.dataset.val, 10));
    });
  });
}

/* ─── Offline indicator ──────────────────────────────────────── */
function initOfflineIndicator(badgeEl) {
  function update() {
    if (!badgeEl) return;
    if (navigator.onLine) {
      badgeEl.textContent = '🟢 Online';
      badgeEl.style.background = 'rgba(59,173,110,.2)';
      badgeEl.style.color      = '#1A5C35';
    } else {
      badgeEl.textContent = '⚡ Offline';
      badgeEl.style.background = '';
      badgeEl.style.color      = '';
    }
  }
  window.addEventListener('online',  update);
  window.addEventListener('offline', update);
  update();
}

/* ─── Date helpers ───────────────────────────────────────────── */
function today() {
  return new Date().toISOString().split('T')[0];
}

function formatDate(isoStr) {
  if (!isoStr) return '—';
  const d = new Date(isoStr);
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
}

function hitungUmur(tglLahir) {
  if (!tglLahir) return null;
  const lahir = new Date(tglLahir);
  const now   = new Date();
  let umur = now.getFullYear() - lahir.getFullYear();
  const m  = now.getMonth() - lahir.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < lahir.getDate())) umur--;
  return umur;
}

/* ─── Sync queue ─────────────────────────────────────────────── */
async function addToSyncQueue(storeName, recordId) {
  await dbPut('sync_queue', {
    store: storeName,
    record_id: recordId,
    ts: new Date().toISOString(),
    status: 'pending',
  });
}

/* ─── Export global ──────────────────────────────────────────── */
window.MDB = {
  // DB
  openDB, dbGet, dbGetAll, dbPut, dbDelete,
  // Session
  getSession, setSession, clearSession, requireLogin,
  // UI helpers
  showToast, showSync, hideSync,
  // GPS
  getGPS, formatGPS, initGPSWidget,
  // Photo
  compressPhoto, initPhotoWidget, fileToDataUrl,
  // Tags / Cantril
  initTags, getSelectedTags, initCantril,
  // Offline
  initOfflineIndicator,
  // Date
  today, formatDate, hitungUmur,
  // Sync
  addToSyncQueue,
};
