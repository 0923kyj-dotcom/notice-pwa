/* 서비스 워커: 오프라인 캐시 + 알림 시연(지연 표시, 클릭 이동)
   배포할 때마다 CACHE 버전을 올린다 (mgam-v1 → mgam-v2 …). 올리지 않으면 이전 파일이 계속 보인다. */
const CACHE = 'mgam-v5';
const PRECACHE = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './data/notices.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      // 브라우저 HTTP 캐시를 건너뛰고 서버에서 새로 받아 저장한다
      .then(c => c.addAll(PRECACHE.map(u => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('mgam-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// [10초 뒤 알림] 앱이 백그라운드로 가도 서비스 워커가 기다렸다가 띄운다 (서버 푸시 아님)
self.addEventListener('message', event => {
  const m = event.data || {};
  if (m.type !== 'notify-later' || !m.title) return;
  const delay = Math.min(Math.max(+m.delay || 0, 0), 60000);
  event.waitUntil(
    new Promise(r => setTimeout(r, delay))
      .then(() => self.registration.showNotification(m.title, m.options || {}))
  );
});

// 알림을 누르면: 닫고 → 열린 앱 창이 있으면 포커스해서 그 공지를 열고, 없으면 ./?id= 로 새로 연다
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const id = event.notification.data && event.notification.data.id;
  const target = new URL(id ? './?id=' + encodeURIComponent(id) : './', self.registration.scope).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const win = wins.find(c => c.url.startsWith(self.registration.scope));
    if (win) {
      await win.focus();
      win.postMessage({ type: 'open-notice', id });
      return;
    }
    await self.clients.openWindow(target);
  })());
});

// 같은 출처의 GET만 캐시 우선. 다른 출처(원문 링크 등)는 건드리지 않는다.
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // 앱 화면 요청(./?id=123 등)은 쿼리와 상관없이 캐시된 앱 셸로 답한다
    const hit = req.mode === 'navigate'
      ? (await cache.match(req, { ignoreSearch: true })) || (await cache.match('./'))
      : await cache.match(req);
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    } catch (e) {
      if (req.mode === 'navigate') return (await cache.match('./')) || Response.error();
      return Response.error();
    }
  })());
});
