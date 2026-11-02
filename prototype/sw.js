/* sw.js — يحفظ صفحات البرنامج وملفاته على الجهاز ليفتح بدون إنترنت
 *
 * - الصفحات والملفات: من الشبكة أولاً (لتصل التحديثات فوراً)، ومن النسخة المحفوظة عند انقطاع الإنترنت.
 * - طلبات /api/ (بيانات خادم المطعم) لا تمر من هنا أبداً.
 * - الخطوط من Google تُحفظ عند أول تحميل.
 * عند تغيير قائمة الملفات ارفع رقم CACHE.
 */
const CACHE = 'restaurant-v2';
const FILES = [
  'admin.html', 'waiter.html', 'connect.html', 'core.js', 'theme.css', 'pwa.js', 'vendor/qrcode-1.0.0.min.js',
  'manifest.webmanifest', 'waiter.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(FILES.map(f =>
    fetch(f, { cache: 'no-cache' }).then(r => r.ok && c.put(f, r)).catch(() => {})
  ))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    if (url.pathname.includes('/api/')) return;
    e.respondWith(fromNetwork(req));
  } else if (/fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return res;
    })));
  }
});

// من الشبكة، وإن انقطعت أو تأخرت أكثر من 4 ثوانٍ نعرض المحفوظة
async function fromNetwork(req) {
  const cache = await caches.open(CACHE);
  const net = fetch(req).then(res => {
    if (res.ok) cache.put(req, res.clone());
    return res;
  });
  const saved = await cache.match(req, { ignoreSearch: true });
  if (!saved) return net;
  return Promise.race([
    net.catch(() => saved),
    new Promise(r => setTimeout(() => r(saved), 4000))
  ]);
}
