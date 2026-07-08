// Service Worker — استراتيجية "الشبكة أولاً" حتى يحصل المستخدم دائماً على أحدث نسخة
// مع نسخة محفوظة تعمل عند انقطاع الإنترنت
const CACHE = 'sanad-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(clients.claim()));

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
