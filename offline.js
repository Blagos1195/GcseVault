(() => {
  if (!("serviceWorker" in navigator) || location.protocol !== "https:" && location.hostname !== "localhost") return;
  const script = document.currentScript;
  if (!script) return;
  const workerUrl = new URL("sw.js", script.src);
  const scope = new URL("./", script.src).pathname;
  navigator.serviceWorker.register(workerUrl, { scope }).then(registration => {
    if (navigator.onLine) registration.update().catch(() => {});
    window.addEventListener("online", () => registration.update().catch(() => {}));
  }).catch(() => {});
})();
