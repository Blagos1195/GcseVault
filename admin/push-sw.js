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
