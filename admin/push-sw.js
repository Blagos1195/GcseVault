const ADMIN_CACHE = "gcse-vault-admin-shell-v1";
const ADMIN_FILES = ["./", "editor.html", "admin.js", "admin.css", "editor.js", "../shared.js", "../offline.js"];
const adminScope = new URL(self.registration.scope);
const adminUrls = ADMIN_FILES.map(path => new URL(path, adminScope).href);
const adminPaths = new Set(adminUrls.map(url => new URL(url).pathname));

self.addEventListener("install", event => {
  event.waitUntil(caches.open(ADMIN_CACHE).then(cache => cache.addAll(adminUrls)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith("gcse-vault-admin-shell-") && key !== ADMIN_CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !adminPaths.has(url.pathname)) return;
  const cacheUrl = adminUrls.find(candidate => new URL(candidate).pathname === url.pathname);
  event.respondWith((async () => {
    try {
      const response = await fetch(request);
      if (response.ok) {
        const cache = await caches.open(ADMIN_CACHE);
        await cache.put(cacheUrl, response.clone());
      }
      return response;
    } catch {
      return (await caches.match(request, { ignoreSearch: true })) || Response.error();
    }
  })());
});

self.addEventListener("push", event => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch {}
  const title = payload.title || "GCSE Vault";
  const options = {
    body: payload.body || "There is a new submission to review.",
    icon: "../favicon.ico",
    badge: "../favicon.ico",
    tag: payload.tag || "gcsevault-admin",
    data: { url: payload.url || "/GcseVault/admin/" },
    renotify: false
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/GcseVault/admin/", self.location.origin).href;
  event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then(windows => {
    for (const client of windows) {
      if (client.url.startsWith(self.location.origin + "/GcseVault/admin/") && "focus" in client) return client.focus();
    }
    return clients.openWindow(target);
  }));
});
