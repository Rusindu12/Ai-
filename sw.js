/* CryptoAI PRO — service worker: offline shell for the site + the web app.
   Pages and scripts are network-first (so a deploy never mixes an old app.js with
   a new index.html), images are stale-while-revalidate, and everything falls back
   to the cache when offline. Exchange APIs and AI endpoints are never cached.
   Bump VERSION whenever app/ changes so installed copies refresh. */
const VERSION = "cryptoai-pro-ai-v4";
const SHELL = [
  "./", "./index.html", "./manifest.webmanifest", "./og-cover.png", "./robots.txt",
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png", "./icons/favicon-32.png",
  "./app/", "./app/index.html", "./app/ta.js", "./app/patterns.js", "./app/brain.js",
  "./app/app.js", "./app/sysmgmt.js", "./app/worker.js"
];
const IMAGE = /\.(png|jpe?g|gif|webp|svg|ico)$/i;
const NET_TIMEOUT = 5000;   // on a flaky connection, fall back to the cached copy after 5 s

self.addEventListener("install", (e) => {
  // cache: "reload" skips the browser HTTP cache, so the new shell is really the new deploy
  e.waitUntil(caches.open(VERSION)
    .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: "reload" }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

function remember(req, res) {
  if (res && res.ok && res.type === "basic") {
    const copy = res.clone();
    caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => { });
  }
  return res;
}

function networkFirst(req, isPage) {
  // navigation requests cannot be re-created with an init object, so pass them through as-is
  const network = (isPage ? fetch(req) : fetch(req, { cache: "no-cache" })).then((res) => remember(req, res));
  const fallback = () => caches.match(req).then((r) => r || (isPage ? caches.match("./index.html") : undefined));
  const timer = new Promise((resolve) => setTimeout(resolve, NET_TIMEOUT));
  return Promise.race([network, timer.then(() => caches.match(req).then((r) => r || network))])
    .then((res) => res || fallback())
    .catch(() => fallback().then((r) => r || Response.error()));
}

function staleWhileRevalidate(req) {
  return caches.match(req).then((cached) => {
    const network = fetch(req).then((res) => remember(req, res)).catch(() => cached);
    return cached || network;
  });
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;   // exchange / AI APIs always go straight to the network

  const isPage = req.mode === "navigate" || (req.headers.get("accept") || "").includes("text/html");
  e.respondWith(IMAGE.test(url.pathname) ? staleWhileRevalidate(req) : networkFirst(req, isPage));
});
