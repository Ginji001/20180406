const CACHE = "hachiroku-techo-v63";
const ASSETS = ["./about.html", "./privacy.html", "./terms.html", "./", "./index.html?v=63", "./styles.css?v=63", "./app.js?v=63", "./manifest.webmanifest?v=63", "./favicon-anime.png", "./apple-touch-icon-anime.png", "./icon-anime-192.png", "./icon-anime-512.png", "./icon-anime-maskable-512.png", "./paper-sheet.pdf", "./google-calendar.js?v=63", "./cloud-sync.js?v=63"];
self.addEventListener("install", (event) => { self.skipWaiting(); event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS))); });
self.addEventListener("activate", (event) => event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(fetch(event.request).then((response) => { const copy = response.clone(); caches.open(CACHE).then((cache) => cache.put(event.request, copy)); return response; }).catch(() => caches.match(event.request).then((cached) => cached || caches.match("./index.html"))));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    const client = list.find((item) => "focus" in item);
    return client ? client.focus() : self.clients.openWindow("./");
  }));
});
