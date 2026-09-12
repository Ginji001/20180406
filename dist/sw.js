const CACHE = "hachiroku-techo-v20";
const ASSETS = ["./about.html", "./privacy.html", "./terms.html", "./", "./index.html?v=20", "./styles.css?v=20", "./app.js?v=20", "./manifest.webmanifest?v=20", "./favicon.svg", "./icon-192.png", "./icon-512.png", "./paper-sheet.pdf", "./google-calendar.js?v=20"];
self.addEventListener("install", (event) => event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS))));
self.addEventListener("activate", (event) => event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))));
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(fetch(event.request).then((response) => { const copy = response.clone(); caches.open(CACHE).then((cache) => cache.put(event.request, copy)); return response; }).catch(() => caches.match(event.request).then((cached) => cached || caches.match("./index.html"))));
});

