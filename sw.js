// Service Worker — استراتيجية "الشبكة أولاً" حتى يحصل المستخدم دائماً على أحدث نسخة
// مع نسخة محفوظة تعمل عند انقطاع الإنترنت
const CACHE = 'sanad-v2';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(
  caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => clients.claim())
));

self.addEventListener('fetch', e => {
  // لا نخزن طلبات الذكاء الاصطناعي ولا الطلبات غير GET
  if (e.request.method !== 'GET' || e.request.url.includes('/api/')) return;
  e.respondWith(
    fetch(e.request)
      .then(r => {
        const copy = r.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return r;
      })
      .catch(() => caches.match(e.request))
  );
});
