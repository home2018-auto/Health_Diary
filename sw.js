/* স্বাস্থ্য ডায়েরি — অফলাইন সাপোর্ট (Service Worker)
 *
 * একই github.io ঠিকানায় একাধিক ড্যাশবোর্ড থাকলে ব্রাউজারের "ক্যাশ" সবার জন্য এক জায়গায় থাকে।
 * তাই এখানে:
 *  1) ক্যাশের নামে এই অ্যাপের ঠিকানা (scope) জুড়ে দেওয়া হয়েছে — অন্য অ্যাপের সাথে মিলবে না
 *  2) শুধু এই অ্যাপের নিজের পুরনো ক্যাশ মোছা হয় — অন্যের ক্যাশে হাত দেওয়া হয় না
 *  3) পেজের একটি দ্বিতীয় কপি IndexedDB-তে রাখা হয় — অন্য কেউ ক্যাশ মুছে দিলেও অফলাইনে খুলবে
 *  4) কপি হারালে অনলাইনে খুললেই নিজে আবার জমা করে নেয়
 */
const SCOPE = self.registration.scope;                 // যেমন https://user.github.io/Health_Diary/
const PFX = 'health-diary@' + SCOPE + '@';             // শুধু এই অ্যাপের ক্যাশ চেনার নাম
const V = PFX + 'v9';                                  // sw.js বদলালে v9 → v10 করুন
const CORE = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png'];
const HTML = { 'content-type': 'text/html;charset=utf-8' };
const OFFLINE_PAGE = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>অফলাইন</title>' +
  '<body style="font-family:sans-serif;padding:28px;line-height:1.7"><h2>📴 অফলাইন — পেজটি এখনো এই ডিভাইসে জমা হয়নি</h2>' +
  '<p>ইন্টারনেট চালু করে একবার এই ঠিকানা খুলুন, ১০ সেকেন্ড অপেক্ষা করুন, তারপর আবার খুলুন। এরপর থেকে নেট ছাড়াই চলবে।</p>' +
  '<button onclick="location.reload()" style="font-size:18px;padding:10px 18px">আবার চেষ্টা করুন</button></body>';

/* ---- পেজের দ্বিতীয় কপি রাখার ছোট IndexedDB ---- */
function idb() {
  return new Promise((res, rej) => {
    const q = indexedDB.open('hd-shell@' + SCOPE, 1);
    q.onupgradeneeded = () => q.result.createObjectStore('s');
    q.onsuccess = () => res(q.result);
    q.onerror = () => rej(q.error);
  });
}
function idbPut(k, v) {
  return idb().then(d => new Promise((res, rej) => {
    const t = d.transaction('s', 'readwrite'); t.objectStore('s').put(v, k); t.oncomplete = res; t.onerror = rej;
  })).catch(() => {});
}
function idbGet(k) {
  return idb().then(d => new Promise((res, rej) => {
    const q = d.transaction('s').objectStore('s').get(k); q.onsuccess = () => res(q.result); q.onerror = rej;
  })).catch(() => null);
}

/* ---- ফাইল জমা করা ---- */
async function precache() {
  const c = await caches.open(V);
  await Promise.all(CORE.map(async u => {
    try {
      const res = await fetch(new Request(u, { cache: 'reload' }));
      if (!res.ok) return;
      await c.put(u, res.clone());
      if ((u === './' || u === './index.html') && (res.headers.get('content-type') || '').indexOf('text/html') > -1) {
        await idbPut('shell', await res.clone().text());
      }
    } catch (e) { /* অফলাইন হলে চুপচাপ বাদ */ }
  }));
}
async function ensure() {                                // কিছু হারিয়ে গেলে আবার জমা
  const c = await caches.open(V);
  const has = (await c.match('./index.html')) || (await c.match('./'));
  const shell = await idbGet('shell');
  if (!has || !shell) await precache();
}

self.addEventListener('install', e => {
  e.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) {
      if (k.indexOf(PFX) === 0 && k !== V) await caches.delete(k);          // শুধু নিজের পুরনো ক্যাশ
      else if (/^fh-v\d+$/.test(k)) {                                        // এই অ্যাপের আগের সংস্করণের নাম
        const c = await caches.open(k);
        for (const rq of await c.keys()) if (rq.url.indexOf(SCOPE) === 0) await c.delete(rq);
      }
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', e => {
  if (e.data === 'ensure') e.waitUntil(ensure());
  if (e.data === 'refresh') e.waitUntil(precache());
});

self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;                        // Google Apps Script-এর POST ছোঁয়া হয় না
  const u = new URL(r.url);
  const font = u.hostname === 'fonts.googleapis.com' || u.hostname === 'fonts.gstatic.com';
  if (u.origin !== location.origin && !font) return;     // অন্য সাইটের অনুরোধ সরাসরি যাবে

  // পেজ: আগে নেটওয়ার্ক (নতুন সংস্করণের জন্য); ধীর বা অফলাইন হলে ক্যাশ → IndexedDB-র কপি → বার্তা-পেজ
  if (r.mode === 'navigate') {
    e.respondWith((async () => {
      const cache = await caches.open(V);
      const cached = (await cache.match(r)) || (await cache.match('./index.html')) || (await cache.match('./'));
      const shell = cached ? null : await idbGet('shell');
      const keep = res => {
        if (res && res.ok && (res.headers.get('content-type') || '').indexOf('text/html') > -1) {
          cache.put(r, res.clone()); cache.put('./index.html', res.clone());
          res.clone().text().then(t => idbPut('shell', t));
        }
        return res;
      };
      const net = fetch(r).then(keep);
      net.catch(() => {});
      if (!cached && !shell) {
        try { return await net; } catch (x) { return new Response(OFFLINE_PAGE, { status: 503, headers: HTML }); }
      }
      try {
        return await Promise.race([net, new Promise((_, rej) => setTimeout(rej, 3500))]);
      } catch (x) {
        return cached || new Response(shell, { headers: HTML });
      }
    })());
    return;
  }

  // বাকি ফাইল/ফন্ট: ক্যাশে থাকলে সেটাই, পাশাপাশি নতুনটা জমা
  e.respondWith(caches.open(V).then(c => c.match(r).then(m => {
    const net = fetch(r).then(res => {
      if (res && (res.ok || res.type === 'opaque')) c.put(r, res.clone());
      return res;
    }).catch(() => m);
    return m || net;
  })));
});
