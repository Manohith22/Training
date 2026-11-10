/* Training app service worker.
   The page (index.html) is network-first: a new upload shows up the next time
   the app opens online. Fonts and icons are cache-first. Offline, everything
   comes from the cache. Bump VERSION only if fonts or icons change. */
const CACHE_PREFIX = "training-";
const VERSION = CACHE_PREFIX + "v1.3.0";
const SHELL = [
  "./", "./index.html", "./manifest.webmanifest",
  "./anek-latin-latin.woff2", "./newsreader-latin.woff2",
  "./icon-192.png", "./icon-512.png", "./icon-maskable-512.png",
  "./apple-touch-icon.png", "./favicon-32.png"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      // Only this app’s old caches: other apps on the same github.io origin keep theirs.
      .then(keys => Promise.all(keys.filter(k => k.startsWith(CACHE_PREFIX) && k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function notifyIfChanged(fresh, old){
  if (!old) return;
  const [a, b] = await Promise.all([fresh.clone().text(), old.text()]);
  if (a === b) return;
  const all = await self.clients.matchAll({ type: "window" });
  all.forEach(c => c.postMessage({ type: "updated" }));
}

async function page(event){
  const cache = await caches.open(VERSION);
  const cached = await cache.match("./index.html");
  const net = fetch(event.request.url, { cache: "no-cache", credentials: "same-origin" }).then(async res => {
    if (res && res.ok){
      // A page request can’t be answered with a redirected response, so rebuild it if GitHub redirected.
      if (res.redirected) res = new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers: res.headers });
      await cache.put("./index.html", res.clone());
      return res;
    }
    throw new Error("bad response");
  });
  if (!cached) return net;
  // Wait up to 3 s for the network (gym signal), then fall back to the saved copy.
  let usedCache = false;
  const timeout = new Promise(r => setTimeout(() => { usedCache = true; r(cached.clone()); }, 3000));
  const winner = Promise.race([net.catch(() => { usedCache = true; return cached.clone(); }), timeout]);
  event.waitUntil(net.then(res => usedCache ? notifyIfChanged(res, cached.clone()) : null).catch(() => {}));
  return winner;
}

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  // The page itself is always network-first, including the app’s own “is there a newer version?” check.
  if (req.mode === "navigate" || /\/(index\.html)?$/.test(url.pathname)){ event.respondWith(page(event)); return; }
  event.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res && res.ok){ const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
      return res;
    }))
  );
});
