/* CryptoAI PRO — service worker: offline shell for the site + the web app.
   HTML is network-first (so updates land), static assets are stale-while-revalidate.
   Exchange APIs and AI endpoints are never cached. */
const VERSION = "cryptoai-pro-ai-v1";
const SHELL = [
  "./", "./index.html", "./manifest.webmanifest", "./og-cover.png", "./robots.txt",
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png", "./icons/favicon-32.png",
  "./app/", "./app/index.html", "./app/app.js", "./app/ta.js"
];
const BYPASS = /(api\.binance\.com|api\.bybit\.com|www\.okx\.com|openrouter\.ai|huggingface\.co|openai\.com)/;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin && BYPASS.test(url.hostname)) return;   // live data always goes to the network
  if (url.origin !== location.origin) return;

  const isHTML = req.mode === "navigate" || (req.headers.get("accept") || "").includes("text/html");
  if (isHTML) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => { });
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match("./index.html")))
    );
    return;
  }
  e.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req).then((res) => {
        if (res && res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => { }); }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
