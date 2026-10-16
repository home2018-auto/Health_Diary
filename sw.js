/* স্বাস্থ্য ডায়েরি — অফলাইন সাপোর্ট (Service Worker) */
const V = 'fh-v1';
const CORE = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(V)
      .then(c => Promise.all(CORE.map(u => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;                       // Google Apps Script-এর POST ছোঁয়া হয় না
  const u = new URL(r.url);
  const font = u.hostname === 'fonts.googleapis.com' || u.hostname === 'fonts.gstatic.com';
  if (u.origin !== location.origin && !font) return;    // অন্য সাইটের (Google script) অনুরোধ সরাসরি যাবে

  // পেজ: আগে নেটওয়ার্ক (নতুন সংস্করণ পেতে), ধীর/অফলাইন হলে ক্যাশ
  if (r.mode === 'navigate') {
    e.respondWith((async () => {
      const cache = await caches.open(V);
      const cached = (await cache.match(r)) || (await cache.match('./index.html')) || (await cache.match('./'));
      const net = fetch(r).then(res => { if (res.ok) cache.put(r, res.clone()); return res; });
      net.catch(() => {});
      if (!cached) return net;
      try {
        return await Promise.race([net, new Promise((_, rej) => setTimeout(rej, 3500))]);
      } catch (x) {
        return cached;
      }
    })());
    return;
  }

  // বাকি ফাইল/ফন্ট: ক্যাশ থাকলে সেটাই, পাশাপাশি নতুনটা ক্যাশে রাখা
  e.respondWith(
    caches.match(r).then(m => {
      const net = fetch(r).then(res => {
        if (res && (res.ok || res.type === 'opaque')) { const cp = res.clone(); caches.open(V).then(c => c.put(r, cp)); }
        return res;
      }).catch(() => m);
      return m || net;
    })
  );
});
