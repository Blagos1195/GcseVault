const CACHE_NAME = "gcse-vault-shell-v1";
const SHELL_FILES = [
  "",
  "quotes/",
  "dates/",
  "revision/",
  "admin/",
  "admin/editor.html",
  "feedback/",
  "shared.js",
  "offline.js",
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
  let path = url.pathname;
  if (path === scopeUrl.pathname) path += "index.html";
  else if (path.endsWith("/")) path += "index.html";
  const target = new URL(path, url.origin);
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
    event.respondWith(fetch(request).then(response => {
      if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put(cacheUrl, response.clone()));
      return response;
    }).catch(async () => (await caches.match(cacheUrl)) || (await caches.match(new URL("index.html", scopeUrl).href))));
    return;
  }

  if (!cachedPaths.has(url.pathname)) return;
  event.respondWith(caches.match(request, { ignoreSearch: true }).then(cached => {
    const update = fetch(request).then(response => {
      if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()));
      return response;
    });
    return cached || update;
  }));
});
