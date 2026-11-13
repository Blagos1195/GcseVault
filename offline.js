(() => {
  if (!("serviceWorker" in navigator) || location.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(location.hostname)) return;
  const script = document.currentScript;
  if (!script) return;
  const workerUrl = new URL("sw.js", script.src);
  const scope = new URL("./", script.src).pathname;
  navigator.serviceWorker.register(workerUrl, { scope }).then(registration => {
    if (navigator.onLine) registration.update().catch(() => {});
    window.addEventListener("online", () => registration.update().catch(() => {}));
  }).catch(() => {});
})();
