// Service worker: offline app shell, background bill checks, push reminders.
// VERSION changes whenever app files change (npm run stamp), which triggers the update prompt.

const VERSION = '9d60ba7d0e94';
const CACHE = `money-tracker-${VERSION}`;
const ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/app.js',
  'js/calc.js',
  'js/charts.js',
  'js/context.js',
  'js/crypto.js',
  'js/dates.js',
  'js/db.js',
  'js/forms.js',
  'js/icons.js',
  'js/money.js',
  'js/notify.js',
  'js/store.js',
  'js/sync.js',
  'js/ui.js',
  'js/views/bills.js',
  'js/views/common.js',
  'js/views/home.js',
  'js/views/insights.js',
  'js/views/lock.js',
  'js/views/money.js',
  'js/views/plan.js',
  'js/views/settings.js',
  'icons/icon.svg',
  'icons/icon-32.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-512.png',
  'icons/apple-touch-icon.png',
  'icons/badge-72.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS.map((a) => new Request(a, { cache: 'reload' })))));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('money-tracker-') && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.includes('/api/')) return;
  if (req.mode === 'navigate') {
    event.respondWith(caches.match('index.html').then((hit) => hit || fetch(req)));
    return;
  }
  event.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req)));
});

// ------------------------------------------------------------------ reminders

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('money-tracker', 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('records')) db.createObjectStore('records', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function meta(key, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('meta', value === undefined ? 'readonly' : 'readwrite');
    const store = tx.objectStore('meta');
    let result;
    if (value === undefined) { const r = store.get(key); r.onsuccess = () => { result = r.result?.value; }; } else store.put({ key, value });
    tx.oncomplete = () => { db.close(); resolve(result); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const dayDiff = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

/** Same rules as digestSummary() in calc.js. */
function summarize(digest, today) {
  const res = { overdue: [], today: [], soon: [] };
  for (const it of digest.items) {
    const n = dayDiff(today, it.due);
    if (n < 0 && n >= -14) res.overdue.push(it);
    else if (n === 0) res.today.push(it);
    else if (n > 0 && n <= digest.reminderDays) res.soon.push(it);
  }
  return res;
}

function message(sum) {
  const parts = [];
  if (sum.overdue.length) parts.push(`${sum.overdue.length} overdue`);
  if (sum.today.length) parts.push(`${sum.today.length} due today`);
  if (sum.soon.length) parts.push(`${sum.soon.length} due soon`);
  if (!parts.length) return null;
  const names = [...sum.overdue, ...sum.today, ...sum.soon].map((i) => i.name).filter(Boolean);
  return {
    title: `Bills: ${parts.join(', ')}`,
    body: names.length ? names.slice(0, 4).join(', ') + (names.length > 4 ? '…' : '') : 'Open Money Tracker to review and mark them paid.',
  };
}

async function checkBills(fromPush) {
  const today = localToday();
  const [digest, last] = await Promise.all([meta('digest'), meta('lastNotified')]);
  if (!fromPush && last === today) return;
  const msg = digest ? message(summarize(digest, today)) : null;
  const options = { tag: 'bill-reminder', icon: 'icons/icon-192.png', badge: 'icons/badge-72.png', data: { url: './#/bills' } };
  if (!msg) {
    // A push must always show something; this only happens if bills were paid on another device.
    if (fromPush) await self.registration.showNotification('Money Tracker', { ...options, body: 'Open the app to check your bills.' });
    return;
  }
  await self.registration.showNotification(msg.title, { ...options, body: msg.body });
  await meta('lastNotified', today);
}

self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'bill-reminders') event.waitUntil(checkBills(false));
});

self.addEventListener('push', (event) => {
  event.waitUntil(checkBills(true));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || './', self.registration.scope).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if (w.url.startsWith(self.registration.scope)) {
        await w.focus();
        if ('navigate' in w) await w.navigate(target).catch(() => {});
        return;
      }
    }
    await self.clients.openWindow(target);
  })());
});
