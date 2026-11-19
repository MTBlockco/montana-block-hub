// Service worker: makes the hub installable and keeps the app shell available offline.
// Data always comes live from the server; only the static files are cached.
const CACHE = "mb-hub-v76";
const SHELL = ["./", "index.html", "styles.css", "app.js", "config.js", "sayings.js", "manifest.webmanifest"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return; // never cache API calls
  // Network first so updates show up right away; fall back to cache when offline.
  e.respondWith(
    fetch(e.request, { cache: "no-cache" })
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});

// Laser alerts: shown even when the phone is locked or the app is closed.
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: "Montana Block Hub", body: e.data?.text() }; }
  const quiet = !!d.silent;
  e.waitUntil(self.registration.showNotification(d.title || "Montana Block Hub", {
    body: d.body || "", tag: d.tag || "hub", renotify: !quiet, silent: quiet, requireInteraction: d.sticky !== false,
    vibrate: quiet ? undefined : [400, 200, 400, 200, 800], timestamp: d.timestamp || Date.now(),
    icon: "icons/icon-192.png", badge: "icons/icon-192.png", data: { url: d.url || "./" },
  }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || "./", self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    const w = list.find((c) => c.url.startsWith(self.registration.scope));
    return w ? w.focus() : self.clients.openWindow(url);
  }));
});
