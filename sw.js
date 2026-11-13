const CACHE_NAME = "gcse-vault-shell-v2";
const SHELL_FILES = [
  "",
  "quotes/",
  "dates/",
  "revision/",
  "admin/",
  "admin/editor.html",
  "feedback/",
  "progress/",
  "shared.js",
  "offline.js",
  "progress/progress.js",
  "progress/progress.css",
  "quotes/quotes.js",
  "quotes/quotes.css",
  "dates/dates.js",
  "dates/dates.css",
  "revision/app.js",
  "revision/practice.js",
  "revision/product.js",
  "revision/revision.css",
  "revision/product.css",
  "admin/admin.js",
  "admin/admin.css",
  "admin/push-sw.js",
  "admin/editor.js",
  "revision/catalogues/aqa-a-level-chemistry.json",
  "revision/catalogues/aqa-a-level-physics-core.json",
  "revision/catalogues/edexcel-a-level-mathematics.json",
  "revision/course-packs/aqa-a-level-chemistry.json",
  "revision/course-packs/aqa-a-level-physics-core.json",
  "revision/course-packs/edexcel-a-level-mathematics.json"
];

const scopeUrl = new URL(self.registration.scope);
const shellUrls = SHELL_FILES.map(path => new URL(path || "./", scopeUrl).href);
const cachedPaths = new Set(shellUrls.map(url => new URL(url).pathname));

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(shellUrls)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith("gcse-vault-shell-") && key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

function navigationCacheUrl(url) {
  const target = new URL(url.pathname, url.origin);
  return cachedPaths.has(target.pathname) ? target.href : null;
}

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(scopeUrl.pathname)) return;

  if (request.mode === "navigate") {
    const cacheUrl = navigationCacheUrl(url);
    if (!cacheUrl) return;
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(cacheUrl, response.clone());
        }
        return response;
      } catch {
        return (await caches.match(cacheUrl)) || (await caches.match(scopeUrl.href));
      }
    })());
    return;
  }

  if (!cachedPaths.has(url.pathname)) return;
  event.respondWith((async () => {
    try {
      const response = await fetch(request);
      if (response.ok) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request, response.clone());
      }
      return response;
    } catch {
      return (await caches.match(request, { ignoreSearch: true })) || Response.error();
    }
  })());
});
